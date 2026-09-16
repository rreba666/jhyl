import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createShop, deleteShop, getEnabledShops, getShops, restoreShop, updateShop, updateShopStatus } from '@/api/shop'
import type { Shop, ShopCreateDTO, ShopPageResult, ShopStatus } from '@/types/shop'
import { runBatch } from '@/utils/runBatch'

export const useShopStore = defineStore('shop', () => {
  const list = ref<ShopPageResult['list']>([])
  const enabledList = ref<Shop[]>([])
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref(false)
  const enabledLoading = ref(false)
  const page = ref(1)
  const pageSize = ref(10)
  /** 门店搜索关键词（纯数字按 ID，否则按名称模糊）。 */
  const keyword = ref('')

  /** 加载门店分页列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getShops(page.value, pageSize.value, keyword.value)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 加载启用门店，供店员表单复用。 */
  async function fetchEnabled(): Promise<Shop[]> {
    if (enabledList.value.length) return enabledList.value
    enabledLoading.value = true
    try {
      enabledList.value = await getEnabledShops()
      return enabledList.value
    } finally {
      enabledLoading.value = false
    }
  }

  /** 保存门店并刷新列表及缓存。 */
  async function save(id: string | undefined, payload: ShopCreateDTO): Promise<void> {
    saving.value = true
    try {
      if (id) await updateShop(id, payload)
      else await createShop(payload)
      enabledList.value = []
      await fetchList()
    } finally {
      saving.value = false
    }
  }

  /** 更新门店状态并同步本地行数据。 */
  async function setStatus(shop: Shop, status: ShopStatus): Promise<void> {
    actionLoading.value = true
    try {
      await updateShopStatus(shop.id, status)
      shop.status = status
      enabledList.value = []
    } finally {
      actionLoading.value = false
    }
  }

  /** 软删除单个门店并刷新列表。 */
  async function remove(id: string): Promise<void> {
    actionLoading.value = true
    try {
      await deleteShop(id)
      enabledList.value = []
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量软删除门店，复用单条接口并限制并发数。 */
  async function removeBatch(ids: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (!uniqueIds.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(uniqueIds, (id) => deleteShop(id), 3)
      enabledList.value = []
      await fetchList()
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally {
      actionLoading.value = false
    }
  }

  /** 恢复单个已删除门店并刷新列表。 */
  async function restore(id: string): Promise<void> {
    actionLoading.value = true
    try {
      await restoreShop(id)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量恢复门店，复用单条恢复接口并限制并发数。 */
  async function restoreBatch(ids: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (!uniqueIds.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(uniqueIds, (id) => restoreShop(id), 3)
      await fetchList()
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally {
      actionLoading.value = false
    }
  }

  return { list, enabledList, total, loading, saving, actionLoading, enabledLoading, page, pageSize, keyword, fetchList, fetchEnabled, save, setStatus, remove, removeBatch, restore, restoreBatch }
})
