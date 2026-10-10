import { request } from './request'
import type {
  DeliveryReturnPage,
  DeliveryReturnPageResult,
  DeliveryReturnQuery,
  DeliveryReturnResponse,
  DeliveryReturnRow,
} from '@/types/deliveryReturns'

/**
 * 退款返货台账（中控 · **只读**）接口层。
 *
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/delivery/returns` | `merchantId`（**不传 = 全平台**）/ `returnStatus`（**不传 = 未收口**）/ `page`（default 1）/ `pageSize`（default 20） |
 *
 * ## ⛔ 没有写接口（不要在这里"补"一个）
 * 契约里该 path **只有 `get`**；唯一的「验收」写接口是**商家侧**
 * `POST /api/merchant/delivery/tasks/{taskId}/accept-return`（`accept=true` 确认收货 /
 * `accept=false` 拒收并落 `damageClaimStatus=RECORDED`）。
 * ⚠️ 平台账号未绑商户、契约也没写平台角色可否调用 ⇒ **前端不代调**，
 * 中控的「人工放行」**待后端补 admin 侧写接口**（需求已提：
 * `docs/26/10.09/后端需求-返货验收放行与契约口径-2026-10-09.md` §一 R1）。
 *
 * ## 字段名：契约**有**明细，但**未拿到真实响应**（如实说明）
 * 200 schema = `ResultPageResultDeliveryTaskEntity` → `PageResultDeliveryTaskEntity{total,list,page,pageSize}`
 * → `list[] = DeliveryTaskEntity`（33 个字段，返货专有字段齐全）。
 * ⚠️ 2026-10-10 复核时 **dev `192.168.1.4:8080` 不可达**（TCP 8080 连不上、`/v3/api-docs` 超时）
 * ⇒ 本期**没有真实响应**、字段名**没有被真实数据验证过**。故这里：
 * 1. **契约名优先 + 少量别名**（下面每个 `pick*` 的别名数组，第一个就是契约名，其余是同义改名的兜底）；
 * 2. **原始对象整份带回**（`raw`），页面可展开查看 + 页底有「原始数据」；
 * 3. 取不到 = `null`（页面显示「—」）——**不给默认值、不做归类、不做单位换算**。
 */

