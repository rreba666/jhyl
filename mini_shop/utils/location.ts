/**
 * 骑手端定位工具
 *
 * 配送节点（取货 / 开始配送 / 到达附近 / 送达）需要向后端上报当前位置，
 * 这里把 `uni.getLocation` 的成功取值与**失败分支的统一兜底**收敛到一处：
 * 1. 用户从未授权 → 微信会自己弹授权框；
 * 2. 用户曾经拒绝 → 微信**不再弹窗**，只能引导去设置页手动打开（否则接口一直失败、页面像卡住）；
 * 3. 手机系统定位关闭 / 定位超时 → 给一句可读提示。
 *
 * 注意：`getLocation` 属于微信「隐私接口」，必须在 `manifest.json` 的 `mp-weixin` 里同时声明
 * `requiredPrivateInfos`（接口白名单）与 `permission["scope.userLocation"].desc`（用途说明），
 * 否则基础库直接弹「需要在 app.json 中声明 permission scope.userLocation 字段」。
 */
import type { TaskNodeBody } from '@/api/delivery'

/** 曾拒绝定位授权时的引导：弹确认框 → 跳系统设置页。 */
function guideToSetting(): void {
  uni.showModal({
    title: '需要位置权限',
    content: '取货、送达需要记录当前位置，请在设置里开启「位置信息」后重试',
    confirmText: '去设置',
    success: (res) => {
      if (res.confirm) uni.openSetting({})
    },
  })
}

/** 非授权问题的定位失败提示（系统定位关闭 / 超时等）。 */
function toastLocationFailed(): void {
  uni.showToast({ title: '定位失败，请检查手机定位开关', icon: 'none' })
}

/**
 * 是否**已经授权过**位置权限。
 *
 * 用于「顺手采一次定位」这类静默场景：没授权就干脆不采，避免骑手一进页面就被授权弹窗打扰
 * ——授权动作应该由取货/送达这种骑手主动触发的流程去申请。
 */
export function isLocationAuthorized(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.getSetting({
      success: (res) => {
        const authSetting = (res && res.authSetting) || {}
        resolve(authSetting['scope.userLocation'] === true)
      },
      fail: () => resolve(false),
    })
  })
}

/**
 * 采集当前定位（gcj02）并组装节点上报体。
 *
 * @param required 是否必采：
 *   - `true`：失败时 reject（送达 / 开始配送这类节点必须有坐标）；
 *   - `false`：失败时 resolve 空对象（取货允许无定位，不阻断主流程）。
 * @param silent 静默模式：失败时不弹任何提示（用于「进页面顺手取一次定位画地图」这类非用户主动触发的场景，
 *   避免骑手一进列表就被授权弹窗/toast 打扰）。
 */
export function collectNodeLocation(required = true, silent = false): Promise<TaskNodeBody> {
  return new Promise((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy }),
      fail: () => {
        if (!silent) {
          // 先查授权状态：`false` 表示曾被拒绝，此时只能去设置页开启
          uni.getSetting({
            success: (setting) => {
              const authSetting = (setting && setting.authSetting) || {}
              if (authSetting['scope.userLocation'] === false) guideToSetting()
              else toastLocationFailed()
            },
            fail: toastLocationFailed,
          })
        }
        if (required) reject(new Error('获取定位失败，请开启定位权限后重试'))
        else resolve({})
      },
    })
  })
}

/** 经纬度点。 */
export interface LatLng {
  latitude: number
  longitude: number
}

/** 两点间球面直线距离（米，Haversine）。 */
export function distanceMeters(from: LatLng, to: LatLng): number {
  const EARTH_RADIUS = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(to.latitude - from.latitude)
  const dLng = toRad(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS * Math.asin(Math.sqrt(a)))
}

/** 送达位置软提醒的阈值（米）：超出即二次确认。 */
export const DELIVER_DISTANCE_WARN_METERS = 500

/**
 * 送达位置**软提醒**：拿骑手当前位置与收货点算直线距离，超过阈值就二次确认。
 *
 * ⚠️ 只提醒、**不拦截** —— 后端 `/delivered` 本身不校验位置（坐标只落轨迹供后台回放），
 * 而室内 / 高楼 / 地下车库的定位飘移很常见，硬拦会让骑手直接送不了单。
 * 真要硬校验得后端加规则（阈值 + 错误码）。
 *
 * @returns true = 继续送达；false = 骑手选择了"再核对一下"（调用方应中止本次送达）
 */
export async function confirmDeliverDistance(target?: {
  latitude?: number | null
  longitude?: number | null
}): Promise<boolean> {
  // 收货点没坐标就无从比较，直接放行
  if (target?.latitude == null || target?.longitude == null) return true
  const body = await collectNodeLocation(false, true)
  if (body.latitude == null || body.longitude == null) return true
  const meters = distanceMeters(
    { latitude: body.latitude, longitude: body.longitude },
    { latitude: Number(target.latitude), longitude: Number(target.longitude) },
  )
  if (meters <= DELIVER_DISTANCE_WARN_METERS) return true
  return new Promise((resolve) => {
    uni.showModal({
      title: '距离收货点较远',
      content: `当前位置距收货点约 ${meters} 米，确认已经送达吗？`,
      confirmText: '确认送达',
      cancelText: '再核对一下',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(true),
    })
  })
}
