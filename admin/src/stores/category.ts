import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createAdminCategory, deleteAdminCategory, getAdminCategories, updateAdminCategory } from '@/api/category'
import type { AdminCategory, AdminCategorySaveDTO } from '@/types/category'

export const useCategoryStore = defineStore('category', () => {
  const list = ref<AdminCategory[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const deleting = ref(false)

  /** 加载后台分类列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      list.value = await getAdminCategories()
    } finally {
      loading.value = false
    }
  }

  /** 新增分类并刷新服务端列表。 */
  async function create(payload: AdminCategorySaveDTO): Promise<void> {
    saving.value = true
    try {
      await createAdminCategory(payload)
      await fetchList()
    } finally {
      saving.value = false
    }
  }

  /** 修改分类并刷新服务端列表。 */
  async function update(id: string, payload: AdminCategorySaveDTO): Promise<void> {
    saving.value = true
    try {
      await updateAdminCategory(id, payload)
      await fetchList()
    } finally {
      saving.value = false
    }
  }

  /** 软删除分类并刷新服务端列表。 */
  async function remove(id: string): Promise<void> {
    deleting.value = true
    try {
      await deleteAdminCategory(id)
      await fetchList()
    } finally {
      deleting.value = false
    }
  }

  return { list, loading, saving, deleting, fetchList, create, update, remove }
})
