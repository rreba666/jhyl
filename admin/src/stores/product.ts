import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { getAdminProductDetail, getAdminProducts, getProductCategories, saveAdminProduct, deleteAdminProduct, uploadProductFile } from '@/api/product'
import type {
  CategoryNode,
  ProductDetail,
  ProductFilters,
  ProductPageResult,
  ProductQueryParams,
  ProductSortBy,
  AdminProductSaveDTO,
} from '@/types/product'

export const useProductStore = defineStore('product', () => {
  const list = ref<ProductPageResult['list']>([])
  const total = ref(0)
  const loading = ref(false)
  const detail = ref<ProductDetail | null>(null)
  const detailLoading = ref(false)
  const categories = ref<CategoryNode[]>([])
  const categoriesLoading = ref(false)
  const saveLoading = ref(false)
  const deleteLoading = ref(false)
  const uploading = ref(false)
  const page = ref(1)
  const pageSize = ref(10)
  const filters = reactive<ProductFilters>({ keyword: '', categoryId: '', originPlace: '', sortBy: '' })

  /** 将筛选状态转换为后端查询参数。 */
  function getQueryParams(): ProductQueryParams {
    return {
      page: page.value,
      pageSize: pageSize.value,
      ...(filters.keyword ? { keyword: filters.keyword } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.originPlace ? { originPlace: filters.originPlace } : {}),
      ...(filters.sortBy ? { sortBy: filters.sortBy as ProductSortBy } : {}),
    }
  }

  /** 加载商品分页列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getAdminProducts(getQueryParams())
      list.value = result.list || []
      total.value = Number(result.total) || 0
    } finally {
      loading.value = false
    }
  }

  /** 加载指定商品详情。 */
  async function fetchDetail(productId: string): Promise<void> {
    detailLoading.value = true
    detail.value = null
    try {
      detail.value = await getAdminProductDetail(productId)
    } finally {
      detailLoading.value = false
    }
  }

  /** 加载商品分类树并缓存当前结果。 */
  async function fetchCategories(): Promise<void> {
    if (categories.value.length) return
    categoriesLoading.value = true
    try {
      categories.value = await getProductCategories()
    } finally {
      categoriesLoading.value = false
    }
  }

  /** 保存商品并刷新后台列表。 */
  async function saveProduct(payload: AdminProductSaveDTO): Promise<void> {
    saveLoading.value = true
    try {
      await saveAdminProduct(payload)
      await fetchList()
    } finally {
      saveLoading.value = false
    }
  }

  /** 删除商品并刷新后台列表。 */
  async function removeProduct(productId: string): Promise<void> {
    deleteLoading.value = true
    try {
      await deleteAdminProduct(productId)
      await fetchList()
    } finally {
      deleteLoading.value = false
    }
  }

  /** 批量删除商品，使用受控并发并在全部任务结束后统一刷新列表。 */
  async function removeProducts(productIds: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(productIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    deleteLoading.value = true
    const successIds: string[] = []
    const failedIds: string[] = []
    let cursor = 0
    async function worker(): Promise<void> {
      while (cursor < ids.length) {
        const id = ids[cursor]
        cursor += 1
        try {
          await deleteAdminProduct(id)
          successIds.push(id)
        } catch {
          failedIds.push(id)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, () => worker()))
      if (!list.value.length && page.value > 1) page.value -= 1
      await fetchList()
      return { successIds, failedIds }
    } finally {
      deleteLoading.value = false
    }
  }

  async function uploadFile(file: File): Promise<string> {
    uploading.value = true
    try {
      return await uploadProductFile(file)
    } finally {
      uploading.value = false
    }
  }

  function resetFilters(): void {
    Object.assign(filters, { keyword: '', categoryId: '', originPlace: '', sortBy: '' })
    page.value = 1
  }

  return {
    list,
    total,
    loading,
    detail,
    detailLoading,
    categories,
    categoriesLoading,
    page,
    pageSize,
    filters,
    getQueryParams,
    fetchList,
    fetchDetail,
    fetchCategories,
    resetFilters,
    saveLoading,
    deleteLoading,
    uploading,
    saveProduct,
    removeProduct,
    removeProducts,
    uploadFile,
  }
})
