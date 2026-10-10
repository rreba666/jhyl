import type { StaffBindDTO } from '@/types/staff'

/**
 * 人员「微信标识」三选一的路由（2026-10-10）。
 *
 * ## 为什么要有这个文件
 *
 * 人员页原先**只有一个** `wechatOpenid` 输入框（标签写「微信号 或 openid」），提交时却把它
 * **一律塞进 `openid` 这个 key**：
 *
 * ```ts
 * ...(needWechat.value && form.wechatOpenid.trim() ? { openid: form.wechatOpenid.trim() } : {})
 * ```
 *
 * ⇒ 运营按标签填**微信号**，后端收到的却是 `openid` ⇒ 报
 * 「微信标识不匹配: 填的值既不是用户#90010 的 openid，也不是其微信号(登记的微信号: 未登记)」。
 * 运营**不可能知道 openid**（微信内部标识），所以这个输入框在"填微信号"这条路径上**必然失败**。
 *
 * ## 契约事实（`api_doc.json`，逐字原文，2026-10-10 已与 dev 实时 `/v3/api-docs` 逐项比对一致）
 *
 * `POST /api/admin/staff/{id}/bind`（D4b 绑定微信用户）接口描述原文：
 *
 * > 校验：账号已被绑定 8112 / 微信已绑本商家其他账号 8113 / 跨店 8114 / 一人一商家 7316。
 * > **微信标识三选一，优先 userId > 微信号 > openid**；微信号是**人工登记**值（小程序拿不到微信号），
 * > **需先在「用户管理」里登记，否则报 2000 并提示去登记**。
 *
 * 三个 key 各自独立、各有各的描述：
 * - `StaffAccountCreateDTO.userId`：「微信用户ID（店长/骑手必填）」
 * - `StaffAccountCreateDTO.wechatId`：「微信号（人工登记值，服务端反查；与 userId/openid 三选一，优先 userId）」
 * - `StaffAccountCreateDTO.openid`：「微信 openid（与 userId 二选一）」
 *
 * ⇒ 契约**已经**把三个 key 分开了，所以前端**不需要**、也**不应该**按"值的形状"去猜该用哪个 key
 * （猜错就是原来的 bug）。做法是：三个**各自独立、各自明确标注**的输入，**每个走自己的 key**，
 * 多填时按**契约写死的优先级**三选一，并把"实际会用哪个、哪些会被忽略"**如实显示给运营**。
 *
 * ## ⚠️ 为什么"多填"不报错、而是按优先级取一个
 *
 * 契约原文就是「**三选一**，优先 userId > 微信号 > openid」⇒ 提交**一个** key 是契约语义；
 * 运营多填时既不静默丢弃（页面上会写明忽略了哪些），也不硬报错（多填信息本身没错，
 * 而且最高优先级的那个正是契约指定的那一个）。
 */

/** 微信标识的三种 key（与契约字段名一一对应，顺序无关，优先级见 `STAFF_WECHAT_PRIORITY`）。 */
export type StaffWechatKey = 'userId' | 'wechatId' | 'openid'

/**
 * 契约写死的优先级（逐字：「优先 userId > 微信号 > openid」）。
 * ⚠️ 不要改成"按谁填得更像"之类的启发式 —— 契约已经明说了顺序。
 */
export const STAFF_WECHAT_PRIORITY: readonly StaffWechatKey[] = ['userId', 'wechatId', 'openid']

/** 表单侧的原始输入（都是字符串，空串 = 没填）。 */
export interface StaffWechatInput {
  userId?: string
  wechatId?: string
  openid?: string
}

/** 三个 key 的中文标签（页面与提示文案共用一份，避免两处措辞漂移）。 */
export const STAFF_WECHAT_LABELS: Record<StaffWechatKey, string> = {
  userId: '微信用户ID',
  wechatId: '微信号',
  openid: 'openid',
}

export interface StaffWechatResolution {
  /** **实际会提交**的 key；`null` = 三个都没填。 */
  key: StaffWechatKey | null
  /** 实际提交的请求体（只含被选中的那一个 key）。 */
  payload: StaffBindDTO
  /** 运营**已填**的 key（按契约优先级排序）。 */
  filled: StaffWechatKey[]
  /** 已填但**因优先级较低不会被提交**的 key —— 页面必须如实告诉运营。 */
  ignored: StaffWechatKey[]
  /**
   * 被选中的 key 填了、但值**格式不合法**（当前只有 `userId` 必须是正整数，因为契约是
   * `integer(int64)`）。⇒ 调用方必须**阻断提交并提示**，**不得**自动降级到次优先级的 key
   * （那等于替运营猜，就是本项目反复踩过的"静默兜底"）。
   */
  invalid: boolean
}

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 把三个输入框解析成**唯一一个**要提交的微信标识 key。
 *
 * ⚠️ 纯函数、无副作用：页面与契约测试都以它为唯一口径。
 */
export function resolveStaffWechatBinding(input: StaffWechatInput): StaffWechatResolution {
  const filled = STAFF_WECHAT_PRIORITY.filter((key) => trimmed(input[key]) !== '')
  const key = filled[0] ?? null
  const payload: StaffBindDTO = {}
  if (key === null) {
    return { key: null, payload, filled, ignored: [], invalid: false }
  }
  const value = trimmed(input[key])
  if (key === 'userId') {
    // 契约 `userId` 是 integer(int64)：非纯数字会在后端参数校验就被打回
    const numeric = Number(value)
    if (!Number.isInteger(numeric) || numeric <= 0) {
      return { key, payload, filled, ignored: filled.slice(1), invalid: true }
    }
    payload.userId = numeric
  } else if (key === 'wechatId') {
    payload.wechatId = value
  } else {
    payload.openid = value
  }
  return { key, payload, filled, ignored: filled.slice(1), invalid: false }
}

/**
 * 提交前给运营看的一句话：「将以 X 绑定」+（多填时）「Y、Z 不会提交」。
 * 返回值**始终非空**（三个都没填时提示需要填一个），调用方可直接展示。
 */
export function staffWechatRoutingHint(resolution: StaffWechatResolution): string {
  if (resolution.key === null) {
    return `请至少填写 ${STAFF_WECHAT_LABELS.userId} / ${STAFF_WECHAT_LABELS.wechatId} / ${STAFF_WECHAT_LABELS.openid} 中的一项`
  }
  const used = `将以「${STAFF_WECHAT_LABELS[resolution.key]}」绑定`
  if (!resolution.ignored.length) return used
  const ignored = resolution.ignored.map((key) => STAFF_WECHAT_LABELS[key]).join('、')
  return `${used}（按后端优先级 userId > 微信号 > openid；已忽略：${ignored}）`
}

/** 微信号必须先登记才可用（契约：「需先在「用户管理」里登记，否则报 2000 并提示去登记」）。 */
export const WECHAT_ID_NEEDS_REGISTRATION_HINT =
  '微信号是人工登记值：需先在「用户管理」里登记（该用户「详情」→ 微信号登记），否则后端报 2000 要求去登记。'
