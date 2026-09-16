import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  bindStaffWechat,
  createStaffAccount,
  deleteStaff,
  getStaffAccount,
  getStaffAccounts,
  getStaffPasswordHistory,
  issueStaffAccount,
  resetStaffPassword,
  restoreStaff,
  unbindStaffWechat,
  updateStaffIdentities,
  updateStaffStatus,
  viewStaffLoginPassword,
} from '@/api/staff'
import type {
  StaffAccount,
  StaffAccountSaveDTO,
  StaffBindDTO,
  StaffIdentityUpdateDTO,
  StaffIssueAccountDTO,
  StaffPasswordLog,
  StaffPasswordView,
} from '@/types/staff'
import { runBatch } from '@/utils/runBatch'

export const useStaffStore = defineStore('staff', () => {
  const list = ref<StaffAccount[]>([])
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref(false)
  const page = ref(1)
  const pageSize = ref(10)
  /** 筛选：关键词（姓名/工号）。 */
  const keyword = ref('')
  /** 筛选：门店。 */
  const shopId = ref<string | number>('')
  /** 筛选：身份（MERCHANT_OWNER/MANAGER/RIDER/VERIFIER/STAFF）。 */
  const role = ref('')
  /** 筛选：状态（1 正常 / 0 禁用）。 */
  const status = ref<string | number>('')
  /** P7：回收站视图（true=只看已删除账号，可恢复）。 */
  const onlyDeleted = ref(false)

  /** 加载人员台账（D0）。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const result = await getStaffAccounts({
        shopId: shopId.value === '' ? undefined : shopId.value,
        role: role.value || undefined,
        keyword: keyword.value || undefined,
        status: status.value === '' ? undefined : status.value,
        onlyDeleted: onlyDeleted.value || undefined,
        page: page.value,
        size: pageSize.value,
      })
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** D1 建号（新建档案 / 叠加身份）。 */
  async function create(payload: StaffAccountSaveDTO): Promise<number> {
    saving.value = true
    try {
      const id = await createStaffAccount(payload)
      await fetchList()
      return id
    } finally {
      saving.value = false
    }
  }

  /** D1b 发号。 */
  async function issue(id: number | string, payload: StaffIssueAccountDTO): Promise<void> {
    saving.value = true
    try {
      await issueStaffAccount(id, payload)
      await fetchList()
    } finally {
      saving.value = false
    }
  }

  /** D4 改身份（可一步式发号）。 */
  async function changeIdentities(id: number | string, payload: StaffIdentityUpdateDTO): Promise<void> {
    actionLoading.value = true
    try {
      await updateStaffIdentities(id, payload)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** D4b 绑定微信。 */
  async function bindWechat(id: number | string, payload: StaffBindDTO): Promise<void> {
    actionLoading.value = true
    try {
      await bindStaffWechat(id, payload)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** D4c 解绑微信。 */
  async function unbindWechat(id: number | string): Promise<void> {
    actionLoading.value = true
    try {
      await unbindStaffWechat(id)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** D3 重置密码。 */
  async function resetPassword(id: number | string, newPassword: string): Promise<void> {
    actionLoading.value = true
    try {
      await resetStaffPassword(id, newPassword)
    } finally {
      actionLoading.value = false
    }
  }

  /** D6① 启停账号（禁用后立即掉线、C 端身份消失）。 */
  async function setStatus(row: StaffAccount, status: 0 | 1): Promise<void> {
    actionLoading.value = true
    try {
      await updateStaffStatus(row.id, status)
      row.status = status
    } finally {
      actionLoading.value = false
    }
  }

  /** D2 查看登录明文（敏感，调用方需二次确认）。 */
  async function viewPassword(id: number | string): Promise<StaffPasswordView> {
    return viewStaffLoginPassword(id)
  }

  /** D3b 改密留痕。 */
  async function passwordHistory(id: number | string, limit = 20): Promise<StaffPasswordLog[]> {
    return getStaffPasswordHistory(id, limit)
  }

  /** D5 账号详情（无密码）。 */
  async function detail(id: number | string): Promise<StaffAccount> {
    return getStaffAccount(id)
  }

  /** 软删除单个人员（回收站可恢复）并刷新列表。 */
  async function remove(id: number | string): Promise<void> {
    actionLoading.value = true
    try {
      await deleteStaff(id)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量软删除，复用单条接口并限制并发数。 */
  async function removeBatch(ids: Array<number | string>): Promise<{ successIds: Array<number | string>; failedIds: Array<number | string> }> {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(uniqueIds, (id) => deleteStaff(id), 3)
      await fetchList()
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally {
      actionLoading.value = false
    }
  }

  /** 恢复已删除人员并刷新列表。 */
  async function restore(id: number | string): Promise<void> {
    actionLoading.value = true
    try {
      await restoreStaff(id)
      await fetchList()
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量恢复，复用单条恢复接口并限制并发数。 */
  async function restoreBatch(ids: Array<number | string>): Promise<{ successIds: Array<number | string>; failedIds: Array<number | string> }> {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(uniqueIds, (id) => restoreStaff(id), 3)
      await fetchList()
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally {
      actionLoading.value = false
    }
  }

  return {
    list, total, loading, saving, actionLoading, page, pageSize, keyword, shopId, role, status, onlyDeleted,
    fetchList, create, issue, changeIdentities, bindWechat, unbindWechat,
    resetPassword, viewPassword, passwordHistory, detail, setStatus,
    remove, removeBatch, restore, restoreBatch,
  }
})
