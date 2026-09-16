import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createHomepageConfig,
  deleteHomepageConfig,
  getHomepageConfigs,
  updateHomepageConfig,
  uploadHomepageFile,
} from '@/api/homepage'
import type { HomepageConfigSaveDTO, HomepageConfigUpdateDTO, HomepageConfigVO } from '@/types/homepage'

export const useHomepageStore = defineStore('homepage', () => {
  const list = ref<HomepageConfigVO[]>([])
  const recommendedProducts = ref<import('@/types/homepage').HomepageProductCard[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const uploading = ref(false)

  /** 查询主页配置并同步服务端最新列表。 */
  async function loadConfigs(): Promise<void> {
    loading.value = true
    try {
      const result = await getHomepageConfigs()
      list.value = result.list
      recommendedProducts.value = result.recommendedProducts
    } finally {
      loading.value = false
    }
  }

  /** 新增主页配置并重新加载服务端数据。 */
  async function createConfig(payload: HomepageConfigSaveDTO): Promise<void> {
    saving.value = true
    try {
      await createHomepageConfig(payload)
      await loadConfigs()
    } finally {
      saving.value = false
    }
  }

  /** 修改指定 ID 的主页配置并重新加载服务端数据。 */
  async function updateConfig(id: number | string, payload: HomepageConfigUpdateDTO): Promise<void> {
    saving.value = true
    try {
      await updateHomepageConfig(id, payload)
      await loadConfigs()
    } finally {
      saving.value = false
    }
  }

  /** 删除指定 ID 的主页配置并重新加载服务端数据。 */
  async function removeConfig(id: number | string): Promise<void> {
    saving.value = true
    try {
      await deleteHomepageConfig(id)
      await loadConfigs()
    } finally {
      saving.value = false
    }
  }

  /** 上传主页媒体文件并返回后端生成的地址。 */
  async function uploadFile(file: File): Promise<string> {
    uploading.value = true
    try {
      return await uploadHomepageFile(file)
    } finally {
      uploading.value = false
    }
  }

  return { list, recommendedProducts, loading, saving, uploading, loadConfigs, createConfig, updateConfig, removeConfig, uploadFile }
})
