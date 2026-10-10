<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useUserStore } from '@/stores/user'
import type { AdminWalletUpsertDTO, User, UserBanStatus, UserBanStatusValue, UserDetail } from '@/types/user'
import { Delete, Lock, RefreshLeft, Unlock, View } from '@element-plus/icons-vue'

const store = useUserStore()
const selected = ref<User[]>([])
type UserStatusTab = 'normal' | 'deleted' | 'banned'
const statusTab = ref<UserStatusTab>('normal')
const hasSelection = computed(() => selected.value.length > 0)
const activeSelected = computed(() => selected.value.filter((user) => user.delFlag !== 1))
const visibleUsers = computed(() => store.list.filter((user) => getUserStatus(user) === statusTab.value))
const detailVisible = ref(false)
const detailUserId = ref('')
type WalletForm = Pick<UserDetail, 'pendingPromotion' | 'pendingBonus' | 'balance'>
const walletForm = ref<WalletForm>({ pendingPromotion: 0, pendingBonus: 0, balance: 0 })
const walletOriginal = ref<WalletForm | null>(null)

function normalizeBanStatus(value: UserBanStatusValue): 0 | 1 {
  return value === 1 || value === '1' ? 1 : 0
}

function getUserStatus(user: User): UserStatusTab {
  if (user.delFlag === 1) return 'deleted'
  return normalizeBanStatus(user.banStatus) === 1 ? 'banned' : 'normal'
}

/** 将详情中的当前余额复制到独立表单，避免直接修改响应数据。 */
function syncWalletForm(detail: UserDetail): void {
  const values = { pendingPromotion: detail.pendingPromotion, pendingBonus: detail.pendingBonus, balance: detail.balance }
  walletOriginal.value = values
  walletForm.value = { ...values }
}

/** 打开用户详情并按字符串 ID 查询最新数据。 */
async function showDetail(row: User): Promise<void> {
  detailUserId.value = String(row.id)
  detailVisible.value = true
  walletOriginal.value = null
  try {
    await store.fetchDetail(detailUserId.value)
    if (!store.detail) throw new Error('用户详情为空')
    syncWalletForm(store.detail)
    // 微信号（`AdminUserDetailVO.wxId`，null=未登记）同样以详情响应为准
    wechatIdForm.value = store.detail.wxId || ''
  } catch (error) {
    detailVisible.value = false
    ElMessage.error(error instanceof Error ? error.message : '用户详情查询失败')
  }
}

/** 校验编辑值，明确允许 0 作为清零值。 */
function isValidBalance(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

/** 只构造实际修改的字段，并在提交前确认手工调账影响。 */
async function saveWallet(): Promise<void> {
  const original = walletOriginal.value
  if (!original) return
  const payload: AdminWalletUpsertDTO = {}
  for (const field of ['pendingPromotion', 'pendingBonus', 'balance'] as const) {
    const nextValue = walletForm.value[field]
    if (nextValue === original[field]) continue
    if (!isValidBalance(nextValue)) {
      ElMessage.error('余额必须是有限非负数字')
      return
    }
    payload[field] = nextValue
  }
  if (!Object.keys(payload).length) {
    ElMessage.warning('请至少修改一个余额字段后再保存')
    return
  }
  try {
    await ElMessageBox.confirm(
      '本操作属于手工调账，直接修改用户可提现余额，不经过推广金、红包或提现自动流转，请确认业务影响。',
      '手工调账确认',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
    await store.updateWallet(detailUserId.value, payload)
    await store.fetchDetail(detailUserId.value)
    if (store.detail) syncWalletForm(store.detail)
    ElMessage.success('钱包余额已更新')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '钱包余额更新失败')
  }
}

function handleStatusTabChange(value: string | number): void {
  statusTab.value = String(value) as UserStatusTab
  selected.value = []
}

async function loadList(): Promise<void> {
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '用户列表查询失败')
  }
}

/** 按关键词搜索用户（ID/昵称/手机号），回车或点击触发。 */
function searchUsers(): void {
  store.page = 1
  void loadList()
}

