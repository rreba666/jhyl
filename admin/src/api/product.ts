import { request } from './request'
import { extractMediaUrl, resolveMediaArray, resolveMediaUrl } from './media'
import { resolveDividendFund, resolvePromotionFund } from '@/utils/productPricing'
import type {
  AdminProductSavePayload,
  CategoryNode,
  ProductDetail,
  ProductFundStatusValue,
  ProductListItem,
  ProductPageResult,
  ProductQueryParams,
  ProductResponse,
} from '@/types/product'

/** 校验商品管理接口响应并返回业务数据。 */
function unwrapResponse<T>(response: { data: ProductResponse<T> }, fallbackMessage: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
  return result.data as T
}

/** 保留商品接口中的 BIGINT 字面量，避免 JSON.parse 先转换为不精确的 number。 */
function parseProductJson(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const preserved = data.replace(/(:\s*)(-?\d{16,})(\s*[,}])/g, '$1"$2"$3')
  return JSON.parse(preserved)
}

/** 将数组字段兼容为数组或 JSON 字符串。 */
function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : [value]
  } catch {
    return [value]
  }
}

/** 将后端返回的 0/1、数字字符串或布尔值统一为商品状态值。 */
function normalizeProductBinary(value: unknown): 0 | 1 {
  return value === 1 || value === '1' || value === true ? 1 : 0
}

/** 列表接口没有返回资金开关时保持未知，不能把缺失字段误判为禁用。 */
function normalizeProductBinaryOrNull(value: unknown): ProductFundStatusValue {
  if (value === undefined || value === null || value === '') return null
  return normalizeProductBinary(value)
}

type ProductFundStatusPatch = Pick<ProductListItem, 'promotionFund' | 'promotionEnabled' | 'dividendFund' | 'dividendEnabled'>

/** 缓存当前会话已经通过商品详情确认过的资金状态。 */
const fundStatusByProductId = new Map<string, ProductFundStatusPatch>()

/** 将商品接口响应中的长整型和媒体字段统一为前端模型。 */
function normalizeProductDetail(detail: ProductDetail): ProductDetail {
  return {
    ...detail,
    id: String(detail.id),
    categoryId: String(detail.categoryId),
    // ⚠️ 2026-09-30 多分类：后端未部署时该字段缺失 ⇒ 归一化成空数组，由填写方回退到 [categoryId]。
    //    `normalizeStringArray` 会用 `map(String)` 处理任意数组（数字不会丢）、且兼容 JSON 字符串形式，
    //    正好把后端的 `number[]` 统一成 el-select 需要的字符串值。
    categoryIds: normalizeStringArray(detail.categoryIds),
    minOriginalPrice: detail.minOriginalPrice == null ? undefined : Number(detail.minOriginalPrice),
    promotionFund: resolvePromotionFund(detail.promotionFund, detail.minPrice),
    promotionEnabled: normalizeProductBinaryOrNull(detail.promotionEnabled),
    dividendFund: resolveDividendFund(detail.dividendFund, detail.minPrice),
    dividendEnabled: normalizeProductBinaryOrNull(detail.dividendEnabled),
    recommendTextEnabled: normalizeProductBinary(detail.recommendTextEnabled),
    // 商品级配送方式开关：缺失 → null（保持「未知」），编辑页据此决定「不提交这两个字段」（不传=不修改）
    pickupEnabled: normalizeProductBinaryOrNull(detail.pickupEnabled),
    deliveryEnabled: normalizeProductBinaryOrNull(detail.deliveryEnabled),
    // 时效档位（2026-10-08 Step1）：与上面同理 —— **缺失 → null（未知）**，编辑页据此跳过提交。
    // ⚠️ 注意这里用的是 `OrNull`：`timingCategory=0`（普通）是**合法值**，必须原样保留成 0，
    //    绝不能被当成"没返回"而丢弃（否则商家把生鲜改回普通时会存不进去）。
    timingCategory: normalizeProductBinaryOrNull(detail.timingCategory),
    mainImage: resolveMediaUrl(detail.mainImage),
    images: resolveMediaArray(normalizeStringArray(detail.images)),
    videoUrl: detail.videoUrl || '',
    detailImages: resolveMediaArray(normalizeStringArray(detail.detailImages)),
    skuList: Array.isArray(detail.skuList)
      ? detail.skuList.map((sku) => ({
          ...sku,
          id: sku.id == null ? undefined : String(sku.id),
          enabled: sku.enabled ?? 1,
          originalPrice: sku.originalPrice == null ? undefined : Number(sku.originalPrice),
        }))
      : [],
  }
}

/** 将分页总数字段转换为有效非负整数。 */
function toTotal(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return undefined
}

/** 从不同分页包装结构中读取总数。 */
function getTotal(data: Record<string, unknown>, listLength: number): number {
  const candidates = [
    data.total,
    data.totalCount,
    data.count,
    data.totalElements,
    (data.pageInfo as Record<string, unknown> | undefined)?.total,
    (data.pagination as Record<string, unknown> | undefined)?.total,
  ]
  for (const candidate of candidates) {
    const total = toTotal(candidate)
    if (total !== undefined) return total
  }
  return listLength
}

