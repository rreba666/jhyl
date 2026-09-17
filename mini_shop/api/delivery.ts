import { request } from '@/utils/request'

/**
 * 骑手任务（后端 `RiderTaskVO`，2026-09-14 骑手端 UI 落地版）。
 * 与旧 `DeliveryTaskEntity` 的差异：
 * - `receiverPhone` **明文下发**（拨号必需），UI 上的星号由前端自己截；
 * - **不再下发 `pickupCode`**，改为布尔 `pickupCodeRequired`（送达前须先 `/verify-code`）；
 * - 新增倒计时三件套 `expectedDeliverAt / remainingSeconds / serverTime`（服务端时间基准）；
 * - 新增 `itemCount / totalQuantity`（卡片折叠条「商品清单（3件）」）。
 */
export interface RiderTask {
  id?: number
  taskNo?: string
  orderNo?: string
  /** 门店 ID（配送侧口径 = wx_shop.id）。 */
  merchantId?: number
  deliveryPersonId?: number
  /** MERCHANT_SELF 商家自送 / ASSIGN_TO_PERSON 指定骑手 / PUBLISH_CLAIM 发布领取。 */
  assignmentType?: string
  /** PENDING/ASSIGNED/ACCEPTED/PICKED_UP/DELIVERING/NEARBY/DELIVERED/EXCEPTION/CANCELLED。 */
  status?: string
  pickupAddress?: string
  pickupLat?: number
  pickupLng?: number
  deliveryAddress?: string
  deliveryLat?: number
  deliveryLng?: number
  /** 配送段距离（km，任务快照）。 */
  distanceKm?: number
  /** 预计配送时长（分钟，任务快照）。 */
  estimatedMinutes?: number
  deliveryFee?: number
  receiverName?: string
  /** 收货人手机号【明文】，前端决定是否打星号。 */
  receiverPhone?: string
  /** 本单是否需要收货码核销（true 时送达前必须先校验收货码）。 */
  pickupCodeRequired?: boolean
  /** 商品清单行数（UI 折叠条「商品清单（N 件）」）。 */
  itemCount?: number
  /** 商品总件数（Σquantity）。 */
  totalQuantity?: number
  /** 承诺送达时间（UI「10:13前送达」）。 */
  expectedDeliverAt?: string
  /** 距承诺送达的剩余秒数（服务端基准；已送达/取消/异常为 null）。 */
  remainingSeconds?: number | null
  /** 服务端当前时间（**倒计时基准，不要用本机时间算**）。 */
  serverTime?: string
  assignedAt?: string
  acceptedAt?: string
  pickedUpAt?: string
  startedAt?: string
  nearbyAt?: string
  deliveredAt?: string
  exceptionType?: string
  exceptionRemark?: string
  /** 凭证补传截止时间（送达后 24h）。 */
  proofDeadline?: string
  /**
   * 订单备注（用户留言，如"放前台/别敲门"）。
   * ⚠️ 设计稿（详情页「订单信息 → 备注」）需要，但后端 `RiderTaskVO` **暂未返回该字段** ——
   * 已作为待补字段反馈后端，接口补上后前端无需改动（当前显示「无」）。
   */
  remark?: string
  createTime?: string
  updateTime?: string
}

/** 任务商品明细（`RiderTaskItemVO`，均为下单时快照）。 */
export interface RiderTaskItem {
  skuId?: number
  productName?: string
  productImage?: string
  skuSpec?: string
  price?: number
  quantity?: number
}

/** 工作台 Tab（与后端 `tab` 参数一致）。 */
export type RiderTaskTab = 'NEW' | 'PICKUP' | 'DELIVERING' | 'DONE' | 'EXCEPTION' | 'ALL'

/** 通用分页结构。 */
export interface PageResult<T> {
  total: number
  list: T[]
  page: number
  pageSize: number
}

/** 节点上报体（start / nearby / delivered 必采定位；pickup 可选）。 */
export interface TaskNodeBody {
  latitude?: number
  longitude?: number
  accuracy?: number
  locationText?: string
  requestId?: string
}

