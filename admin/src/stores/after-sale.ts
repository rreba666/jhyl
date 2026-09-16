import { defineStore } from 'pinia'
import { ref } from 'vue'
import { approveAfterSale, getAfterSaleList, receiveAfterSale, rejectAfterSale, requestShopVerify, verifyAfterSale } from '@/api/after-sale'
import type { AdminAfterSale } from '@/types/after-sale'

export const useAfterSaleStore = defineStore('after-sale', () => {
  const list = ref<AdminAfterSale[]>([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(20)
  /** 状态筛选：undefined=全部，0~5 按售后单状态筛选。 */
  const statusFilter = ref<number | undefined>(undefined)
  /** 类型筛选：undefined=全部，1=仅退款，2=退货退款。 */
  const typeFilter = ref<number | undefined>(undefined)
  const loading = ref(false)
  const actionLoading = ref(false)

  /** 按当前筛选条件加载售后单列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getAfterSaleList({
        page: page.value,
        size: size.value,
        status: statusFilter.value,
        type: typeFilter.value,
      })
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 执行单个操作后刷新列表。 */
  async function runAction(action: () => Promise<void>): Promise<void> {
    actionLoading.value = true
    try {
      await action()
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  async function approve(id: string, type?: number): Promise<void> { await runAction(() => approveAfterSale(id, type)) }
  async function reject(id: string, reason?: string): Promise<void> { await runAction(() => rejectAfterSale(id, reason)) }
  async function receive(id: string, result: 'PASS' | 'FAIL', reason?: string): Promise<void> { await runAction(() => receiveAfterSale(id, result, reason)) }
  /** 中控转门店核实（merchant_verify_status 0→1）。 */
  async function requestShopVerifyAction(id: string): Promise<void> { await runAction(() => requestShopVerify(id)) }
  /** 回填门店核实意见（仅待门店核实时可提交）。 */
  async function verifyShop(id: string, opinion: string): Promise<void> { await runAction(() => verifyAfterSale(id, opinion)) }

  return { list, total, page, size, statusFilter, typeFilter, loading, actionLoading, fetchList, approve, reject, receive, requestShopVerifyAction, verifyShop }
})
