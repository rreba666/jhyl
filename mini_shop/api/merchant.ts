import { request } from '@/utils/request'

/** 首店信息（入驻必填）。 */
export interface MerchantApplyShopDTO {
  name: string
  address?: string
  province?: string
  city?: string
  district?: string
  latitude?: number
  longitude?: number
  mainBusiness?: string
}

/** 入驻申请请求体。 */
export interface MerchantApplyDTO {
  /** 品牌名称（必填）。 */
  brandName: string
  contactName?: string
  contactPhone?: string
  /** 首店（必填）。 */
  shop: MerchantApplyShopDTO
  /** 营业执照图 URL。 */
  licenseImage?: string
  remark?: string
}

/** 申请单状态：0 待审核 / 1 已通过 / 2 已驳回。 */
export type MerchantApplyStatus = 0 | 1 | 2

/** 我的入驻申请。 */
export interface MerchantApplyVO {
  applyId?: number
  merchantId?: number
  shopId?: number
  status: MerchantApplyStatus
  statusText?: string
  brandName?: string
  shopName?: string
  /** 审核意见：**仅 status=2（已驳回）有值**，内容即驳回原因；其他状态为 null。 */
  auditRemark?: string
  /** 上一次被驳回的原因（驳回后重新提交、status=0 时仍返回），无驳回历史为 null。 */
  previousRejectReason?: string
  /** 客服是否已发号（工号+密码都已设才为 true）。 */
  backendAccountIssued?: boolean
  accountUsername?: string
  accountBound?: boolean
  applyTime?: string
  auditTime?: string
}

/** 提交入驻申请（需 C 端登录态）。重复提交 → code 7315「您有正在审核中的入驻申请」。 */
export function submitMerchantApply(payload: MerchantApplyDTO): Promise<MerchantApplyVO> {
  return request<MerchantApplyVO>({ url: '/api/merchant/apply', method: 'POST', data: payload })
}

/** 我的申请（无则返回 null），用于页面状态机。 */
export function getMyMerchantApply(): Promise<MerchantApplyVO | null> {
  return request<MerchantApplyVO | null>({ url: '/api/merchant/apply/my', method: 'GET' })
}

// ===== 商家端 · 商品管理（/api/merchant/products/**） =====

/**
 * SKU 规格明细（**列表返回**）。
 * ⚠️ 字段名**以实际响应为准**：`{skuId, specName, price, stock}`。
 * 2026-09-19 复核 `api_doc.json` 与真实响应后修正 —— 此前这里写的是 `id` / `skuName`，
 * 导致编辑商品回填时规格名读不到（变成空串，一提交就报「请填写规格名称」）。
 * 提交用的结构与 `MerchantSkuItem` 一致（`{specName, price, stock}`）。
 */
export interface MerchantSkuVO {
  /** SKU ID（下单时标识具体规格）。 */
  skuId?: number
  /** 规格名称（文本摘要，如「大果-5斤装」）。 */
  specName?: string
  /** 规格售价（下单成交价，元）。 */
  price?: number
  /** 当前库存。 */
  stock?: number
}

/** 商品目录列表项（对应 MerchantProductVO）。 */
export interface MerchantProductVO {
  /** 商品 ID。 */
  productId?: number
  /** 商品名称。 */
  name?: string
  /** 商品主图。 */
  mainImage?: string
  /** 商品最低价（品牌价）。 */
  minPrice?: number
  /** 商品最高价（品牌价）。 */
  maxPrice?: number
  /** 商品总库存（品牌级维护，= 该商品下所有启用 SKU 的 stock 之和，查询时实时聚合）。 */
  totalStock?: number
  /** 商品全局状态：0=下架, 1=上架（品牌中控维护，非门店控制）。 */
  productStatus?: number
  /** 本店上架状态：0=下架, 1=上架（门店控制）。 */
  shopStatus?: number
  /** 门店价（覆盖品牌价，NULL=用品牌价）。 */
  shopPrice?: number | null
  /** 门店库存（NULL=用商品总库存）。 */
  shopStock?: number | null
  /** 启用规格数（=1 单规格；>1 多规格商品，改门店价会统一作用于全部规格）。 */
  skuCount?: number
  /** 启用规格明细（编辑页回填；size 恒等于 skuCount）。 */
  skus?: MerchantSkuVO[]
}

/** 商品目录分页结果。 */
export interface MerchantProductPageResult {
  total: number
  list: MerchantProductVO[]
  page: number
  pageSize: number
}

