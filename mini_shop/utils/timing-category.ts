/**
 * 时效档位（`timingCategory`）与「售后窗口 / 资金释放」用户可见文案的**单一来源**。
 *
 * ## 依据（后端 2026-10-08 交付，Step1 / Step2 / Step3）
 * - `docs/26/10.08/前端对接-Step1-商品时效档位-2026-10-08(1).md`
 * - `docs/26/10.08/前端对接-Step2-同城时效与资金口径-2026-10-08.md`
 * - `docs/26/10.08/前端对接-Step3-提现拦截与生鲜标注-2026-10-08.md`
 *
 * ## ⚠️⚠️ 最重要的一条边界：档位**只改变同城单**（Step1 §三）
 * | 配送方式 | 档位是否影响 | 售后窗口 | 资金释放 |
 * |---|---|---|---|
 * | **物流 (0)** | **不影响** | 确认收货/完成那一刻起 **7 天**（**不是**次日 0 点） | 完成 +7 天（并取「售后窗口关闭」「签收 + 7 天」中最晚者） |
 * | **同城 (2)** | **影响** | 送达**次日 0 点**起：普通 **7 天** / 生鲜 **48 小时** | 送达次日 0 点起：普通 **+7 天** / 生鲜 **+3 天** |
 * | **自提 (1)** | **不影响** | 支付起 **30 天**；**核销后一律不可退** | 核销 + 1 天 |
 *
 * ⇒ 订单上出现 `timingCategory = 1` **只说明下单快照是生鲜**，
 *   **物流单与自提单的时效不因它改变** ⇒ 前端**绝不能**拿它去推断物流/自提的售后窗口，
 *   也**绝不能**在物流/自提单上写「次日 0 点」或「48 小时」（Step2 §二、Step3 §二 反复强调）。
 *
 * ## ⚠️ 与「售后类型」正交（Step1 §四）
 * `timingCategory`（时效档位：多久能退 / 钱何时可提）与 `afterSaleType`（售后流程形态：仅退款 / 退货退款）
 * **互不推导** —— 生鲜商品也可能被配成"退货退款"。两者是两个独立表单项，不要用其中一个推另一个。
 */

/** 时效档位：**0 = 普通**（商超、日用等）；后端不传即为 0。 */
export const TIMING_CATEGORY_NORMAL = 0
/** 时效档位：**1 = 生鲜 · 鲜活易腐**（生鲜、水产、肉、鲜花等）。 */
export const TIMING_CATEGORY_FRESH = 1

/**
 * 归一化后端下发的时效档位：只有**明确是 1 / '1' / true** 才算生鲜，其余（含 `null` / 缺失 / 空串）一律按**普通**。
 *
 * ⚠️ 与配送开关不同，这里把"缺失"按普通处理是**安全**的：普通是后端默认值，
 *    而且本字段**只用于文案展示**（写库路径在商品编辑页，那里走的是「回显拿不到就不提交」的守卫）。
 */
export function normalizeTimingCategory(value: unknown): 0 | 1 {
  return value === 1 || value === '1' || value === true ? TIMING_CATEGORY_FRESH : TIMING_CATEGORY_NORMAL
}

/** 是否为「生鲜 · 鲜活易腐」档位。 */
export function isFreshTiming(value: unknown): boolean {
  return normalizeTimingCategory(value) === TIMING_CATEGORY_FRESH
}

/** 配送方式（与订单 `pickupType` 同口径，不要另立枚举）。 */
export const PICKUP_TYPE_LOGISTICS = 0
export const PICKUP_TYPE_SELF_PICKUP = 1
export const PICKUP_TYPE_SAME_CITY = 2

/* ------------------------------------------------------------------ *
 * 售后窗口文案（Step2 §三 / Step3 §二 的原文口径）
 * ------------------------------------------------------------------ */

/** **物流**售后窗口：与档位无关，恒为「确认收货后 7 天」。 */
export const AFTER_SALE_TEXT_LOGISTICS = '确认收货后 7 天内可申请售后'

/** **自提**售后窗口：与档位无关，恒为「支付后 30 天、核销后不可退」。 */
export const AFTER_SALE_TEXT_SELF_PICKUP = '支付后 30 天内可申请售后；核销后不可退'

/** **同城 · 普通**售后窗口（Step2 §三-2 原文）。 */
export const AFTER_SALE_TEXT_SAME_CITY_NORMAL = '签收次日 0 点起 7 天内可申请售后'

/**
 * **同城 · 生鲜**售后窗口（Step2 §三-1 / Step3 §二 原文）。
 * ⚠️ 「质量问题不受此限，请联系客服」是**法规要求的兜底出口**，不要精简掉。
 */