/** 将商品列表中的长整型标识和分页字段统一归一化。 */
function normalizeProductList(result: ProductPageResult): ProductPageResult {
  const data = result as ProductPageResult & Record<string, unknown>
  const list = Array.isArray(data.list) ? data.list : []
  return {
    ...result,
    total: getTotal(data, list.length),
    page: toTotal(data.page) ?? 1,
    pageSize: toTotal(data.pageSize) ?? 10,
    list: list.map((item) => {
      const minPrice = Number(item.minPrice) || 0
      return {
        ...item,
        id: String(item.id),
        minPrice,
        minOriginalPrice: item.minOriginalPrice == null ? undefined : Number(item.minOriginalPrice),
        // 列表接口不返回资金金额，保持 undefined，避免用默认值误导；实际金额以详情接口为准
        promotionFund: item.promotionFund == null ? undefined : Number(item.promotionFund),
        promotionEnabled: normalizeProductBinaryOrNull(item.promotionEnabled),
        dividendFund: item.dividendFund == null ? undefined : Number(item.dividendFund),
        dividendEnabled: normalizeProductBinaryOrNull(item.dividendEnabled),
        mainImage: resolveMediaUrl(item.mainImage),
      }
    }),
  }
}

/**
 * 商品列表接口不含两项资金金额/开关时，按需用详情接口补齐，保证列表与编辑详情一致。
 * 详情读取失败时保留 null/undefined，让界面显示待查询或占位而不是伪造业务数据。
 */
async function hydrateProductFundStatuses(list: ProductListItem[]): Promise<ProductListItem[]> {
  const missingFundStatusIds = [...new Set(
    list
      .filter((item) => item.promotionFund == null || item.dividendFund == null || item.promotionEnabled == null || item.dividendEnabled == null)
      .map((item) => item.id),
  )]
  const unresolvedIds = missingFundStatusIds.filter((id) => !fundStatusByProductId.has(id))
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < unresolvedIds.length) {
      const productId = unresolvedIds[cursor]
      cursor += 1
      try {
        const detail = await getAdminProductDetail(productId)
        fundStatusByProductId.set(productId, {
          promotionFund: detail.promotionFund,
          promotionEnabled: detail.promotionEnabled,
          dividendFund: detail.dividendFund,
          dividendEnabled: detail.dividendEnabled,
        })
      } catch {
        fundStatusByProductId.set(productId, { promotionEnabled: null, dividendEnabled: null })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, unresolvedIds.length) }, () => worker()))
  return list.map((item) => {
    const patch = fundStatusByProductId.get(item.id)
    return patch ? { ...item, ...patch } : item
  })
}


/** 查询包含上下架商品的管理列表。 */
export async function getAdminProducts(params: ProductQueryParams): Promise<ProductPageResult> {
  const response = await request.get<ProductResponse<ProductPageResult>>('/api/admin/product/list', {
    params,
    transformResponse: [(data) => parseProductJson(data)],
  })
  const result = normalizeProductList(unwrapResponse(response, '商品列表查询失败'))
  return { ...result, list: await hydrateProductFundStatuses(result.list) }
}

/** 查询包含禁用 SKU 的后台商品详情。 */
export async function getAdminProductDetail(productId: string): Promise<ProductDetail> {
  const response = await request.get<ProductResponse<ProductDetail>>(`/api/admin/v2/product/detail/${productId}`, {
    transformResponse: [(data) => parseProductJson(data)],
  })
  return normalizeProductDetail(unwrapResponse(response, '商品详情查询失败'))
}

/** 新增或修改商品，是否修改由 payload.id 是否存在决定。 */
export async function saveAdminProduct(payload: AdminProductSavePayload): Promise<void> {
  const response = await request.post<ProductResponse<null>>('/api/admin/v2/product/save', payload, {
    transformResponse: [(data) => parseProductJson(data)],
  })
  unwrapResponse(response, '商品保存失败')
  if (payload.id) fundStatusByProductId.delete(String(payload.id))
}

/** 软删除商品及其 SKU。 */
export async function deleteAdminProduct(productId: string): Promise<void> {
  const response = await request.delete<ProductResponse<null>>(`/api/admin/product/${productId}`, {
    transformResponse: [(data) => parseProductJson(data)],
  })
  unwrapResponse(response, '商品删除失败')
}

/**
 * 将后台分类接口返回的数据转换为商品表单使用的**平级列表**。
 *
 * ⚠️ **2026-09-30 扁平化**：原实现是 `normalizeCategoryTree()` ——
 *    不仅重建了 `parentId` / `children`，还在前端**手动建树**
 *    （`nodeMap` + `parent.children.push`）。但后端已确认
 *    「分类是**扁平一层**、**实测无 `parent_id`**」⇒ 那些字段纯属前端臆造、
 *    建树逻辑也永远不会命中（`parentId` 全为 `'0'`，所有节点都成了根）。
 * ⇒ 现简化为**直接平级映射**，并改名以反映真实语义。
 */
function normalizeCategoryList(value: unknown): CategoryNode[] {
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as { list?: unknown } | null)?.list)
      ? (value as { list: unknown[] }).list
      : []
  return source.map((item) => {
    const raw = item as { id?: unknown; name?: unknown; icon?: unknown }
    return {
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      icon: String(raw.icon ?? ''),
    }
  })
}

/** 查询后台分类列表（**扁平一层**）。B 端使用平铺分类接口，不能复用 C 端 Token 接口。 */
export async function getProductCategories(): Promise<CategoryNode[]> {
  const response = await request.get<ProductResponse<unknown>>('/api/admin/category/list')
  return normalizeCategoryList(unwrapResponse(response, '商品分类查询失败'))
}

/** 上传商品媒体文件并返回 OSS 地址。 */
export async function uploadProductFile(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await request.post<ProductResponse<string>>('/api/admin/homepage/upload', formData)
  const url = extractMediaUrl(unwrapResponse(response, '商品文件上传失败'))
  if (!url) throw new Error('商品文件上传未返回地址')
  return url
}
