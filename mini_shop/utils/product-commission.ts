/**
 * 商品级让利比例（商品级平台抽成）—— 口径与文案的**单一出口**。
 *
 * 依据：`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §1
 * + 契约 `MerchantProductSaveDTO.commissionRate` / `MerchantProductVO.commissionRate`
 *   / `MerchantProductVO.commissionPreviewAmount`（均已核对 `api_doc.json`，非推断）。
 *
 * ## 三条硬规则（写在这里，避免散到页面里各写一份而漂移）
 * 1. **`null` / 不传 = 不修改**（**不是**清成 0）：编辑商品保存时，输入框**留空 = 整个字段不提交**。
 *    这与商户级比例同源语义（见 `admin/src/types/merchant.ts` 的 `commissionRate` 注释）。
 * 2. **回显**：`commissionRate === null` 是「未设置商品级」（结算按 物流专用 → 品牌级 → 平台默认 3% 链），
 *    ⇒ 必须显示 {@link PRODUCT_COMMISSION_UNSET_TEXT}，**绝不能显示 `0%`**
 *    （显示 0% 会让商家以为"平台不抽我"，那是错的）。
 * 3. **预览**：`commissionPreviewAmount = round(最低价 × 比例 / 100, 2)`，**比例未设置时为 `null`**
 *    ⇒ 此时**不渲染**预览（不展示 ¥0）。预览**必须**带 {@link PRODUCT_COMMISSION_ESTIMATE_NOTE}。
 *
 * ⚠️ 商品级比例**只影响之后新下的订单**（下单快照原则），已下单/已结算的订单不变。
 */

/** 允许区间下限（%）。契约：越界（如 2.99）报 `13018`。 */
export const PRODUCT_COMMISSION_RATE_MIN = 3
/** 允许区间上限（%）。契约：越界（如 20.01）报 `13018`。 */
export const PRODUCT_COMMISSION_RATE_MAX = 20
/** 越界错误码（后端 `13018`）。 */
export const PRODUCT_COMMISSION_RATE_ERROR_CODE = 13018
/** 越界文案（与后端 `13018` 的 message 逐字一致）。 */
export const PRODUCT_COMMISSION_RATE_RANGE_TEXT = '让利比例必须在 3%~20% 之间'

/**
 * 「未设置商品级比例」时的展示文案。
 *
 * ⚠️ 这里点明**平台默认 3%**（2026-10-08 口径：平台默认抽成由 5% 改为 3%）——
 *    商家看到"未设置"时必须知道**实际会按多少抽**，否则无从判断要不要设商品级比例。
 * ⚠️ 后端链是「物流专用 → 品牌级 → 平台默认」，故写「按上级/平台默认」而不是「平台默认」。
 */
export const PRODUCT_COMMISSION_UNSET_TEXT = '未设置（按上级/平台默认 3%）'

/** 输入框占位文案（留空 = 不修改，与后端语义逐字对齐）。 */
export const PRODUCT_COMMISSION_INPUT_PLACEHOLDER = '留空 = 本次不修改（按上级/平台默认 3%）'

/** 清空输入框的语义说明（防止商家以为"清空 = 把比例取消"）。 */
export const PRODUCT_COMMISSION_OMIT_NOTE =
  '⚠️ 清空输入框 = 本次不修改该比例（不会把已设置的比例清成 0）。'

/** 快照说明（必须展示：让商家知道改动只影响之后的订单）。 */
export const PRODUCT_COMMISSION_SNAPSHOT_NOTE =
  '⚠️ 让利比例只影响之后新下的订单；已下单/已结算的订单按当时的比例结算，不会被追溯修改。'

/** 预览里的估算声明（**必须**与金额一起展示）。 */
export const PRODUCT_COMMISSION_ESTIMATE_NOTE = '按当前最低价估算，实际以订单结算为准'

/** 预览句前缀：`每售出一件平台抽约 ¥C、你可得 ¥(P−C)`。 */
export const PRODUCT_COMMISSION_PREVIEW_PREFIX = '每售出一件平台抽约'