/** 商品目录查询参数。 */
export interface MerchantProductQuery {
  /** 商品名模糊搜索。 */
  keyword?: string
  /** 本店上架状态过滤：1=已上架, 0=未上架, 空=全部。 */
  status?: 0 | 1 | ''
  page?: number
  pageSize?: number
}

/** 商品目录列表（含本店上架状态）。 */
export function getMerchantProducts(params: MerchantProductQuery = {}): Promise<MerchantProductPageResult> {
  return request<MerchantProductPageResult>({
    url: '/api/merchant/products',
    method: 'GET',
    data: params,
  })
}

/** 门店上架/下架单个商品。status: 1=上架, 0=下架。 */
export function updateProductStatus(productId: number, status: 0 | 1): Promise<void> {
  return request<void>({ url: `/api/merchant/products/${productId}/status?status=${status}`, method: 'PUT' })
}

/** 设置门店库存。stock 传数值即单独控库存。 */
export function updateProductStock(productId: number, stock: number): Promise<void> {
  return request<void>({ url: `/api/merchant/products/${productId}/stock?stock=${stock}`, method: 'PUT' })
}

/** 设置门店价。 */
export function updateProductPrice(productId: number, price: number): Promise<void> {
  return request<void>({ url: `/api/merchant/products/${productId}/price?price=${price}`, method: 'PUT' })
}

/** 批量上架/下架。status: 1=上架, 0=下架。 */
export function batchUpdateProducts(productIds: number[], status: 0 | 1): Promise<void> {
  return request<void>({
    url: '/api/merchant/products/batch',
    method: 'POST',
    data: { productIds, status },
  })
}

// ===== 商家端 · 订单（/api/merchant/orders，只读） =====

/** 订单商品行（卡片与详情共用）。 */
export interface MerchantOrderItemVO {
  productImage?: string
  productName?: string
  skuSpec?: string
  quantity?: number
  price?: number
}

/** 订单列表卡片（对应 MerchantOrderCardVO）。 */
export interface MerchantOrderCardVO {
  /** 订单号（卡片头部 + 复制按钮）。 */
  orderNo?: string
  /** 卡片短号（订单号后 4 位，仅展示）。 */
  shortNo?: string
  /** 交易状态：0待支付/1履约中或待核销/4已完成/5已关闭/7已退款/8已核销。 */
  status?: number
  /** 状态文案（按配送形态给出，直接用）。 */
  statusDesc?: string
  /** 配送形态：0 物流 / 1 自提 / 2 同城。 */
  pickupType?: number
  /** 收货人姓名。 */
  receiverName?: string
  /** 收货人手机号（明文下发，UI 打星）。 */
  receiverPhone?: string
  /** 收货地址（自提单为空）。 */
  receiverAddress?: string
  /** 商品行。 */
  items?: MerchantOrderItemVO[]
  /** 商品行数（明细行数）。 */
  itemCount?: number
  /** 商品总件数。 */
  totalQuantity?: number
  /** 商品合计（「合计 ¥39.7」）。 */
  totalAmount?: number
  /** 用户实付（含配送费）。 */
  payAmount?: number
  /** 用户支付的配送费。 */
  deliveryFee?: number
  /** 同城履约状态（非同城为 null；用于区分配送中卡片 B 型）。 */
  deliveryStatus?: string | null
  /** 配送员姓名（配送中卡片「张三-待取货」的骑手名；未派单为 null）。 */
  deliveryPersonName?: string | null
  /** 异常说明（异常单卡片「异常原因：…」，后端若下发则显示）。 */
  exceptionRemark?: string | null
  /** 下单时间。 */
  createTime?: string
  /** 支付时间。 */
  payTime?: string
}

/** 订单详情（列表字段 + 详情扩展字段；null = 该形态无此行）。 */
export interface MerchantOrderDetailVO extends MerchantOrderCardVO {
  /** 配送员手机号（拨号）。 */
  deliveryPersonPhone?: string | null
  /** 取货时间。 */
  pickedUpAt?: string | null
  /** 送达时间。 */
  deliveredAt?: string | null
  /** 配送时长（分钟，净时长=取货→送达，已扣暂停；未送达为 null）。 */
  deliveryDurationMinutes?: number | null
  /** 配送距离（km，已完成态「配送距离」行）。 */
  distanceKm?: number | null
  /** 暂停时长（分钟）。 */
  pausedMinutes?: number | null
  /** 异常类型。 */
  exceptionType?: string | null
  /** 异常说明（「异常原因：…」）。 */
  exceptionRemark?: string | null
  /** 送达照片 objectKey 列表（PHOTO 凭证）。 */
  proofs?: string[] | null
  /** 自提门店名。 */
  shopName?: string | null
  /** 自提码 / 收货码。 */
  pickupCode?: string | null
  /** 商品合计（详情金额，与 totalAmount 同义，后端二者其一）。 */
  goodsAmount?: number | null
  /** 订单备注 / 买家留言。 */
  remark?: string | null
}

