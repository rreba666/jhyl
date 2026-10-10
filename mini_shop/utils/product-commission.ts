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
 *
 * ## 本模块同时管**商户级（品牌级）**让利比例的口径（2026-10 新增，商家入驻页）
 * 两级用的是**同一份**区间 / 解析 / 校验 / 越界文案（同一个后端错误码 `13018`）：
 * - **商品级**（`MerchantProductSaveDTO.commissionRate`）：未设置时按「物流专用 → 品牌级 → 平台默认」链；
 * - **商户级**（入驻页 `MerchantApplyDTO.commissionRate`）：**没有上级**，留空就是平台默认。
 * ⇒ 数值实现**只有一份**（下面的 `PRODUCT_COMMISSION_RATE_MIN/MAX` +
 *   `parseProductCommissionRateInput` / `validateProductCommissionRate`）；
 *   但**用户可见文案按层级分开**（`PRODUCT_COMMISSION_*` 与文末的 `MERCHANT_COMMISSION_*`），
 *   因为「有没有上级」这件事两级不同，**两级的文案不得互相粘贴**。
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
 * 归一化输入文本 —— 把「用户表达的**意图**」和「机器能读的**写法**」对齐（2026-10-10 新增）。
 *
 * 起因（商家真机反馈）：输入 `3%` 会被判成越界，弹的正是上面那句区间提示（`RANGE_TEXT`），
 * 看起来像"根本改不了"。
 * 根因是 `Number('3%')` = `NaN` ⇒ 把一个**表达了合法意图**的输入当成非法值判了越界。
 * 同一类坑还有两个（都在真机上很容易发生、但看代码时想不到）：
 * - **全角数字**（中文输入法全角状态下的 `３`）：`Number('３')` 同样是 `NaN`，
 *   而它在输入框里和半角 `3` 几乎看不出区别 ⇒ 用户会坚称"我就输了个 3"；
 * - **零宽 / 不可见字符**（从别处粘贴带进来的 `\u200B` 等）：肉眼不可见，但会让 `Number()` 变 `NaN`。
 *
 * 处理（**只做无损归一，不放宽任何口径**）：
 * 1. `trim()` 首尾空白（已覆盖全角空格 U+3000、不换行空格 U+00A0）；
 * 2. 去掉零宽字符（U+200B~U+200D / U+FEFF）；
 * 3. 去掉**末尾一个** `%` / 全角 `％`（`3 %` ⇒ `3`；写 `3%` 表达的就是 3 个百分点）；
 * 4. 全角数字与全角小数点 ⇒ 半角（`３` ⇒ `3`、`５．５` ⇒ `5.5`）。
 *
 * ⚠️ 归一化只解决「**写法**」，不解决「**数值**」：`0.5` / `2.99` / `21` 归一化后照样越界被拒。
 * ⚠️ 本函数是**纯函数、无副作用**，导出是为了单测能直接钉住这几条归一规则
 *    （口径只有一处，别在页面里再写一份"去掉百分号"）。
 */