/** 后端响应校验（与其它模块同形）。 */
function ensureSuccess<T>(result: DeliveryReturnResponse<T>, fallback: string): T {
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 字段名归一化：去掉下划线/连字符并转小写（`return_status` / `returnStatus` 视为同一个名字）。 */
function normalizeFieldName(name: string): string {
  return name.replace(/[_-]/g, '').toLowerCase()
}

/**
 * 在一行原始对象里按**别名顺序**取值（命中即返回；都取不到返回 `undefined`）。
 * ⚠️ 按别名顺序、不按后端 JSON 字段顺序 —— 同一行若同时出现两种写法，取哪个由本文件决定。
 */
function pickRaw(row: Record<string, unknown>, aliases: string[]): unknown {
  const byName = new Map<string, unknown>()
  for (const [name, value] of Object.entries(row)) {
    const normalized = normalizeFieldName(name)
    if (!byName.has(normalized)) byName.set(normalized, value)
  }
  for (const alias of aliases) {
    const normalized = normalizeFieldName(alias)
    if (byName.has(normalized)) return byName.get(normalized)
  }
  return undefined
}

/** 取文本：`null` / `undefined` / 空串一律返回 `null`（= 后端没给，**不给默认值**）。 */
function pickText(row: Record<string, unknown>, aliases: string[]): string | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** 取数值：非有限数按"后端没给"处理（`null`）。 */
function pickNumber(row: Record<string, unknown>, aliases: string[]): number | null {
  const value = pickRaw(row, aliases)
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' || typeof value === 'boolean') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 取布尔：**只认真正的布尔语义**（`true/false`、`1/0`、`'true'/'false'`），其余一律 `null`。
 * ⚠️ 契约把 `acceptAuto` 声明为 `integer`（`true` = 系统超时自动确认）
 * ⇒ 1/0 是它的自然写法；**拿不准就返回 `null`（页面显示「—」）**，不硬猜成"人工验收"。
 */
function pickBoolean(row: Record<string, unknown>, aliases: string[]): boolean | null {
  const value = pickRaw(row, aliases)
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

/**
 * 单行归一化。
 * ⚠️ 别名数组里的第一个名字 = **契约（`DeliveryTaskEntity`）里的真实字段名**，
 * 其余只是"后端改名"的兜底。**未识别出 `id`** 的行照样渲染（可在展开行 / 原始数据里看到），
 * 但会被页面标注为"关键字段没对上"。
 */
export function normalizeDeliveryReturnRow(value: unknown): DeliveryReturnRow {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const id = pickNumber(row, ['id', 'taskId'])
  return {
    id,
    idRecognized: id !== null,
    taskNo: pickText(row, ['taskNo', 'taskNumber', 'taskCode']),
    orderNo: pickText(row, ['orderNo', 'orderNumber', 'orderSn']),
    merchantId: pickNumber(row, ['merchantId', 'brandId']),
    deliveryPersonId: pickNumber(row, ['deliveryPersonId', 'riderId', 'courierId']),
    // 骑手任务状态：契约字段名就是 status（别与订单的 deliveryStatus 混用）
    status: pickText(row, ['status', 'taskStatus']),
    assignmentType: pickText(row, ['assignmentType', 'assignType']),
    receiverName: pickText(row, ['receiverName']),
    receiverPhone: pickText(row, ['receiverPhone']),
    deliveryAddress: pickText(row, ['deliveryAddress']),
    // ---- 返货专有字段（本页的核心）----
    returnStatus: pickText(row, ['returnStatus', 'returnState']),
    returnRequiredAt: pickText(row, ['returnRequiredAt', 'returnRequireAt']),
    returnDeadline: pickText(row, ['returnDeadline', 'returnDueAt']),
    returnedAt: pickText(row, ['returnedAt', 'returnedTime', 'returnTime']),
    acceptDeadline: pickText(row, ['acceptDeadline', 'acceptDueAt']),
    acceptResult: pickText(row, ['acceptResult', 'acceptStatus']),
    acceptAuto: pickBoolean(row, ['acceptAuto', 'autoAccept', 'acceptAutoFlag']),
    acceptRemark: pickText(row, ['acceptRemark', 'acceptNote', 'acceptComment']),
    acceptTime: pickText(row, ['acceptTime', 'acceptAt', 'acceptedAt']),
    damageClaimStatus: pickText(row, ['damageClaimStatus', 'damageStatus']),
    returnFeeBearer: pickText(row, ['returnFeeBearer', 'returnFeePayer', 'feeBearer']),
    createTime: pickText(row, ['createTime', 'createdTime', 'createdAt']),
    updateTime: pickText(row, ['updateTime', 'updatedTime', 'updatedAt']),
    raw: row,
  }
}

/**
 * 读：退款返货台账（只读）。
 *
 * ⚠️ 三条"不猜"的口径：
 * 1. **参数不传就是"不传"**：`merchantId` 不传 = 全平台、`returnStatus` 不传 = 后端默认（未收口）
 *    ⇒ 这里绝不给它们兜底成某个具体值（否则"看全平台"会被前端悄悄改成"看某一家"）。
 * 2. **`total` 缺失不算 0**：返回 `total: null`，由页面切换翻页判据并如实标注
 *    （编一个 0 会让运营以为"一条都没有"）。
 * 3. **失败 ≠ 空列表**：`code≠0` / 请求失败一律抛错（页面显示"本次结果不可用"），
 *    只有真的拿到 `list: []` 才返回空行集。
 */
export async function getDeliveryReturns(
  params: DeliveryReturnQuery,
): Promise<DeliveryReturnPageResult> {
  const query: Record<string, string | number> = {}
  if (params.merchantId !== undefined) query.merchantId = params.merchantId
  if (params.returnStatus !== undefined) query.returnStatus = params.returnStatus
  if (params.page !== undefined) query.page = params.page
  if (params.pageSize !== undefined) query.pageSize = params.pageSize
  const response = await request.get<DeliveryReturnResponse<DeliveryReturnPage>>(
    '/api/admin/delivery/returns',
    { params: query },
  )
  const data = ensureSuccess(response.data, '退款返货台账查询失败')
  const list = Array.isArray(data?.list) ? data.list : []
  const total = typeof data?.total === 'number' && Number.isFinite(data.total) ? data.total : null
  const page = typeof data?.page === 'number' && Number.isFinite(data.page) ? data.page : null
  const pageSize = typeof data?.pageSize === 'number' && Number.isFinite(data.pageSize) ? data.pageSize : null
  return {
    rows: list.map(normalizeDeliveryReturnRow),
    total,
    page,
    pageSize,
  }
}
