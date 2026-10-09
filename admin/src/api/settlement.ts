import { request } from './request'

/**
 * 结算明细（**中控 · 行级展开**）接口层 —— **只读**。
 *
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/settlement/statements/{orderNo}/items` | 按订单号返回**每个商品行**的让利比例与抽成金额 |
 *
 * 依据：`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §5.2；
 * 字段权威：dev `/v3/api-docs` 的 `StatementItemVO`（2026-10-09 拉取核对，7 个字段与商家端**完全一致**）。
 *
 * ## 五条口径（改代码前先读）
 * 1. **只读**：本文件**只有这一个 GET**，没有写接口 —— 结算数据由后端按订单状态与释放期生成，
 *    中控**不手工改**结算行（要干预走退款/售后链路，不在本页）。
 * 2. **一单一请求**：端点按 `orderNo` 取，**没有**列表端点
 *    （`/api/admin/settlement/statements` 不存在，本地 `api_doc.json` 与 dev `/v3/api-docs` 均已核对）
 *    ⇒ 页面侧必须**懒加载**（展开某单才请求），⛔ 不许"进页面就给整页订单预取一遍"。
 * 3. 权限：**商户管理员（ADMIN）只能看本商户的结算单**，超管/客服/财务可看全部；
 *    不属于当前商户时后端返回业务码 `1004`（HTTP 200）。
 * 4. **订单没有结算快照** ⇒ 后端返回 `code=1000` + `该订单没有结算快照: {orderNo}`
 *    （2026-10-09 dev 实测原文）—— 这是**正常业务状态**（订单未完成 / 未过释放期），
 *    页面要把它当"这一单还没有结算数据"讲清楚，**不要**渲染成空表或报错弹窗。
 * 5. 字段语义：`goodsAmount` 是**该行分摊后**的商品额（整单优惠已按比例摊入）；
 *    `commissionAmount` 是该行平台抽成，**所有行相加 == 订单级抽成**（后端硬校验）；
 *    `reversedAt` 非空 = 该行已作废（整单退款时整批置作废），必须显式渲染成"作废"。
 */

/** 后端统一响应外壳（与其它模块同形）。 */
interface SettlementResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
  traceId?: string
}

/**
 * 行级抽成明细（后端 `StatementItemVO`）。
 *
 * ⚠️ 数值字段一律当**可空**处理：后端对未知/未快照的行可能下发 null，
 * 页面据此显示「—」，⛔ **不要**兜底成 0（0 是"抽成为 0"这个具体结论，会误导对账）。
 */
export interface AdminStatementItemVO {
  /** shop 侧订单行 ID。 */
  orderItemId: number | null
  /** SKU ID（**契约里没有商品名** ⇒ 页面只展示 SKU ID，不编名称）。 */
  skuId: number | null
  /** 该行生效让利比例（%，3~20）：商品级优先，否则品牌链；展示/审计用。 */
  commissionRate: number | null
  /** 行商品金额（元）= 订单级商品额按行分摊（**整单优惠已按比例摊入**）。 */
  goodsAmount: number | null
  /** 行平台抽成（元）；**Σ行 == 订单级**（后端硬校验）。 */
  commissionAmount: number | null
  /** 作废时间；`null` = 有效（整单退款时整批置作废）。 */
  reversedAt: string | null
  /** 作废原因（可能为空串/null）。 */
  reversedReason: string | null
}

/**
 * 「订单没有结算快照」的业务码（dev 实测 2026-10-09：`code=1000`）。
 * ⚠️ `1000` 是后端的**通用参数/业务错误码**，页面**不要**只看码就下结论，
 *    要连同 message 一起展示（否则会把其它 1000 类错误说成"没有结算快照"）。
 */
export const ADMIN_SETTLEMENT_NO_SNAPSHOT_CODE = 1000

/** 校验响应并按业务码抛错（与其它模块同形）。 */
function unwrap<T>(response: { data: SettlementResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/**
 * 单个订单号的行级抽成明细。**只会被"用户展开某一行"时调用**（见 `SettlementStatementItems.vue`）。
 *
 * @param orderNo 订单号（页面表格里的 `orderNo`，直接取用，不做任何拼接/猜测）
 */
export async function getAdminStatementItems(orderNo: string): Promise<AdminStatementItemVO[]> {
  const path = `/api/admin/settlement/statements/${encodeURIComponent(orderNo)}/items`
  const response = await request.get<SettlementResponse<AdminStatementItemVO[]>>(path)
  const data = unwrap(response, '结算行级明细查询失败')
  return Array.isArray(data) ? data : []
}

/** 行是否已作废（`reversedAt` 非空 ⇒ 整单退款时整批置作废）。 */
export function isReversedStatementItem(row: AdminStatementItemVO | null | undefined): boolean {
  const value = row?.reversedAt
  return value !== null && value !== undefined && String(value).trim() !== ''
}
