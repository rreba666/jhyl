import { defineStore } from 'pinia'
import { ref } from 'vue'
import { approveWithdrawal, getPendingWithdrawals, getStuckWithdrawals, manualFailWithdrawal, manualSuccessWithdrawal, rejectWithdrawal, retryWithdrawal } from '@/api/withdraw'
import type { Withdrawal } from '@/types/withdraw'

export const useWithdrawStore = defineStore('withdraw', () => {
  const pendingWithdrawals = ref<Withdrawal[]>([])
  const pendingTotal = ref(0)
  const stuckWithdrawals = ref<Withdrawal[]>([])
  const stuckTotal = ref(0)
  const page = ref(1)
  const size = ref(20)
  const loading = ref(false)
  const actionLoading = ref(false)

  /** 同时加载待审核和异常提现列表。 */
  async function fetchAll(): Promise<void> {
    loading.value = true
    try {
      const [pending, stuck] = await Promise.all([getPendingWithdrawals({ page: page.value, size: size.value }), getStuckWithdrawals({ page: page.value, size: size.value })])
      pendingWithdrawals.value = pending.list
      pendingTotal.value = pending.total
      stuckWithdrawals.value = stuck.list
      stuckTotal.value = stuck.total
    } finally { loading.value = false }
  }

  async function runAction(action: () => Promise<void>): Promise<void> { actionLoading.value = true; try { await action(); await fetchAll() } finally { actionLoading.value = false } }
  async function approve(withdrawNo: string): Promise<void> { await runAction(() => approveWithdrawal(withdrawNo)) }
  async function reject(withdrawNo: string, reason: string): Promise<void> { await runAction(() => rejectWithdrawal(withdrawNo, reason)) }
  async function retry(withdrawNo: string): Promise<void> { await runAction(() => retryWithdrawal(withdrawNo)) }
  async function manualSuccess(withdrawNo: string): Promise<void> { await runAction(() => manualSuccessWithdrawal(withdrawNo)) }
  async function manualFail(withdrawNo: string, reason: string): Promise<void> { await runAction(() => manualFailWithdrawal(withdrawNo, reason)) }

  return { pendingWithdrawals, pendingTotal, stuckWithdrawals, stuckTotal, page, size, loading, actionLoading, fetchAll, approve, reject, retry, manualSuccess, manualFail }
})
