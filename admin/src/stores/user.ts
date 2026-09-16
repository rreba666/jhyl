import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { deleteUser, getUserDetail, getUsers, restoreUser, updateUserBanStatus, updateUserWallet } from '@/api/user'
import type { AdminWalletUpsertDTO, User, UserBanStatus, UserDetail, UserFilters, UserPageResult } from '@/types/user'
import { runBatch } from '@/utils/runBatch'

export const useUserStore = defineStore('user', () => {
  const list = ref<UserPageResult['list']>([])
  const total = ref(0)
  const loading = ref(false)
  const actionLoading = ref(false)
  const detail = ref<UserDetail | null>(null)
  const detailLoading = ref(false)
  const walletLoading = ref(false)
  const page = ref(1)
  const pageSize = ref(10)
  const filters = reactive<UserFilters>({ keyword: '', phone: '', banStatus: '' })

  /** 加载 B 端用户列表。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getUsers(page.value, pageSize.value, filters.keyword)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 加载用户详情，供详情抽屉和余额编辑使用。 */
  async function fetchDetail(userId: string): Promise<void> {
    detailLoading.value = true
    try {
      detail.value = await getUserDetail(userId)
    } finally {
      detailLoading.value = false
    }
  }

  /** 提交钱包余额覆盖请求，不改变用户列表现有状态。 */
  async function updateWallet(userId: string, payload: AdminWalletUpsertDTO): Promise<void> {
    walletLoading.value = true
    try {
      await updateUserWallet(userId, payload)
    } finally {
      walletLoading.value = false
    }
  }

  /** 更新用户封禁状态并刷新列表。 */
  async function updateBanStatus(user: User, banStatus: UserBanStatus): Promise<void> {
    actionLoading.value = true
    try {
      await updateUserBanStatus(user.id, banStatus)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量更新用户封禁状态，复用单条接口并在全部任务结束后统一刷新。 */
  async function updateBanStatuses(users: User[], banStatus: UserBanStatus): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(users.map((user) => user.id))]
    if (!ids.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(ids, (id) => updateUserBanStatus(id, banStatus), 3)
      await fetchList()
      return {
        successIds: result.succeeded,
        failedIds: result.failed.map(({ item }) => item),
      }
    } finally {
      actionLoading.value = false
    }
  }

  /** 软删除用户并刷新列表。 */
  async function removeUser(userId: string): Promise<void> {
    actionLoading.value = true
    try { await deleteUser(userId); await fetchList() } finally { actionLoading.value = false }
  }

  /** 批量软删除用户，复用单条接口并控制并发。 */
  async function removeUsers(userIds: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(userIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(ids, (id) => deleteUser(id), 3)
      await fetchList()
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally { actionLoading.value = false }
  }

  /** 恢复已软删除用户并刷新列表。 */
  async function restoreOne(userId: string): Promise<void> {
    actionLoading.value = true
    try { await restoreUser(userId); await fetchList() } finally { actionLoading.value = false }
  }

  function resetFilters(): void {
    Object.assign(filters, { keyword: '', phone: '', banStatus: '' })
    page.value = 1
  }

  return { list, total, loading, actionLoading, detail, detailLoading, walletLoading, page, pageSize, filters, fetchList, fetchDetail, updateWallet, updateBanStatus, updateBanStatuses, removeUser, removeUsers, restoreOne, resetFilters }
})
