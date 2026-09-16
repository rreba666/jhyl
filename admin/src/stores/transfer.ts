import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getTransferList } from '@/api/transfer'
import type { TransferRecord } from '@/types/transfer'

export const useTransferStore = defineStore('transfer', () => {
  const list = ref<TransferRecord[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)

  /** 加载余额转账记录列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getTransferList(page.value, pageSize.value)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  return { list, total, page, pageSize, loading, fetchList }
})