/** 我的配送业绩（`RiderStatsVO`，只有单量与里程，无金额）。 */
export interface RiderStats {
  riderId?: string
  range?: string
  rangeLabel?: string
  fromDate?: string
  toDate?: string
  deliveredCount?: number
  distanceKm?: number
  activeDays?: number
  avgPerActiveDay?: number
  cancelledCount?: number
  exceptionCount?: number
  firstStatDate?: string
  lastDeliveredAt?: string
  daily?: Array<Record<string, unknown>>
}

/** 骑手上报的异常类型（附录 C 枚举）。 */
export const EXCEPTION_TYPES = [
  { value: 'CONTACT_FAILED', label: '联系不上' },
  { value: 'ADDRESS_ERROR', label: '地址错误' },
  { value: 'VEHICLE_ISSUE', label: '车辆问题' },
  { value: 'TIMEOUT', label: '超时' },
  { value: 'GOODS_DAMAGED', label: '商品损坏' },
  { value: 'SHORTAGE', label: '缺货' },
  { value: 'OTHER', label: '其他' },
] as const

/**
 * 从上传接口返回的图片 **URL 反推 OSS Key**（接口文档 §4.5 的已知口径不一致）。
 * - prod（图片代理）：`https://{域名}/api/image/common/20260914/abc.jpg` → `common/20260914/abc.jpg`
 * - dev（OSS 直链）：去掉桶域名，取路径部分
 * `proof.objectKey` 与 `exception.imageKeys` 都要 **Key** 而不是 URL。
 */
export function toObjectKey(url: string): string {
  const value = String(url || '').trim()
  if (!value) return ''
  const marker = '/api/image/'
  const index = value.indexOf(marker)
  if (index >= 0) return value.slice(index + marker.length)
  try {
    // OSS 直链：取 pathname 去掉前导斜杠
    const matched = value.match(/^https?:\/\/[^/]+(\/.*)$/)
    if (matched) return matched[1].replace(/^\/+/, '')
  } catch { /* 忽略解析失败 */ }
  return value.replace(/^\/+/, '')
}

/** 统一把可能为 null 的列表转成数组。 */
function toList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

// ===== 工作台列表（推荐：一个接口覆盖 5 个 Tab） =====

/**
 * 工作台任务列表（按 Tab 分页）。
 * - `NEW`：指派给我未接受 + 本店待领取池
 * - `PICKUP`：我 ACCEPTED
 * - `DELIVERING`：我 PICKED_UP / DELIVERING / NEARBY
 * - `DONE`：我 DELIVERED
 * - `EXCEPTION`：我 EXCEPTION / CANCELLED
 * - `ALL`：全部（缺省）
 */
export async function getRiderTasks(tab: RiderTaskTab, page = 1, pageSize = 10): Promise<PageResult<RiderTask>> {
  const data = await request<Partial<PageResult<RiderTask>>>({
    url: '/api/delivery/tasks',
    method: 'GET',
    data: { tab, page, pageSize },
  })
  return {
    total: Number(data?.total || 0),
    list: Array.isArray(data?.list) ? data.list : [],
    page: Number(data?.page || page),
    pageSize: Number(data?.pageSize || pageSize),
  }
}

/** 任务商品清单（卡片展开时调用；折叠条的件数用列表里的 `itemCount`）。 */
export async function getTaskItems(taskId: number | string): Promise<RiderTaskItem[]> {
  return toList<RiderTaskItem>(await request<unknown>({ url: `/api/delivery/tasks/${taskId}/items`, method: 'GET' }))
}

// ===== 旧列表接口（后端兼容保留；新前端优先用 getRiderTasks） =====

/** 我的进行中任务（兼容保留，最多 50 条）。 */
export async function getMyActiveTasks(): Promise<RiderTask[]> {
  return toList<RiderTask>(await request<unknown>({ url: '/api/delivery/tasks/mine/active', method: 'GET' }))
}

/** 我的历史任务（兼容保留，最多 50 条、无分页）。 */
export async function getMyHistoryTasks(): Promise<RiderTask[]> {
  return toList<RiderTask>(await request<unknown>({ url: '/api/delivery/tasks/mine/history', method: 'GET' }))
}

/** 本店待领取池（兼容保留，最多 50 条）。 */
export async function getClaimableTasks(): Promise<RiderTask[]> {
  return toList<RiderTask>(await request<unknown>({ url: '/api/delivery/tasks/claimable', method: 'GET' }))
}

