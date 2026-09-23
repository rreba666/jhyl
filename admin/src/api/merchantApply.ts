import { request } from './request'

/**
 * 入驻申请审核（中控后台）接口层。
 *
 * 依据：`api_doc.json` 的 `/api/admin/merchant-apply/**`（2026-09-25 核对）。
 *
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/merchant-apply/list` | 列表（`status` / `keyword` / `page` / `pageSize`） |
 * | POST | `/api/admin/merchant-apply/{applyId}/approve` | 审核通过（**无请求体**） |
 * | POST | `/api/admin/merchant-apply/{applyId}/reject` | 驳回（`reason` 是 **query 参数**） |
 *
 * ⚠️⚠️ 三个易错点（照做，别改）：
 * 1. **没有详情接口**：`/api/admin/merchant-apply/{applyId}` 只返回 `ResultVoid`
 *    ⇒ 审核要用的字段（身份证/门店图/执照）**只能从 list 里拿**。
 * 2. **`reject` 的 `reason` 在 query 上**，不是请求体；且后端要求必填（会展示给申请人）。
 * 3. **`approve` 不带 body** —— 传了也没用。
 *
 * 与旧入口的关系：`admin/src/views/merchants/index.vue` 走的是 `/api/admin/merchants/{id}`
 * （品牌停用/启用，`status=2` 即驳回）；本模块是**按申请单**审核的新入口，两者并存。
 */

/** 申请单状态：0 待审核 / 1 已通过 / 2 已驳回。 */
export type MerchantApplyStatus = 0 | 1 | 2

/** 入驻申请（中控后台视图，对应 `AdminMerchantApplyVO`）。 */
export interface AdminMerchantApplyVO {
  /** 申请 ID（审核接口用它）。 */
  applyId: number
  /** 申请人（C 端用户 ID）。 */
  userId?: number
  /** 品牌商家 ID（申请时即创建，status=0 待审核）。 */
  merchantId?: number
  /** 首店 ID（申请时即创建，status=0 待启用）。 */
  shopId?: number
  brandName: string
  contactName?: string
  contactPhone?: string
  shopName?: string
  shopAddress?: string
  province?: string
  city?: string
  district?: string
  /** 纬度（GCJ-02）。 */
  latitude?: number
  /** 经度（GCJ-02）。 */
  longitude?: number
  /** 首店门头图 URL（**审核要看门店长什么样**）。 */
  shopImage?: string
  /** 身份证号。 */
  idCard?: string
  /** 身份证正面照。 */
  idCardFrontImage?: string
  /** 身份证反面照。 */
  idCardBackImage?: string
  mainBusiness?: string
  /** 营业执照图片 URL（后端注释写着"**驳回最常见依据**"）。 */
  licenseImage?: string
  /** 申请人填写的备注。 */
  remark?: string
  status: MerchantApplyStatus
  statusText?: string
  /** 驳回原因（仅 `status=2` 有值；中控驳回时必填，同时会展示给申请人）。 */
  rejectReason?: string
  applyTime?: string
  auditTime?: string
  auditorId?: number
  auditorName?: string
}

/** 列表查询参数。 */
export interface MerchantApplyQuery {
  /** 状态：0 待审核 / 1 已通过 / 2 已驳回；不传 = 全部。 */
  status?: MerchantApplyStatus
  /** 关键字：品牌名 / 联系人 / 联系电话（模糊）。 */
  keyword?: string
  page?: number
  pageSize?: number
}

/** 分页结果。 */
export interface MerchantApplyPageResult {
  total: number
  list: AdminMerchantApplyVO[]
  page: number
  pageSize: number
}

interface MerchantApplyResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}

function unwrap<T>(response: { data: MerchantApplyResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

/** 数字兜底。 */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 归一化单条：身份证/门店图等可空字段一律保留 `undefined`，页面按"未上传"处理。 */
function normalize(value: unknown): AdminMerchantApplyVO {
  const row = (value || {}) as Partial<AdminMerchantApplyVO>
  const rawStatus = toNumber(row.status)
  return {
    ...(row as AdminMerchantApplyVO),
    applyId: toNumber(row.applyId),
    brandName: String(row.brandName ?? ''),
    status: (rawStatus === 1 ? 1 : rawStatus === 2 ? 2 : 0) as MerchantApplyStatus,
  }
}

/** 入驻申请列表（默认建议 `status=0` 只看待审核）。 */
export async function getMerchantApplyList(params: MerchantApplyQuery): Promise<MerchantApplyPageResult> {
  const data = unwrap(
    await request.get<MerchantApplyResponse<MerchantApplyPageResult>>('/api/admin/merchant-apply/list', { params }),
    '入驻申请查询失败',
  )
  const row = (data || {}) as Partial<MerchantApplyPageResult>
  const list = Array.isArray(row.list) ? row.list.map(normalize) : []
  return {
    total: toNumber(row.total, list.length),
    list,
    page: toNumber(row.page, params.page || 1),
    pageSize: toNumber(row.pageSize, params.pageSize || 10),
  }
}

/**
 * 审核通过。
 * 联动：品牌 `0待审核 → 1启用`、启用该品牌全部门店、申请单置 APPROVED（写审核人与时间）、
 * 给申请人自动赋 `MERCHANT_OWNER` 身份并绑定微信。
 */
export async function approveMerchantApply(applyId: number): Promise<void> {
  unwrap(
    await request.post<MerchantApplyResponse<null>>(`/api/admin/merchant-apply/${applyId}/approve`),
    '审核通过失败',
  )
}

/**
 * 驳回。
 * ⚠️ `reason` 走 **query**（不是 body），且**必填** —— 它会展示给申请人（小程序「我的入驻申请」）。
 * 联动：品牌 → 禁用、停用该品牌全部门店、申请单置 REJECTED。
 */
export async function rejectMerchantApply(applyId: number, reason: string): Promise<void> {
  unwrap(
    await request.post<MerchantApplyResponse<null>>(
      `/api/admin/merchant-apply/${applyId}/reject`,
      null,
      { params: { reason } },
    ),
    '驳回失败',
  )
}