/** 订单页签（6 个，同城履约视角）。 */
export type MerchantOrderTab = 'ALL' | 'WAIT_ACCEPT' | 'WAIT_PICKUP' | 'DELIVERING' | 'DONE' | 'EXCEPTION'

/** 订单列表查询参数。 */
export interface MerchantOrderQuery {
  tab?: MerchantOrderTab
  /** 订单号 / 收货人手机号（模糊）。 */
  keyword?: string
  /** 下单时间起（含）。 */
  startTime?: string
  /** 下单时间止（含）。 */
  endTime?: string
  page?: number
  pageSize?: number
}

/** 订单列表分页结果。 */
export interface MerchantOrderPageResult {
  total: number
  list: MerchantOrderCardVO[]
  page: number
  pageSize: number
}

/** 订单列表（6 页签，只读）。 */
export function getMerchantOrders(params: MerchantOrderQuery = {}): Promise<MerchantOrderPageResult> {
  return request<MerchantOrderPageResult>({
    url: '/api/merchant/orders',
    method: 'GET',
    data: params,
  })
}

/** 订单详情（4 形态，只读）。 */
export function getMerchantOrderDetail(orderNo: string): Promise<MerchantOrderDetailVO> {
  return request<MerchantOrderDetailVO>({
    url: `/api/merchant/orders/${encodeURIComponent(orderNo)}`,
    method: 'GET',
  })
}

/** 同城履约状态 → 中文文案（骑手胶囊 / 详情状态头）。 */
export const DELIVERY_STATUS_TEXT: Record<string, string> = {
  WAIT_ACCEPT: '待接单',
  ACCEPTED: '待取货',
  PREPARING: '待取货',
  WAIT_ASSIGN: '待取货',
  ASSIGNED: '待取货',
  PICKED_UP: '配送中',
  DELIVERING: '配送中',
  NEARBY: '配送中',
  PAUSED: '已暂停',
  DELIVERED: '已完成',
  COMPLETED: '已完成',
  EXCEPTION: '配送异常',
  CANCELLED: '已取消',
  CANCEL_REQUESTED: '取消申请中',
}

/** 是否为「进行中配送」状态（列表卡片 B 型：短号 + 骑手胶囊）。 */
export function isActiveDelivery(status?: string | null): boolean {
  return status != null && [
    'ACCEPTED', 'PREPARING', 'WAIT_ASSIGN', 'ASSIGNED',
    'PICKED_UP', 'DELIVERING', 'NEARBY', 'PAUSED', 'EXCEPTION',
  ].includes(status)
}

/** 手机号打码（明文下发，UI 截中间四位）。 */
export function maskPhone(phone?: string | null): string {
  const value = String(phone || '').replace(/\s/g, '')
  if (value.length < 7) return value || '—'
  return `${value.slice(0, 3)} **** ${value.slice(-4)}`
}

// ===== 商家端 · 新增/编辑商品（POST/PUT /api/merchant/products） =====

/** 规格项（扁平结构：一行一个可下单规格）。 */
export interface MerchantSkuItem {
  /** 规格名（如 950ml / 550ml / 330ml，或 单份/双份）。 */
  specName: string
  /** 规格售价（元，>0）。 */
  price: number
  /** 规格库存（件，≥0）。 */
  stock: number
}

/** 新增/编辑商品请求体（对应 MerchantProductSaveDTO）。 */
export interface MerchantProductSaveDTO {
  /** 商品标题（必填，≤60 字符）。 */
  title: string
  /** 主图（最多 5 张，第 1 张作列表主图；建议 800x800 正方形）。 */
  mainImages: string[]
  /** 详情描述（≤200 字）。 */
  description?: string
  /** 规格列表（必填，扁平结构）。 */
  skus: MerchantSkuItem[]
  /** 详情页图片（可空）。 */
  detailImages?: string[]
  /** 商品分类 ID（可空）。 */
  categoryId?: number
  /** 商品品牌 ID（可空）。 */
  goodsBrandId?: number
  /** 上架状态：1=在售（上架）, 0=仓库中（下架）；不传默认 0。 */
  status?: 0 | 1
}