export function normalizeCommissionRateInput(text: string | number | null | undefined): string {
  return String(text ?? '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[%％]\s*$/, '')
    .replace(/[\uFF10-\uFF19]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/\uFF0E/g, '.')
    .trim()
}

/**
 * 解析输入框文本。
 *
 * - 空白（`''` / `null` / `undefined`）⇒ `unset` —— 调用方据此**省略** `commissionRate` 字段；
 * - 非数字 / 越界（< 3 或 > 20）⇒ `invalid`；
 * - 否则 ⇒ `value`（按两位小数取整，避免 `2.999999` 这类浮点噪音被判越界）。
 *
 * ⚠️ 判数值前先过 {@link normalizeCommissionRateInput}（`3%` / `３` / 零宽字符都算**合法写法**）。
 * ⚠️ 但「**有输入、归一化后什么都不剩**」（例如只输了一个 `%`）判 `invalid`，**不是** `unset`：
 *    `unset` 的语义是"留空 ⇒ 不提交这个字段"，把 `%` 吞成 `unset` 会让用户敲进去的东西**静默消失**
 *    （在商品编辑/入驻页那条路径上就等于"没改"，用户却以为改了）。
 */
export function parseProductCommissionRateInput(
  text: string | number | null | undefined,
): ProductCommissionRateParse {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'unset' }
  const normalized = normalizeCommissionRateInput(raw)
  if (!normalized) return { kind: 'invalid' }
  const value = Number(normalized)
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

// ===========================================================================
// 商户级（品牌级）让利比例 —— 商家入驻页（`subpkg-merchant/apply/apply.vue`）
// ===========================================================================
//
// ⚠️ 与上面的**商品级**是**不同层级**：商户级对商户下所有门店生效（后台「设置商户让利比例」改的就是这个），
//    商品级只能在其之下再细化。**区间 / 解析 / 校验 / 越界文案两层共用上面那一份实现，不得各写一份。**
// ⚠️ 文案必须分开：商品级写「按上级/平台默认 3%」是因为它有「物流专用 → 品牌级 → 平台默认」链；
//    商户级**没有上级**，只有平台默认 ⇒ 这里只说「平台默认让利比例」；且**不写死 3%**
//    （平台默认值由后台「系统配置管理」维护，前端不替后端宣布数值）。
// ⚠️ 入驻是**新建**申请（驳回后重提也是新建一条申请单）⇒ 这里**没有**「不传 = 不修改」的语义：
//    输入框留空 = 该字段**整个不提交** = 后端按平台默认结算（**不是** 0，也不是「不参与结算」）。

/** 入驻页输入框占位（留空 = 用平台默认，不是让利 0）。 */
export const MERCHANT_COMMISSION_RATE_INPUT_PLACEHOLDER = '选填，如 5.5；留空按平台默认'

/** 入驻页字段说明：把「留空 = 平台默认」讲明白（商户级没有上级，故不提「上级」）。 */
export const MERCHANT_COMMISSION_RATE_OPTIONAL_NOTE = '选填：留空 = 按平台默认让利比例结算'

/** 入驻页快照说明（必须展示：商家要知道这个比例只影响之后的订单）。 */
export const MERCHANT_COMMISSION_RATE_SNAPSHOT_NOTE = '按订单快照，只影响之后新下的订单'

/** 商户级越界文案 —— 与后端 `13018` 的 message 逐字一致（**引用**商品级那一份，不复制字面量）。 */
export const MERCHANT_COMMISSION_RATE_RANGE_TEXT = PRODUCT_COMMISSION_RATE_RANGE_TEXT

/** 商户级越界错误码 —— 与商品级是同一个后端码 `13018`（**引用**，不复制字面量）。 */
export const MERCHANT_COMMISSION_RATE_ERROR_CODE = PRODUCT_COMMISSION_RATE_ERROR_CODE

/** 商户级解析结果（与商品级同一形状；换个名字只为调用点不出现「Product」）。 */
export type MerchantCommissionRateParse = ProductCommissionRateParse

/**
 * 解析商户级（入驻页）输入框文本 —— 与商品级**同一套解析**（同一区间、同一取整规则、同一越界判定）。
 *
 * - 空白（`''` / `null` / `undefined`）⇒ `unset` ⇒ 调用方**省略** `commissionRate` 字段（后端按平台默认）；
 * - 越界 / 非法 ⇒ `invalid`；
 * - 否则 ⇒ `value`。
 */
export function parseMerchantCommissionRateInput(
  text: string | number | null | undefined,
): MerchantCommissionRateParse {
  return parseProductCommissionRateInput(text)
}

/** 商户级提交前本地校验（`13018` 同一句话）。返回 `null` = 通过，否则返回可直接展示的文案。 */
export function validateMerchantCommissionRate(text: string | number | null | undefined): string | null {
  return validateProductCommissionRate(text)
}

// ===========================================================================
// 商家**自助修改**品牌（商户）级让利比例 —— 结算页（`subpkg-merchant/settlement/index.vue`）
// 依据：`docs/26/10.09/前端对接说明-入驻申请让利比例与商家自改-2026-10-09.md` §一.3
//      + 契约 `PUT /api/merchant/business/commission-rate`（query 参数、**无请求体**、`Result<Void>`）
// ===========================================================================
//
// ⚠️⚠️ **三个「不传 / 留空」的语义各不相同，用户可见文案不得互抄。**
//      本节把它们并排列在这里，就是为了让"复制粘贴串味"在 review 时一眼可见：
//
// | 端点 | 层级 | 「不传 / 留空」的含义 |
// |---|---|---|
// | `PUT /api/merchant/business/commission-rate`（本节「自助调整」） | 品牌级 | **不修改**（保留当前值） |
// | `POST /api/merchant/apply`（入驻申请，见上一节） | 品牌级（**新建**申请单） | **用平台默认**（不是 0，也不是"不结算"） |
// | `POST /api/merchant/products`（保存商品，见文件顶部） | 商品级 | **不修改**（沿用「物流专用 → 品牌级 → 平台默认」链） |
//
// ⇒ 区间 3~20 / 解析 / 校验 / 越界文案**仍共用上面唯一一份实现**（同一个后端错误码 `13018`）；
//   本节只加**这一端点自己的**用户可见文案。

/** 结算页「让利比例」卡片上的**自助调整**入口文案。 */
export const MERCHANT_COMMISSION_RATE_EDIT_ENTRY_TEXT = '自助调整'

/**
 * 自助修改弹层输入框的**占位** —— 按用户要求**只写区间**「3~20」。
 *
 * ⚠️ 2026-10-10（真机反馈）**改短**：原来是「3~20，如 5.5；留空 = 本次不修改」。
 *    采集方式也从 `uni.showModal({ editable: true })` 换成了自建弹层
 *    （`components/CommissionRateSheet.vue`）—— 原生弹窗的输入框**既控制不了聚焦、
 *    占位怎么显示也由原生实现说了算**，更没有小数键盘（`type="digit"`）；
 *    用户看不到区间就只能猜，随手写「3%」还会被判越界 ⇒ 体验上等于"改不了"。
 * ⛔ **不得**写成入驻申请那句「留空按平台默认」—— 本端点的「不传」是「**不修改**」，
 *    两者是本批最容易搞混的一处（见本节表格）。
 * ⚠️ 「留空 = 本次不修改」这条语义**不能省**，只是不放在占位里（占位只放区间）：
 *    弹层内一行短说明见 {@link MERCHANT_COMMISSION_RATE_EDIT_SHEET_NOTE}，
 *    页面卡片上的完整说明见 {@link MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE}。
 */
export const MERCHANT_COMMISSION_RATE_EDIT_PLACEHOLDER = '3~20'

/**
 * 自助修改弹层里的**一行**短说明：只讲「留空 = 本次不修改」。
 *
 * 为什么不直接复用 {@link MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE}：那一句是给**页面卡片**看的
 * （要讲清"不会清成 0，也不会回到平台默认"），塞进弹层就是用户明确说不要的"冗余提示"。
 * ⚠️ 但它**必须**说「不修改」而非「平台默认」—— 本端点的「不传」语义与入驻申请不同。
 */
export const MERCHANT_COMMISSION_RATE_EDIT_SHEET_NOTE = '留空 = 本次不修改'

/** 自助修改的说明：必须让商家知道「留空 = 什么都不改」，**不是**掉回平台默认。 */
export const MERCHANT_COMMISSION_RATE_EDIT_OMIT_NOTE =
  '⚠️ 留空 = 本次不修改（比例保持不变；不会清成 0，也不会回到平台默认）。'

/** 自助修改成功提示（顺带把快照语义讲清：只影响之后新下的订单）。 */
export const MERCHANT_COMMISSION_RATE_EDIT_SUCCESS_TEXT = '让利比例已更新，只影响之后新下的订单'

/** 输入框留空时的提示（**不是**"已用平台默认"，就是"没改"）。 */
export const MERCHANT_COMMISSION_RATE_EDIT_BLANK_TOAST = '未填写比例，本次不修改'
