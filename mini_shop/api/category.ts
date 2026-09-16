import { request } from '@/utils/request'

/** 分类节点 */
export interface CategoryNode {
  id: string
  name: string
  icon: string
  children?: CategoryNode[]
}

/** 分类商品 */
export interface CategoryProduct {
  id: string
  name: string
  mainImage: string
  minPrice: number
  /** 描述标题（标题栏大字，最多两行）。 */
  descriptionTitle?: string
  /** 详情描述（下方说明，最多一行）。 */
  description?: string
  /** 商品产地（如「浙江-杭州」），来自商品自身信息。 */
  originPlace?: string
}

/** 分类商品分页 */
export interface CategoryProductPage {
  total: number
  page: number
  pageSize: number
  list: CategoryProduct[]
}

/** 查询商品分类列表 */
export function getCategoryList(): Promise<CategoryNode[]> {
  return request<CategoryNode[]>({ url: '/api/category/list', method: 'GET' })
}

/** 按分类ID分页查询商品 */
export function getCategoryProducts(categoryId: string, page?: number, pageSize?: number): Promise<CategoryProductPage> {
  const p = page ?? 1
  const ps = pageSize ?? 20
  return request<CategoryProductPage>({
    url: `/api/product/list?categoryId=${categoryId}&page=${p}&pageSize=${ps}`,
    method: 'GET',
  })
}

/** 商品品牌（品牌条用）。 */
export interface GoodsBrand {
  id: number
  name: string
  logo?: string
  sortOrder?: number
}

/** 查询某大类下的品牌（不分页，只返回启用品牌；不传 categoryId 返回全部启用品牌）。 */
export function getGoodsBrands(categoryId?: number): Promise<GoodsBrand[]> {
  const query = categoryId ? `?categoryId=${categoryId}` : ''
  return request<GoodsBrand[]>({ url: `/api/goods-brand/list${query}`, method: 'GET' })
}

/** 商品列表查询参数：categoryId（大类）与 goodsBrandId（品牌）可单独或组合使用。 */
export interface ProductListQuery {
  categoryId?: number | string
  goodsBrandId?: number | string
  page?: number
  pageSize?: number
}

/** 按分类 / 品牌分页查询商品（未选品牌时传 categoryId 取该大类全部商品）。 */
export function getProducts(params: ProductListQuery): Promise<CategoryProductPage> {
  const query = [
    params.categoryId ? `categoryId=${params.categoryId}` : '',
    params.goodsBrandId ? `goodsBrandId=${params.goodsBrandId}` : '',
    `page=${params.page ?? 1}`,
    `pageSize=${params.pageSize ?? 20}`,
  ].filter(Boolean).join('&')
  return request<CategoryProductPage>({ url: `/api/product/list?${query}`, method: 'GET' })
}
