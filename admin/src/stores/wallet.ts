import { defineStore } from 'pinia'
import { ref } from 'vue'
import { deleteWallet, getWalletList, saveWalletBalance } from '@/api/wallet'
import type { WalletRecord } from '@/types/wallet'

const WALLET_MODULE = 'wallets'

export const useWalletStore = defineStore('wallet', () => {
  const list = ref<WalletRecord[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)
  const actionLoading = ref(false)

  /** 加载钱包分页列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getWalletList(page.value, pageSize.value)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 删除钱包记录并刷新列表。 */
  async function removeWallet(walletId: string): Promise<void> {
    actionLoading.value = true
    try {
      await deleteWallet(walletId)
      if (!list.value.length && page.value > 1) page.value -= 1
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 仅更新可用余额。 */
  async function updateBalance(userId: string, availableBalance: number): Promise<void> {
    actionLoading.value = true
    try {
      await saveWalletBalance(userId, availableBalance)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  return { list, total, page, pageSize, loading, actionLoading, fetchList, updateBalance, removeWallet }
})