/** 任务详情（收货手机号明文，UI 星号由前端截）。 */
export async function getTaskDetail(taskId: number | string): Promise<RiderTask> {
  return request<RiderTask>({ url: `/api/delivery/tasks/${taskId}`, method: 'GET' })
}

/** 取号：返回收货人手机号明文（记录取号日志 + 60s 限流）。 */
export async function getTaskContact(taskId: number | string, reason?: string): Promise<string> {
  const data = await request<unknown>({ url: `/api/delivery/tasks/${taskId}/contact`, method: 'GET', data: reason ? { reason } : undefined })
  return typeof data === 'string' ? data : String(data ?? '')
}

// ===== 流转动作 =====

/** 领取发布任务（PENDING→ACCEPTED，先到先得）。 */
export async function claimTask(taskId: number | string, requestId?: string): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/claim`, method: 'POST', data: { requestId } })
}

/** 接受指派（ASSIGNED→ACCEPTED）。 */
export async function acceptTask(taskId: number | string, requestId?: string): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/accept`, method: 'POST', data: { requestId } })
}

/** 拒绝指派（回池，**必须填原因**）。 */
export async function rejectTask(taskId: number | string, reason: string, requestId?: string): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/reject`, method: 'POST', data: { reason, requestId } })
}

/** 已取货（ACCEPTED→PICKED_UP，**定位可选**）。 */
export async function pickupTask(taskId: number | string, body: TaskNodeBody = {}): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/pickup`, method: 'POST', data: body })
}

/** 开始配送（PICKED_UP→DELIVERING，**必采定位**）。 */
export async function startTask(taskId: number | string, body: TaskNodeBody): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/start`, method: 'POST', data: body })
}

/** 到达附近（DELIVERING→NEARBY，**必采定位**，前端引导一键拨号）。 */
export async function nearbyTask(taskId: number | string, body: TaskNodeBody): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/nearby`, method: 'POST', data: body })
}

/**
 * 校验收货码（启用收货码的任务：送达前必须先校验）。
 * 校验成功后端落 `PICKUP_CODE_VERIFIED` 事件，送达接口只认该服务端事件。
 */
export async function verifyTaskCode(taskId: number | string, code: string): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/verify-code`, method: 'POST', data: { code } })
}

/**
 * 确认送达（**必采定位**）。
 * 注意：V1.18 起**不再接受前端 `pickupCodeVerified` 布尔**，启用收货码的任务必须先调 `/verify-code`。
 */
export async function deliverTask(taskId: number | string, body: TaskNodeBody): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/delivered`, method: 'POST', data: body })
}

/** 上报异常（异常类型 + 说明必填；`imageKeys` 为 **OSS Key 列表**，用 `toObjectKey` 反推）。 */
export async function reportTaskException(
  taskId: number | string,
  body: { type: string; remark: string; imageKeys?: string[]; requestId?: string },
): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/exception`, method: 'POST', data: body })
}

/** 用户拒收（不走送达，订单转取消 + 退款）。 */
export async function rejectReceipt(taskId: number | string, remark?: string, requestId?: string): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/reject-receipt`, method: 'POST', data: { remark, requestId } })
}

/** 上传送达凭证（照片必传，可后补 24h；`objectKey` 用 `toObjectKey` 反推）。 */
export async function uploadTaskProof(
  taskId: number | string,
  body: { proofType: string; objectKey: string; receiverName?: string; remark?: string; requestId?: string },
): Promise<void> {
  await request({ url: `/api/delivery/tasks/${taskId}/proof`, method: 'POST', data: body })
}

// ===== 辅助 =====

/** 骑手工作台红点未读数（拉取即清零；建议 30s 轮询）。 */
export async function getRiderUnread(): Promise<number> {
  const data = await request<unknown>({ url: '/api/delivery/tasks/unread', method: 'GET' })
  return Number(data) || 0
}

/** 我的配送业绩（DAY / WEEK / MONTH / ALL）。 */
export async function getRiderStats(range = 'DAY'): Promise<RiderStats> {
  return request<RiderStats>({ url: '/api/delivery/tasks/my-stats', method: 'GET', data: { range } })
}