export const AFTER_SALE_TEXT_SAME_CITY_FRESH =
  '生鲜/鲜活易腐：签收次日 0 点起 48 小时内可申请售后；质量问题不受此限，请联系客服'

/** 配送方式的中文名（与 C 端选择的三个配送到家方式一致）。 */
export const PICKUP_TYPE_LABELS: Record<number, string> = {
  [PICKUP_TYPE_LOGISTICS]: '物流快递',
  [PICKUP_TYPE_SELF_PICKUP]: '门店自提',
  [PICKUP_TYPE_SAME_CITY]: '同城配送',
}

/** {@link afterSaleTextsForProduct} 的入参：只取判定需要的三个配送开关 + 档位。 */
export interface ProductTimingFields {
  pickupEnabled?: 0 | 1 | '0' | '1' | boolean | null
  deliveryEnabled?: 0 | 1 | '0' | '1' | boolean | null
  sameCityEnabled?: 0 | 1 | '0' | '1' | boolean | null
  timingCategory?: 0 | 1 | '0' | '1' | boolean | null
}

/** 一条「配送方式 → 售后说明」条目。 */
export interface AfterSaleRuleItem {
  /** 配送方式中文名（用于列表前缀）。 */
  label: string
  /** 售后说明正文。 */
  text: string
}

/**
 * **C 端商品详情**用：按该商品**支持的配送方式**给出 1~3 条售后说明（Step3 §二 表格）。
 *
 * ⚠️ 为什么是"多条"而不是一条：商品详情页**不知道用户最终选哪种配送方式**，
 *    所以只能把该商品支持的每一种方式的窗口都如实列出来 —— 这正是文档表格的三行。
 *    后端 2026-09-29 起三个开关**各自独立**（`deliveryEnabled` 语义已收窄为"仅物流"），
 *    因此三个判断互不推导。
 * ⚠️ 开关"未下发"时**按支持处理**（后端默认 1，且详情页少列一条比多列一条更容易误导）。
 * ⚠️ 档位**只在同城那条分支被读取** —— 「物流/自提不因档位改变」这条边界
 *    是由**函数结构**保证的，不依赖调用方自觉（Step2 §二）。
 */
export function afterSaleTextsForProduct(product: ProductTimingFields | null | undefined): AfterSaleRuleItem[] {
  if (!product) return []
  const enabled = (value: unknown): boolean => !(value === 0 || value === '0' || value === false)
  const fresh = isFreshTiming(product.timingCategory)
  const items: AfterSaleRuleItem[] = []
  if (enabled(product.sameCityEnabled)) {
    items.push({
      label: PICKUP_TYPE_LABELS[PICKUP_TYPE_SAME_CITY],
      text: fresh ? AFTER_SALE_TEXT_SAME_CITY_FRESH : AFTER_SALE_TEXT_SAME_CITY_NORMAL,
    })
  }
  if (enabled(product.deliveryEnabled)) {
    items.push({ label: PICKUP_TYPE_LABELS[PICKUP_TYPE_LOGISTICS], text: AFTER_SALE_TEXT_LOGISTICS })
  }
  if (enabled(product.pickupEnabled)) {
    items.push({ label: PICKUP_TYPE_LABELS[PICKUP_TYPE_SELF_PICKUP], text: AFTER_SALE_TEXT_SELF_PICKUP })
  }
  return items
}

/* ------------------------------------------------------------------ *
 * 资金释放口径（商家端「钱什么时候能提现」用，Step2 §三-3 / §一）
 * ------------------------------------------------------------------ */

/**
 * **同城**资金释放规则文案（Step2 §三-3 原文口径）。
 *
 * ⚠️ 起算点由原来的「订单完成后 7 天」改为「**送达次日 0 点**」，并**按档位分叉**
 *    （普通 +7 天 / 生鲜 +3 天，后端 `TimeWindow.SAME_CITY_FRESH_AFTER_SALE_WINDOW`），
 *    且**不早于售后窗口关闭**。
 * ⚠️ 同城单**送达后不会立即入账**（2026-10-08 后端修复：此前"送达即可提现"是缺陷）
 *    ⇒ 商家端「待结算」金额会持续到释放期到，**这是预期，不是卡单**。
 * ⚠️ **物流与自提两行未变**（Step2 §二 明确要求"不要跟着改"）。
 * 释放期口径表另见 `api/settlement.ts` 的 `SettlementAccountVO.pendingSettlementAmount` 注释。
 */
export const SETTLEMENT_RELEASE_TEXT_SAME_CITY = '送达次日 0 点起，普通 +7 天 / 生鲜 +3 天'