async function toggleBan(user: User): Promise<void> {
  const nextStatus: UserBanStatus = normalizeBanStatus(user.banStatus) === 1 ? 0 : 1
  try {
    await ElMessageBox.confirm(
      nextStatus === 1 ? `确认封禁用户“${user.nickname}”吗？` : `确认解封用户“${user.nickname}”吗？`,
      '状态确认',
    )
    await store.updateBanStatus(user, nextStatus)
    ElMessage.success(nextStatus === 1 ? '用户已封禁' : '用户已解封')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '用户状态更新失败')
  }
}

async function batchBan(status: UserBanStatus): Promise<void> {
  if (!selected.value.length) return
  const action = status === 1 ? '封禁' : '解封'
  try {
    await ElMessageBox.confirm(`确认${action}选中的 ${selected.value.length} 个用户吗？`, `批量${action}确认`)
    const result = await store.updateBanStatuses(selected.value, status)
    selected.value = []
    if (result.failedIds.length) {
      ElMessage.warning(`${action}成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    } else {
      ElMessage.success(`已${action} ${result.successIds.length} 个用户`)
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : `批量${action}失败`)
  }
}

function isDeleted(user: User): boolean {
  return user.delFlag === 1
}

/** 删除单个用户，软删除后仍可恢复。 */
async function removeUser(user: User): Promise<void> {
  if (isDeleted(user)) return
  try {
    await ElMessageBox.confirm(`确认删除用户“${user.nickname}”吗？`, '删除用户确认')
    await store.removeUser(user.id)
    selected.value = []
    ElMessage.success('用户已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '用户删除失败')
  }
}

/** 批量软删除用户。 */
async function removeSelected(): Promise<void> {
  if (!activeSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${activeSelected.value.length} 个用户吗？`, '批量删除用户确认')
    const result = await store.removeUsers(activeSelected.value.map((user) => user.id))
    selected.value = []
    ElMessage.success(result.failedIds.length ? `删除成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个` : `已删除 ${result.successIds.length} 个用户`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 恢复单个软删除用户。 */
async function restoreUser(user: User): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复用户“${user.nickname}”吗？`, '恢复用户确认')
    await store.restoreOne(user.id)
    ElMessage.success('用户已恢复')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '用户恢复失败')
  }
}

/**
 * 微信号登记（`PUT /api/admin/user/{userId}/wechat-id`，2026-10-10 新增入口）。
 *
 * ⚠️ 为什么用户管理页需要这个动作：人员绑定的**三个 key 之一就是微信号**，而契约写明
 * 「微信号是人工登记值（小程序拿不到微信号），**需先在「用户管理」里登记，否则报 2000 并提示去登记**」。
 * 本仓库此前**没有任何界面**调这条接口（三个前端全文检索 `wechat-id` 均 0 命中）⇒
 * 运营在「新增人员」里选微信号这条路**必然报错**。此入口把这条链路接上。
 *
 * ⚠️ 放在**详情抽屉**里而不是表格操作列：① 它是"用户资料属性"（与手机号同级），不是行级动作；
 * ② 表格操作列宽度被 `tests/user-wallet.contract.ps1` 的 `width="280"` 钉住，加第 4 个按钮会挤爆
 * （**不去改别人的断言**，也不去撑宽列）。
 *
 * `wechatId` 传**空串 = 清空登记**（契约：「入参：`wechatId` 非空=登记；空串/null=清空登记（纠正手误）」）
 * ⇒ 输入框预填当前值，人工清空即清空（**不是**靠前端自己判断"要不要清"）。
 */
const wechatIdForm = ref('')

/** 保存微信号登记 / 清空。 */
async function saveWechatId(): Promise<void> {
  const userId = detailUserId.value
  if (!userId) return
  const next = wechatIdForm.value.trim()
  // 契约 `AdminUserWxIdDTO.wechatId` 只有 maxLength 64 —— 前端只做这一条，不发明别的规则
  if (next.length > 64) {
    ElMessage.error('微信号最长 64 个字符')
    return
  }
  if (next === (store.detail?.wxId || '')) {
    ElMessage.warning('微信号没有变化')
    return
  }
  try {
    await store.registerWechatId(userId, next)
    // 详情接口（`AdminUserDetailVO.wxId`）同样回传该字段 ⇒ 重新拉一次，
    // 让输入框显示**后端真值**而不是本地提交值（本项目硬原则：不拿本地值冒充后端状态）
    await store.fetchDetail(userId)
    wechatIdForm.value = store.detail?.wxId || ''
    ElMessage.success(next ? '微信号已登记（该用户现在可以用微信号绑定人员）' : '已清空该用户的微信号登记')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '微信号登记失败')
  }
}

onMounted(() => { void loadList() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>用户管理</h1><p>管理注册用户、账号状态与基础资料。</p></div>
      <el-button @click="loadList">刷新</el-button>
    </div>
    <el-tabs v-model="statusTab" class="user-status-tabs" @tab-change="handleStatusTabChange">
      <el-tab-pane name="normal">
        <template #label><span class="user-tab user-tab--normal">正常</span></template>
      </el-tab-pane>
      <el-tab-pane name="deleted">
        <template #label><span class="user-tab user-tab--deleted">删除</span></template>
      </el-tab-pane>
      <el-tab-pane name="banned">
        <template #label><span class="user-tab user-tab--banned">封禁</span></template>
      </el-tab-pane>
    </el-tabs>
    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>用户列表</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
        <div class="toolbar-actions">
          <el-input v-model="store.filters.keyword" placeholder="用户ID/昵称/手机号" clearable class="search-input" @keyup.enter="searchUsers" @clear="searchUsers" />
          <el-button type="primary" @click="searchUsers">搜索</el-button>
          <span v-if="hasSelection" class="selection-tip">已选择 {{ selected.length }} 项</span>
          <el-button plain :disabled="!hasSelection || store.actionLoading" :loading="store.actionLoading" @click="batchBan(1)">批量封禁</el-button>
          <el-button plain type="success" :disabled="!hasSelection || store.actionLoading" :loading="store.actionLoading" @click="batchBan(0)">批量解封</el-button>
          <el-button type="danger" plain :disabled="!activeSelected.length || store.actionLoading" :loading="store.actionLoading" @click="removeSelected">批量删除</el-button>
          <el-button :loading="store.loading" @click="loadList">刷新</el-button>
        </div>
      </div>
      <DataTable
        :data="visibleUsers"
        :loading="store.loading"
        :total="visibleUsers.length"
        :page="store.page"
        :page-size="store.pageSize"
        empty-text="暂无用户数据"
        @selection-change="selected = $event"
        @page-change="store.page = $event; void loadList()"
        @size-change="store.pageSize = $event; store.page = 1; void loadList()"
      >
        <el-table-column prop="id" label="用户 ID" min-width="190" />
        <el-table-column label="用户信息" min-width="210">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="34" :src="row.avatarUrl">{{ row.nickname?.slice(0, 1) }}</el-avatar>
              <div><div>{{ row.nickname }}</div><small>{{ row.phone || '未绑定手机' }}</small></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="identity" label="身份" width="100">
          <template #default="{ row }">{{ row.identity === 1 ? '注册用户' : '游客' }}</template>
        </el-table-column>
        <!-- 微信号（人工登记值）：`AdminUserListVO.wxId` 描述原文「微信号（人工登记；null=未登记）」
             —— 它决定该用户能不能用**微信号**做人员绑定的 key，所以必须可见（未登记 = 用微信号绑不上）。 -->
        <el-table-column label="微信号" min-width="160">
          <template #default="{ row }">
            <span v-if="row.wxId">{{ row.wxId }}</span>
            <span v-else class="muted-cell">未登记</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }"><el-tag v-if="isDeleted(row)" type="info">已删除</el-tag><el-tag v-else :type="normalizeBanStatus(row.banStatus) ? 'danger' : 'success'">{{ normalizeBanStatus(row.banStatus) ? '封禁' : '正常' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="createTime" label="注册时间" min-width="180" />
        <el-table-column label="操作" fixed="right" width="280">
          <template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" :loading="store.detailLoading && detailUserId === row.id" @click="showDetail(row)"><el-icon><View /></el-icon>详情</el-button><el-button v-if="isDeleted(row)" size="small" type="success" :loading="store.actionLoading" @click="restoreUser(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button><template v-else><el-button size="small" :type="normalizeBanStatus(row.banStatus) ? 'warning' : 'danger'" :loading="store.actionLoading" @click="toggleBan(row)"><el-icon><Unlock v-if="normalizeBanStatus(row.banStatus)" /><Lock v-else /></el-icon>{{ normalizeBanStatus(row.banStatus) ? '解封' : '封禁' }}</el-button><el-button size="small" type="danger" :loading="store.actionLoading" @click="removeUser(row)"><el-icon><Delete /></el-icon>删除</el-button></template></div></template>
        </el-table-column>
      </DataTable>
    </el-card>
    <el-drawer v-model="detailVisible" title="用户详情" size="min(520px, calc(100vw - 24px))" append-to-body destroy-on-close>
      <el-skeleton v-if="store.detailLoading" :rows="8" animated />
      <template v-else-if="store.detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户 ID">{{ store.detail.id }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ store.detail.nickname }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ store.detail.phone || '未绑定手机' }}</el-descriptions-item>
          <el-descriptions-item label="身份">{{ store.detail.identity === 1 ? '注册用户' : '游客' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ isDeleted(store.detail) ? '已删除' : normalizeBanStatus(store.detail.banStatus) ? '封禁' : '正常' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ store.detail.createTime }}</el-descriptions-item>
          <el-descriptions-item label="待提现推广金">¥ {{ store.detail.pendingPromotion.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="待提现红包">¥ {{ store.detail.pendingBonus.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="余额">¥ {{ store.detail.balance.toFixed(2) }}</el-descriptions-item>
        </el-descriptions>
        <el-divider>钱包余额编辑</el-divider>
        <el-alert type="warning" :closable="false" show-icon title="手工调账" description="保存会直接覆盖用户可提现余额，请确认业务影响。" />
        <el-form label-width="130px" class="wallet-form">
          <el-form-item label="待提现推广金">
            <el-input-number v-model="walletForm.pendingPromotion" :min="0" :precision="2" :step="0.01" controls-position="right" />
          </el-form-item>
          <el-form-item label="待提现红包">
            <el-input-number v-model="walletForm.pendingBonus" :min="0" :precision="2" :step="0.01" controls-position="right" />
          </el-form-item>
          <el-form-item label="余额">
            <el-input-number v-model="walletForm.balance" :min="0" :precision="2" :step="0.01" controls-position="right" />
          </el-form-item>
        </el-form>
        <el-divider>微信号登记</el-divider>
        <el-alert type="info" :closable="false" show-icon>
          <p class="muted">
            微信号是<strong>人工登记值</strong>（小程序拿不到微信号）。登记后，人员管理里就能用「微信号」作为绑定标识；
            <strong>留空保存 = 清空登记</strong>。同一微信号只能登记到一个用户。
          </p>
        </el-alert>
        <el-form label-width="130px" class="wallet-form">
          <el-form-item label="用户微信号">
            <el-input v-model="wechatIdForm" maxlength="64" show-word-limit clearable placeholder="如 wxid_tn2b7yddlyed22（留空 = 清空登记）" />
          </el-form-item>
        </el-form>
      </template>
      <el-empty v-else description="暂无用户详情" />
      <template #footer>
        <div class="drawer-footer"><el-button @click="detailVisible = false">取消</el-button><el-button type="warning" plain :loading="store.actionLoading" :disabled="store.detailLoading || !store.detail" @click="saveWechatId">保存微信号</el-button><el-button type="primary" :loading="store.walletLoading" :disabled="store.detailLoading || !walletOriginal" @click="saveWallet">保存余额</el-button></div>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.wallet-form { margin-top: 20px; }
.wallet-form :deep(.el-input-number) { width: 100%; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>

<style scoped>
.user-status-tabs { margin-bottom: 16px; }
.user-status-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.user-tab { font-weight: 600; }
.user-tab--normal { color: var(--el-color-success); }
.user-tab--deleted { color: var(--el-text-color-secondary); }
.user-tab--banned { color: var(--el-color-danger); }
.search-input { width: 220px; }
.muted { color: var(--el-text-color-secondary); }
.muted-cell { color: var(--el-text-color-secondary); }
</style>