/** 新增商品。 */
export function saveMerchantProduct(payload: MerchantProductSaveDTO): Promise<void> {
  return request<void>({ url: '/api/merchant/products', method: 'POST', data: payload })
}

/** 编辑商品。 */
export function updateMerchantProduct(productId: number, payload: MerchantProductSaveDTO): Promise<void> {
  return request<void>({ url: `/api/merchant/products/${productId}`, method: 'PUT', data: payload })
}

// ===== 商家端 · 账单（GET /api/merchant/bill，订单口径，只读） =====

/** 账单流水行。 */
export interface MerchantBillRecord {
  /** 行类型：INCOME 订单收入 / REFUND 订单退款。 */
  type?: string
  /** 类型文案。 */
  typeText?: string
  /** 方向：1=收入 2=支出。 */
  direction?: number
  /** 方向文案。 */
  directionText?: string
  /** 金额（恒正数，前端按 direction 加正负号）。 */
  amount?: number
  /** 发生时间。 */
  occurredAt?: string
  /** 图标标识：INCOME_ORDER / EXPENSE_REFUND（前端映射本地图标）。 */
  icon?: string
  /** 订单号。 */
  orderNo?: string
  /** 退款单号（收款行为 null）。 */
  bizNo?: string | null
}

/** 账单分页结果。 */
export interface MerchantBillVO {
  month?: string
  startTime?: string
  endTime?: string
  /** 收入合计。 */
  incomeTotal?: number
  /** 支出合计。 */
  expenseTotal?: number
  total?: number
  page?: number
  pageSize?: number
  records?: MerchantBillRecord[]
}

/** 账单查询参数。 */
export interface MerchantBillQuery {
  /** 月份 yyyy-MM（优先级最高）。 */
  month?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

/** 商家账单（订单口径，只读）。 */
export function getMerchantBill(params: MerchantBillQuery = {}): Promise<MerchantBillVO> {
  return request<MerchantBillVO>({
    url: '/api/merchant/bill',
    method: 'GET',
    data: params,
  })
}

// ===== 商家端 · 首页概览（GET /api/merchant/overview） =====

/** 商家首页概览（对应 MerchantOverviewVO）。 */
export interface MerchantOverviewVO {
  /** 今日下单数（含未支付/已关闭）。 */
  todayOrderCount?: number
  /** 今日成交额（今日已支付订单实付之和）。 */
  todayAmount?: number
  /** 订单口径净额 = 累计已支付实付 − 累计已退款实付（不是可提现余额）。 */
  balance?: number
  /** balance 的口径标识，恒 ORDER_NET。 */
  balanceScope?: string
  /** 待接单数（delivery_status=WAIT_ACCEPT）。 */
  pendingAcceptCount?: number
  /** 待取货数（ACCEPTED/PREPARING/WAIT_ASSIGN/ASSIGNED）。 */
  pendingPickupCount?: number
  /** 异常单数（delivery_status=EXCEPTION）。 */
  exceptionCount?: number
  /** 配送中数（`PICKED_UP/DELIVERING/NEARBY/PAUSED`，同订单页签 DELIVERING）——2026-09-19 后端补齐。 */
  deliveringCount?: number
  /** 已完成数（`DELIVERED/COMPLETED` 或自提已核销，同订单页签 DONE）——2026-09-19 后端补齐。 */
  doneCount?: number
  /**
   * 低库存商品数（本店已上架商品中品牌级总量 ≤ 100 件的数量）——2026-09-19 后端补齐。
   * 阈值 100 目前硬编码在后端；门店未绑定品牌商家时恒为 0。
   */
  lowStockCount?: number
  /**
   * 服务分（设计稿顶部数据条第三格）。
   * ⚠️ 后端标注为**占位字段（待开发）**：待开发期**不下发该键**（不是 `null` 值），
   * 前端按「未下发」显示「—」，**不要写 0**（0 会被商家理解成真实评分为 0 分）。
   */
  serviceScore?: number
}

/** 商家首页概览。 */
export function getMerchantOverview(shopId?: number): Promise<MerchantOverviewVO> {
  return request<MerchantOverviewVO>({
    url: '/api/merchant/overview',
    method: 'GET',
    data: shopId ? { shopId } : undefined,
  })
}
