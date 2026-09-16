import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { confirmRedFlushAdminInvoice, getAdminInvoiceDetail, getAdminInvoices, processAdminInvoice } from '@/api/invoice'
import type { AdminInvoice, AdminInvoiceDetail, AdminInvoiceFilters, AdminInvoicePageResult, AdminInvoiceProcessDTO } from '@/types/invoice'

export const useInvoiceStore = defineStore('invoice', () => {
  const list = ref<AdminInvoice[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(10)
  const loading = ref(false)
  const detailLoading = ref(false)
  const processing = ref(false)
  const detail = ref<AdminInvoiceDetail | null>(null)
  const filters = reactive<AdminInvoiceFilters>({ status: '' })

  /** 按状态分页加载后台发票申请。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result: AdminInvoicePageResult = await getAdminInvoices({ ...filters, page: page.value, pageSize: pageSize.value })
      list.value = result.list
      total.value = result.total
    } finally { loading.value = false }
  }

  /** 加载发票详情，供财务核对商品明细。 */
  async function fetchDetail(id: string): Promise<AdminInvoiceDetail> {
    detailLoading.value = true
    try {
      detail.value = await getAdminInvoiceDetail(id)
      return detail.value
    } finally { detailLoading.value = false }
  }

  /** 标记发票已发送并刷新列表和当前详情。 */
  async function process(id: string, payload: AdminInvoiceProcessDTO): Promise<void> {
    processing.value = true
    try {
      await processAdminInvoice(id, payload)
      await fetchList()
      if (detail.value?.id === id) await fetchDetail(id)
    } finally { processing.value = false }
  }

  /** 确认红冲完成并刷新列表和当前详情。 */
  async function confirmRedFlush(id: string): Promise<void> {
    processing.value = true
    try {
      await confirmRedFlushAdminInvoice(id)
      await fetchList()
      if (detail.value?.id === id) await fetchDetail(id)
    } finally { processing.value = false }
  }

  /** 清空筛选条件并回到第一页。 */
  function resetFilters(): void { filters.status = ''; page.value = 1 }

  return { list, total, page, pageSize, loading, detailLoading, processing, detail, filters, fetchList, fetchDetail, process, confirmRedFlush, resetFilters }
})
