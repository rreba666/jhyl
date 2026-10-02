/** 商户（品牌）状态：0=待审核, 1=启用, 2=禁用。 */
export type MerchantStatus = 0 | 1 | 2

/** 商户（品牌商家）实体（后端 MerchantVO）。id 为 long，前端按 string 处理。 */
export interface MerchantVO {
  id: string
  brandId: string
  brandName: string
  contactName: string
  contactPhone: string
  status: MerchantStatus
  remark: string
  /** 门店数（列表接口含）。 */
  shopCount?: number
  /**
   * 商户级**让利比例**（%）—— 2026-09-30 后端新增，**已部署**。
   *
   * ⚠️ 取值区间 **3~20**（⚠️ **不是 5~20**；后端强校验，越界返回 `13018`）。
   * ⚠️ `null` = 未设置（按平台默认）。
   * ⚠️ 它**参与结算**（按**订单快照**，只影响之后新下的订单）——
   *    契约里此前写的"仅存档预留、不参与结算"是**过期描述**，后端已于 2026-09-30 更正。
   * ⚠️ 这是**商户级**配置，对该商户下**所有门店**生效；门店级 `commission_rate` **不生效**（仅历史存档）。
   */
  commissionRate?: number | null
  /**
   * **物流单专用**让利比例（%）—— 2026-10-03 后端新增（P4）。
   *
   * ✅ **后端已补齐该字段（2026-10-03 晚，jar `870f9d98…`）**：
   * `MerchantVO` 已含此字段，且**列表与详情共用同一个 `toVO`** ⇒ **两处都会返回**（不必"进详情再取"）。
   * ⚠️ 该 VO 走 `@JsonInclude(NON_NULL)` ⇒ **值为 NULL（= 跟随品牌级）时该键被省略**，
   * 前端拿到的是 **`undefined`（不是 `null`）** ⇒ ⚠️ **不要写 `=== null` 判断**，
   * 用 `typeof x === 'number'` 判断即可（本页正是这样做的）。
   *
   * ⚠️ 语义（P4 §一）：取值 **3~20**；**不传 = 不修改**；
   *    **留空/不设 = 沿用品牌级 `commissionRate`**（**仅物流单**生效，自提/同城仍用品牌级）。
   * ⚠️ 与 `commissionRate` 一样在**下单时快照**，只影响之后新下的订单。
   */
  logisticsCommissionRate?: number | null
  createTime?: string
}

/** 商户分页结果。 */
export interface MerchantPageResult {
  total: number
  list: MerchantVO[]
  page: number
  pageSize: number
}

/** 商户列表查询参数。 */
export interface MerchantFilters {
  keyword: string
  status: '' | MerchantStatus
}

/** 新增/编辑商户请求体。 */
export interface MerchantCreateDTO {
  brandId?: string
  brandName: string
  contactName?: string
  contactPhone?: string
  remark?: string
}

/**
 * **编辑**商户请求体（对应契约 `MerchantUpdateDTO`）—— 2026-09-30 新增。
 *
 * ⚠️ 为什么不复用 `MerchantCreateDTO`：契约里 `PUT /api/admin/merchants/{id}` 的 body 是
 *    `MerchantUpdateDTO`（就是下面这些字段），而 `MerchantCreateDTO` 还带着注册专用字段（`brandId`）。
 *    两者混用会让"到底哪些字段真的会被后端接收"变得含糊 —— 此前 `updateMerchant` 正是误用了 `MerchantCreateDTO`。
 *
 * ⚠️ **`commissionRate` 不传 = 不修改**（后端明确约定，避免老调用方把值清成 0）。
 *    ⇒ 只想改让利比例时，**仍必须带上 `brandName`**（它是必填），否则参数校验不过。
 */
export interface MerchantUpdateDTO {
  /** 品牌名（**必填**，后端要求）。 */
  brandName: string
  /** 联系人姓名。 */
  contactName?: string
  /** 联系人电话。 */
  contactPhone?: string
  /** 备注。 */
  remark?: string
  /** 让利比例（%，**取值 3~20**）；⚠️ **不传 = 不修改**。越界后端返回 `13018`。 */
  commissionRate?: number
  /**
   * **物流单专用**让利比例（%，**取值 3~20**，2026-10-03 P4 新增）。
   *
   * ⚠️ **不传 = 不修改**；**留空/不设 = 沿用品牌级 `commissionRate`**
   *    （⇒ 想恢复"跟随品牌级"时，前端**不能传 0**，只能**不传该字段**，否则会被 3~20 校验拒）。
   * ⚠️ **仅对物流单生效**，自提/同城仍用品牌级 `commissionRate`。
   */
  logisticsCommissionRate?: number
}

/** 商户接口统一响应结构。 */
export interface MerchantResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
