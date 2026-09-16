import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { approveAddressChangeRequest, getAddressChangeRequests, rejectAddressChangeRequest } from '@/api/address-audit'
import type { AddressAuditFilters, AddressAuditPageResult, OrderAddressChangeRequest } from '@/types/address-audit'

export const useAddressAuditStore = defineStore('address-audit', () => {
  const list = ref<OrderAddressChangeRequest[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(10)
  const loading = ref(false)
  const actionLoading = ref(false)
  const filters = reactive<AddressAuditFilters>({ status: '', orderNo: '' })

  /** 按真实接口支持的状态和订单号筛选地址申请。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result: AddressAuditPageResult = await getAddressChangeRequests({
        page: page.value,
        pageSize: pageSize.value,
        ...(filters.status === '' ? {} : { status: filters.status }),
        ...(filters.orderNo.trim() ? { orderNo: filters.orderNo.trim() } : {}),
      })
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 执行审核操作后刷新当前页，避免页面保留已处理申请。 */
  async function runAction(action: () => Promise<void>): Promise<void> {
    actionLoading.value = true
    try {
      await action()
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  async function approve(id: string): Promise<void> {
    await runAction(() => approveAddressChangeRequest(id))
  }

  async function reject(id: string, reason: string): Promise<void> {
    await runAction(() => rejectAddressChangeRequest(id, reason))
  }

  /** 清空地址申请筛选并回到第一页。 */
  function resetFilters(): void {
    filters.status = ''
    filters.orderNo = ''
    page.value = 1
  }

  return { list, total, page, pageSize, loading, actionLoading, filters, fetchList, approve, reject, resetFilters }
})
