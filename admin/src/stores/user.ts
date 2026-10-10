import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { deleteUser, getUserDetail, getUsers, registerUserWechatId, restoreUser, updateUserBanStatus, updateUserWallet } from '@/api/user'
import type { AdminWalletUpsertDTO, User, UserBanStatus, UserDetail, UserFilters, UserListQuery, UserPageResult } from '@/types/user'
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
  const filters = reactive<UserFilters>({ keyword: '' })

  /**
   * 页签 → **服务端筛选参数**（契约 `GET /api/admin/user/list`）。
   *
   * | 页签 | 含义 | 下发参数 | 为什么 |
   * |---|---|---|---|
   * | `normal` | 正常 | `delFlag=0` + `banStatus=0` | 两个筛选项都在**未删除**范围内，「正常」= 未删且未封 |
   * | `banned` | 封禁 | `delFlag=0` + `banStatus=1` | ⚠️ 契约 `banStatus` 语义是「**仅未删除用户参与**」，故必须同时钉住 `delFlag=0` |
   * | `deleted` | 删除 | **仅** `delFlag=1` | ⚠️ **不能**带 `banStatus`：契约明写 `banStatus` 只统计未删除用户 ⇒ 「已删除 + banStatus=1」自相矛盾，会把已删除页签筛成空页 |
   *
   * ⚠️ 三个页签放到一起是**互斥且穷尽**的：
   * `delFlag=0&banStatus=0` ∪ `delFlag=0&banStatus=1` ∪ `delFlag=1` = 全部用户，
   * 交集为空 ⇒ 「共 N 条」不会再出现「各页签加起来 ≠ 总数」的怪象。
   *
   * ⚠️ 两个参数都**只在有值时下发**（契约「不传返回全部」）——**绝不发空串**。
   */
  function resolveListQuery(status?: string): UserListQuery {
    if (status === 'deleted') return { delFlag: 1 }
    if (status === 'banned') return { delFlag: 0, banStatus: 1 }
    return { delFlag: 0, banStatus: 0 }
  }

  /**
   * 加载 B 端用户列表（**服务端分页 + 服务端筛选**）。
   *
   * `status` = 当前状态页签（`normal` / `deleted` / `banned`），由页面透传。
   * ⚠️ 本函数**只有** `views/users/index.vue` 一个调用方（总是带上页签）；`status` 省略时按
   * 「正常」处理，仅为签名容错。⚠️ 不要用"省略 `status`"来表达"全部用户"——契约里"全部"
   * 是 `delFlag`/`banStatus` 都**不下发**，而「正常」是明确下发 `0` 的，两者不是一回事。
   *
   * ⚠️ 2026-10-10 修：此前**只把 `keyword` 发给后端**，页签靠前端 `filter(store.list)` 实现
   * ⇒ 后端回的是全量用户的第 N 页、前端再按页签筛 ⇒ 每页只剩几条甚至 0 条，
   * 而每页条数/总页数又按 `filter` 出来的数量算 ⇒ 翻页错乱、「已删除」页签假空。
   * 现改为：**筛选下发到后端**，`list` 就是该页签该页的真实数据。
   *
   * ⚠️ 空末页自愈：单条/批量 封禁、删除、恢复、登记微信号之后行会**离开当前页签**
   * （例如在「正常」页签封禁最后一行）⇒ 若这次回包是**空页且不在第 1 页**，
   * 就把页码退回上一页重取一次（最多退一页）。否则用户会被留在**空白页**上，
   * 看起来像"列表没数据了"（后端 total 明明还有）。
   * 只退一页不再循环：调用方每次操作前都在第 1 页的可能性最高，一次退页已覆盖实际场景；
   * 反复退页会在后端持续返回空页时打成请求风暴。
   */
  async function fetchList(status?: string): Promise<void> {
    loading.value = true
    try {
      const query = resolveListQuery(status)
      const result = await getUsers(page.value, pageSize.value, filters.keyword, query)
      if (!result.list.length && page.value > 1) {
        page.value -= 1
        const fallback = await getUsers(page.value, pageSize.value, filters.keyword, query)
        list.value = fallback.list
        total.value = fallback.total
        return
      }
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

  /** 更新用户封禁状态并刷新列表（⚠️ 该行可能已不属于当前页签 ⇒ 刷新用当前页签的筛选）。 */
  async function updateBanStatus(user: User, banStatus: UserBanStatus, status?: string): Promise<void> {
    actionLoading.value = true
    try {
      await updateUserBanStatus(user.id, banStatus)
      await fetchList(status)
    } finally {
      actionLoading.value = false
    }
  }

  /** 批量更新用户封禁状态，复用单条接口并在全部任务结束后统一刷新。 */
  async function updateBanStatuses(users: User[], banStatus: UserBanStatus, status?: string): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(users.map((user) => user.id))]
    if (!ids.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(ids, (id) => updateUserBanStatus(id, banStatus), 3)
      await fetchList(status)
      return {
        successIds: result.succeeded,
        failedIds: result.failed.map(({ item }) => item),
      }
    } finally {
      actionLoading.value = false
    }
  }

  /** 软删除用户并刷新列表（行会离开「未删除」页签 ⇒ 刷新用当前页签的筛选 + 空末页自愈）。 */
  async function removeUser(userId: string, status?: string): Promise<void> {
    actionLoading.value = true
    try { await deleteUser(userId); await fetchList(status) } finally { actionLoading.value = false }
  }

  /** 批量软删除用户，复用单条接口并控制并发。 */
  async function removeUsers(userIds: string[], status?: string): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(userIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    actionLoading.value = true
    try {
      const result = await runBatch(ids, (id) => deleteUser(id), 3)
      await fetchList(status)
      return { successIds: result.succeeded, failedIds: result.failed.map(({ item }) => item) }
    } finally { actionLoading.value = false }
  }

  /** 恢复已软删除用户并刷新列表（行会离开「已删除」页签 ⇒ 同上）。 */
  async function restoreOne(userId: string, status?: string): Promise<void> {
    actionLoading.value = true
    try { await restoreUser(userId); await fetchList(status) } finally { actionLoading.value = false }
  }

  /**
   * 登记 / 清空用户微信号并刷新列表（`wechatId` 传空串 = 清空）。
   *
   * ⚠️ 它是人员「微信号」绑定的**前置条件**（契约：未登记时绑定会报 2000 并提示去登记）⇒
   * 刷新列表是必需的：列表的「微信号」列要立刻反映出登记结果。
   * 微信号不影响页签归属，但刷新同样走**当前页签的筛选**（`status`），保持一致。
   */
  async function registerWechatId(userId: string, wechatId: string, status?: string): Promise<void> {
    actionLoading.value = true
    try {
      await registerUserWechatId(userId, wechatId)
      await fetchList(status)
    } finally {
      actionLoading.value = false
    }
  }

  function resetFilters(): void {
    Object.assign(filters, { keyword: '' })
    page.value = 1
  }

  return { list, total, loading, actionLoading, detail, detailLoading, walletLoading, page, pageSize, filters, fetchList, fetchDetail, updateWallet, updateBanStatus, updateBanStatuses, removeUser, removeUsers, restoreOne, registerWechatId, resetFilters }
})
