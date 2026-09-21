import { request } from './request'
import type { DeliveryOrderView } from './delivery'

/** 商家配送域统一响应包装。 */
interface ShopDeliveryResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

function unwrap<T>(response: { data: ShopDeliveryResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 组装门店 query：留空则不传（单门店由后端取默认门店）。 */
function shopQuery(shopId?: number | string): Record<string, string | number> | undefined {
  return shopId === undefined || shopId === '' ? undefined : { shopId }
}

/** 配送任务（`DeliveryTaskEntity`，与商家端同构）。 */
export interface DeliveryTask {
  id?: number
  taskNo?: string
  orderNo?: string
  merchantId?: number
  /** 配送员（骑手）staffId。 */
  deliveryPersonId?: number
  /** MERCHANT_SELF 商家自送 / ASSIGN_TO_PERSON 指定配送员 / PUBLISH_CLAIM 发布领取。 */
  assignmentType?: string
  /** 任务状态：WAIT_ASSIGN/ASSIGNED/ACCEPTED/PICKED_UP/DELIVERING/NEARBY/DELIVERED/EXCEPTION/CANCELED/PAUSED… */
  status?: string
  cancelFromStatus?: string
  pickupAddress?: string
  deliveryAddress?: string
  distanceKm?: number
  estimatedMinutes?: number
  deliveryFee?: number
  receiverName?: string
  receiverPhone?: string
  pickupCode?: string
  assignedAt?: string
  acceptedAt?: string
  pickedUpAt?: string
  startedAt?: string
  nearbyAt?: string
  deliveredAt?: string
  exceptionType?: string
  exceptionRemark?: string
  createTime?: string
  updateTime?: string
}

/** 配送规则（`DeliveryRuleEntity`，门店维度；商家侧只读）。 */
export interface DeliveryRule {
  id?: number
  merchantId?: number
  enabled?: number
  maxDistanceKm?: number
  /** 平台统一配置（只读真相）。 */
  feeType?: string
  feeConfig?: string
  minOrderAmount?: number
  businessHours?: string
  estimatedPrepareMinutes?: number
  estimatedDeliveryMinutes?: number
  cancelFeePolicy?: string
  proofTypes?: string
  pickupCodeEnabled?: number
  couponEnabled?: number
  subsidyEnabled?: number
  createTime?: string
  updateTime?: string
}

/** 本店配送员（`DeliveryStaffView`）。 */
export interface DeliveryStaff {
  id?: number
  name?: string
  phone?: string
}

/** 本店骑手业绩（`ShopRiderStatsVO`）。 */
export interface ShopRiderStats {
  merchantId?: number
  range?: string
  rangeLabel?: string
  fromDate?: string
  toDate?: string
  totalDelivered?: number
  totalDistanceKm?: number
  riderCount?: number
  riders?: Array<Record<string, unknown>>
}

// ===== 配送任务 =====

/** 本店配送任务列表（按时间倒序，最多 100 条）。 */
export async function getMyTasks(shopId?: number | string): Promise<DeliveryTask[]> {
  const data = unwrap(await request.get<ShopDeliveryResponse<DeliveryTask[]>>('/api/admin/delivery/my/tasks', { params: shopQuery(shopId) }), '配送任务查询失败')
  return Array.isArray(data) ? data : []
}

/**
 * 创建配送任务（订单需已「备货完成」）。
 * assignmentType：MERCHANT_SELF 商家自送 / ASSIGN_TO_PERSON 指定配送员 / PUBLISH_CLAIM 发布领取。
 * 返回 taskNo。
 */
export async function createMyTask(
  shopId: number | string | undefined,
  payload: { orderNo: string; assignmentType: string; deliveryPersonId?: number | string },
): Promise<string> {
  const body: Record<string, unknown> = { orderNo: payload.orderNo, assignmentType: payload.assignmentType }
  if (payload.deliveryPersonId !== undefined && payload.deliveryPersonId !== '') body.deliveryPersonId = Number(payload.deliveryPersonId)
  return String(unwrap(await request.post<ShopDeliveryResponse<string>>('/api/admin/delivery/my/tasks', body, { params: shopQuery(shopId) }), '创建配送任务失败') || '')
}

/** 暂停配送任务（配送中任务暂停，恢复走 resume）。 */
export async function pauseMyTask(shopId: number | string | undefined, taskId: number | string, reason?: string): Promise<void> {
  unwrap(await request.post<ShopDeliveryResponse<null>>(`/api/admin/delivery/my/tasks/${taskId}/pause`, { reason: reason || undefined }, { params: shopQuery(shopId) }), '暂停任务失败')
}

/** 异常恢复（EXCEPTION → 异常前状态）。 */
export async function resumeMyTask(shopId: number | string | undefined, taskId: number | string): Promise<void> {
  unwrap(await request.post<ShopDeliveryResponse<null>>(`/api/admin/delivery/my/tasks/${taskId}/resume`, {}, { params: shopQuery(shopId) }), '恢复任务失败')
}

/** 取消配送任务（必填原因）。 */
export async function cancelMyTask(shopId: number | string | undefined, taskId: number | string, reason: string): Promise<void> {
  unwrap(await request.post<ShopDeliveryResponse<null>>(`/api/admin/delivery/my/tasks/${taskId}/cancel`, { reason }, { params: shopQuery(shopId) }), '取消任务失败')
}

/** 改派骑手（未送达任务均可改派，限本商户门店）。 */
export async function reassignMyTask(shopId: number | string | undefined, taskId: number | string, newPersonId: number | string): Promise<void> {
  unwrap(await request.post<ShopDeliveryResponse<null>>(`/api/admin/delivery/my/tasks/${taskId}/reassign`, { newPersonId: Number(newPersonId) }, { params: shopQuery(shopId) }), '改派失败')
}

// ===== 本店同城订单 =====

/** 本店同城订单列表（可按配送状态筛选）。 */
export async function getMyOrders(shopId?: number | string, deliveryStatus?: string): Promise<DeliveryOrderView[]> {
  const params: Record<string, string | number> = { ...(shopQuery(shopId) || {}) }
  if (deliveryStatus) params.deliveryStatus = deliveryStatus
  const data = unwrap(await request.get<ShopDeliveryResponse<DeliveryOrderView[]>>('/api/admin/delivery/my/orders', { params }), '本店同城订单查询失败')
  return Array.isArray(data) ? data : []
}

/** 审核用户取消申请：approve=true 按订单快照扣费后退款；false 恢复取消前状态。 */
export async function auditMyCancel(shopId: number | string | undefined, orderNo: string, approve: boolean, reason?: string): Promise<void> {
  unwrap(
    await request.post<ShopDeliveryResponse<null>>(
      `/api/admin/delivery/my/orders/${encodeURIComponent(orderNo)}/cancel-audit`,
      { approve, reason: reason || undefined },
      { params: shopQuery(shopId) },
    ),
    '取消申请审核失败',
  )
}

// ===== 商户侧订单流转（接单 → 开始备货 → 备货完成；备货完成后才可安排配送） =====

/**
 * 订单流转动作：`/api/admin/order/{orderNo}/{action}`（商户管理员镜像，与 `/api/merchant/orders/**` 同 service）。
 * ⚠️ **平台账号（超管/客服）必须带 `shopId`**，否则返回 `1000 请指定门店…`（后端不知道要操作哪家门店）；
 * 商户管理员单门店可省略，但前端统一带上更稳。
 */
async function orderFlowAction(orderNo: string, action: 'accept' | 'prepare' | 'ready', shopId?: number | string): Promise<void> {
  unwrap(
    await request.post<ShopDeliveryResponse<null>>(`/api/admin/order/${encodeURIComponent(orderNo)}/${action}`, {}, { params: shopQuery(shopId) }),
    '订单操作失败',
  )
}

/** 接单（WAIT_ACCEPT → ACCEPTED）。 */
export async function acceptMyOrder(shopId: number | string | undefined, orderNo: string): Promise<void> {
  await orderFlowAction(orderNo, 'accept', shopId)
}

/** 开始备货（ACCEPTED → PREPARING）。 */
export async function prepareMyOrder(shopId: number | string | undefined, orderNo: string): Promise<void> {
  await orderFlowAction(orderNo, 'prepare', shopId)
}

/** 备货完成（PREPARING → WAIT_ASSIGN，之后才能创建配送任务 = 安排配送）。 */
export async function readyMyOrder(shopId: number | string | undefined, orderNo: string): Promise<void> {
  await orderFlowAction(orderNo, 'ready', shopId)
}

/** 拒单（**必填原因**，触发全额原路退款）。 */
export async function rejectMyOrder(shopId: number | string | undefined, orderNo: string, reason: string): Promise<void> {
  unwrap(
    await request.post<ShopDeliveryResponse<null>>(`/api/admin/order/${encodeURIComponent(orderNo)}/reject`, { reason }, { params: shopQuery(shopId) }),
    '拒单失败',
  )
}

/** 商家工作台红点未读数（拉取即清零）。⚠️ 同样需要 `shopId`（平台账号不传报 1000）。 */
export async function getMyUnread(shopId?: number | string): Promise<number> {
  const data = unwrap(await request.get<ShopDeliveryResponse<number>>('/api/admin/delivery/my/unread', { params: shopQuery(shopId) }), '未读数查询失败')
  return Number(data) || 0
}

// ===== 配送员 / 业绩 / 规则 =====

/** 本店配送员列表。 */
export async function getMyStaff(shopId?: number | string): Promise<DeliveryStaff[]> {
  const data = unwrap(await request.get<ShopDeliveryResponse<DeliveryStaff[]>>('/api/admin/delivery/my/staff/delivery', { params: shopQuery(shopId) }), '配送员查询失败')
  return Array.isArray(data) ? data : []
}

/** 开启/关闭某店员的配送员身份（商家账号 is_merchant=1 不可设为骑手）。 */
export async function toggleMyStaff(shopId: number | string | undefined, staffId: number | string, enabled: boolean): Promise<void> {
  unwrap(await request.post<ShopDeliveryResponse<null>>(`/api/admin/delivery/my/staff/${staffId}/delivery`, { enabled }, { params: shopQuery(shopId) }), '配送员开关失败')
}

/** 本店骑手配送业绩（排行榜 + 区间合计）。 */
export async function getMyRiderStats(shopId?: number | string, range = 'DAY'): Promise<ShopRiderStats> {
  const params: Record<string, string | number> = { range, ...(shopQuery(shopId) || {}) }
  return unwrap(await request.get<ShopDeliveryResponse<ShopRiderStats>>('/api/admin/delivery/my/rider-stats', { params }), '骑手业绩查询失败')
}

/** 本店配送规则（`GET`，返回体与商家端 `GET /api/merchant/delivery/rules` 一致）。 */
export async function getMyRules(shopId?: number | string): Promise<DeliveryRule | null> {
  return unwrap(await request.get<ShopDeliveryResponse<DeliveryRule>>('/api/admin/delivery/my/rules', { params: shopQuery(shopId) }), '配送规则查询失败')
}

/**
 * 配送规则保存入参（`RuleSaveDTO`，2026-09-21 新增的平台写接口）。
 *
 * ⚠️ 三条必须守住的口径（摘自 `api_doc.json` 里 `POST /api/admin/delivery/my/rules` 的描述原文）：
 * 1. **未传字段 = 保持不变**（缺省用 `null` 表示"不改"，**不是**"改回默认值"）；
 * 2. `businessHours` / `cancelFeePolicy` / `feeConfig` 是 **JSON 列**，接受两种写法：
 *    字符串简写（如 `09:00-22:00` → 后端自动转成 `{"start":"09:00","end":"22:00"}`）
 *    或**直接给 JSON 串**（推荐）；
 * 3. `couponEnabled` / `subsidyEnabled` 是 V1 占位开关，**禁止传 true**（传了报 `1000`）
 *    —— 所以本前端**刻意不提交这两个字段**，只在页面上只读展示。
 *
 * `feeType` / `feeConfig`（配送费）技术上可传，但业务口径是**平台统一配置**，
 * 写入口在「同城配送管理 → 配送费配置」（`POST /api/admin/delivery/fee-config`），
 * 本面板不编辑它们，避免出现两个互相打架的入口。
 */
export interface RuleSaveDTO {
  /** `1`=开放该店同城配送（写入 `delivery_rules.enabled` 即等价于"该店能被 C 端选中"）。 */
  enabled?: number
  maxDistanceKm?: number
  minOrderAmount?: number
  /** JSON 串，如 `{"start":"09:00","end":"22:00"}`。 */
  businessHours?: string
  estimatedPrepareMinutes?: number
  estimatedDeliveryMinutes?: number
  cancelFeePolicy?: string
  proofTypes?: string
  pickupCodeEnabled?: number
  feeType?: string
  feeConfig?: string
}

/**
 * 保存本店配送规则（**平台写接口**，2026-09-21 新增，对应我方向后端提的需求 §一 P0）。
 *
 * **为什么必须补这个入口**：此前口径是"门店配送规则只能由平台设置、后台只读"，但平台侧
 * **当时并没有写接口**、商家端也没有「配送设置」页 —— 结果是**两端都没有入口**：
 * 新入驻门店 `delivery_rules` 无记录、`enabled=0`，C 端结算页不列出该店，
 * **同城单根本下不进来**（V1.22 已改口径并补上本接口）。
 *
 * 语义：该店无规则则**创建**、有则**更新**（upsert）；未传字段 = 保持不变。
 * 权限：`SUPER_ADMIN` / `CUSTOMER_SERVICE`；平台账号**必须带 `shopId`**，商户管理员只能改自己绑定的门店。
 * 留痕：`operation=ADMIN_DELIVERY_RULES_SAVE`、`targetType=SHOP`，**带前后快照**。
 * 返回：保存后的完整规则对象（与 `GET` 同结构）—— 调用方可直接回填，**无需二次拉取**。
 */
export async function saveMyRules(shopId: number | string | undefined, payload: RuleSaveDTO): Promise<DeliveryRule | null> {
  return unwrap(
    await request.post<ShopDeliveryResponse<DeliveryRule>>('/api/admin/delivery/my/rules', payload, { params: shopQuery(shopId) }),
    '配送规则保存失败',
  )
}