/**
 * 预览不可展示时的返回值（**空串**）—— 比例未设置 / 最低价未知时用它，
 * 调用方（模板 `v-if`）据此**整块不渲染**（绝不用 ¥0 顶替）。
 */
export const PRODUCT_COMMISSION_PREVIEW_EMPTY = ''

/** 输入框文本的解析结果：`unset` = 留空（不修改）/ `invalid` = 越界或非法 / `value` = 有效值。 */
export type ProductCommissionRateParse =
  | { kind: 'unset' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number }

/**
 * 解析输入框文本。
 *
 * - 空白（`''` / `null` / `undefined`）⇒ `unset` —— 调用方据此**省略** `commissionRate` 字段；
 * - 非数字 / 越界（< 3 或 > 20）⇒ `invalid`；
 * - 否则 ⇒ `value`（按两位小数取整，避免 `2.999999` 这类浮点噪音被判越界）。
 */
export function parseProductCommissionRateInput(
  text: string | number | null | undefined,
): ProductCommissionRateParse {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'unset' }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { kind: 'invalid' }
  const rounded = Math.round(value * 100) / 100
  if (rounded < PRODUCT_COMMISSION_RATE_MIN || rounded > PRODUCT_COMMISSION_RATE_MAX) {
    return { kind: 'invalid' }
  }
  return { kind: 'value', value: rounded }
}

/** 提交前本地校验：返回 `null` = 通过，否则返回可直接展示的文案（`13018` 口径）。 */
export function validateProductCommissionRate(text: string | number | null | undefined): string | null {
  return parseProductCommissionRateInput(text).kind === 'invalid' ? PRODUCT_COMMISSION_RATE_RANGE_TEXT : null
}

/**
 * 商品级比例回显文案：`5` → `5.00%`；**`null` / `0` / 非法 → 「未设置（按上级/平台默认 3%）」**。
 *
 * ⚠️ 判据写成 `rate == null || !isFinite || <= 0`（而不是 `?? 0`）—— 后端 `null` 表示
 *    「未设置商品级」，`0` 在契约里是**不可能出现**的越界值；
 *    两者都必须落到「未设置」文案，**不得**渲染成「零比例」（那会让商家以为平台不抽成）。
 */
export function formatProductCommissionRate(rate?: number | null): string {
  const num = Number(rate)
  if (rate == null || !Number.isFinite(num) || num <= 0) return PRODUCT_COMMISSION_UNSET_TEXT
  return `${num.toFixed(2)}%`
}

/**
 * 抽成预览金额 ＝ `round(最低价 × 比例 / 100, 2)`（与后端同公式）。
 *
 * 最低价或比例缺失 ⇒ 返回 `null`（调用方**不渲染**预览，绝不拿 0 顶替）。
 */
export function estimateProductCommissionAmount(
  minPrice?: number | null,
  rate?: number | null,
): number | null {
  const price = Number(minPrice)
  const percent = Number(rate)
  if (!Number.isFinite(price) || price <= 0) return null
  if (!Number.isFinite(percent) || percent <= 0) return null
  return Math.round(price * percent) / 100
}

/**
 * 预览整句：`每售出一件平台抽约 ¥C、你可得 ¥(P−C)`。
 *
 * - 预览金额为 `null` ⇒ 返回**空串**（模板 `v-if` 据此整块不渲染，避免出现「¥0.00」）；
 * - 最低价拿不到 ⇒ 只给「抽约 ¥C」这半句，**不编**「你可得」的金额（不伪造数据）。
 */
export function productCommissionPreviewText(
  previewAmount?: number | null,
  minPrice?: number | null,
): string {
  const amount = Number(previewAmount)
  if (previewAmount == null || !Number.isFinite(amount)) return PRODUCT_COMMISSION_PREVIEW_EMPTY
  const head = `${PRODUCT_COMMISSION_PREVIEW_PREFIX} ¥${amount.toFixed(2)}`
  const price = Number(minPrice)
  if (!Number.isFinite(price) || price <= 0) return head
  return `${head}、你可得 ¥${(Math.round(price * 100) / 100 - amount).toFixed(2)}`
}
