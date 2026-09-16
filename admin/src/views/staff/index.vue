<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useShopStore } from '@/stores/shop'
import { useStaffStore } from '@/stores/staff'
import type {
  StaffAccount,
  StaffAccountSaveDTO,
  StaffIdentityOption,
  StaffPasswordLog,
  StaffPasswordView,
} from '@/types/staff'
import { Edit, Key, MoreFilled, RefreshLeft } from '@element-plus/icons-vue'

const store = useStaffStore()
const shopStore = useShopStore()
const route = useRoute()
const selected = ref<StaffAccount[]>([])
const deletableSelected = computed(() => selected.value.filter((item) => item.delFlag !== 1))
const restorableSelected = computed(() => selected.value.filter((item) => item.delFlag === 1))

/**
 * 身份选项（**多选**：identities 是可叠加的数组）。
 * 后端 `PUT /api/admin/staff/{id}/identities` 的 DTO 就是 `identities: string[]`：
 * - `['MANAGER','RIDER']` = 店长兼骑手；`['RIDER','VERIFIER']` = 骑手兼核销；`[]` = 仅档案；
 * - ⚠️ **V1.18 起「店长」不再自动带骑手能力**：取消店长会同时取消骑手能力回普通店员，
 *   要继续干骑手必须**显式勾上「骑手」**（接口描述：需继续干骑手请显式传 [RIDER]）。
 */
const IDENTITY_OPTIONS: Array<{ value: StaffIdentityOption; label: string; hint: string }> = [
  { value: 'MANAGER', label: '店长', hint: '店长：小程序「门店管理」（仅本店、一店唯一，页内含骑手功能入口）；同时具备 H5 核销账号密码；必须绑定微信。' },
  { value: 'RIDER', label: '骑手', hint: '骑手：小程序「骑手工作台」（仅本店任务）；无密码，仅需绑定微信。' },
  { value: 'VERIFIER', label: '核销店员', hint: '核销店员：独立工号密码，仅用于 H5 核销页，不进小程序、禁止绑定微信。' },
  { value: 'NONE', label: '仅档案', hint: '仅档案：无任何业务身份与登录入口（C 端等同普通用户）。' },
]
/** 表单里可勾选的身份（仅档案 = 一个都不勾）。 */
const SELECTABLE_IDENTITIES = IDENTITY_OPTIONS.filter((item) => item.value !== 'NONE')

/** 勾选身份 → 提示文案（多条用换行拼接）。 */
const identityHints = computed<string>(() => {
  const list = SELECTABLE_IDENTITIES.filter((item) => form.identities.includes(item.value))
  if (!list.length) return IDENTITY_OPTIONS.find((item) => item.value === 'NONE')?.hint || ''
  return list.map((item) => item.hint).join('\n')
})
/** 列表筛选用：identities 出参 → 单个身份选项（仅用于查询参数）。 */
function fromIdentities(identities: string[] | undefined): StaffIdentityOption {
  const list = identities || []
  if (list.includes('VERIFIER')) return 'VERIFIER'
  if (list.includes('MANAGER')) return 'MANAGER'
  if (list.includes('RIDER')) return 'RIDER'
  return 'NONE'
}
/**
 * 列表回显：出参 identities → 表单多选数组（过滤掉未知值）。
 * ⚠️ 当前后端出参的 `identities` **只给主身份码**（如店长兼骑手只回 `MANAGER`），
 * 骑手能力体现在 `deliveryEnabled`；而新版后端「店长不再自动带骑手」（需显式传 RIDER），
 * 所以这里按 `deliveryEnabled` 把「骑手」补勾上，避免保存时误把骑手能力去掉。
 */
function toFormIdentities(row: StaffAccount): string[] {
  const allowed = SELECTABLE_IDENTITIES.map((item) => item.value)
  const list = (row.identities || []).filter((item): item is StaffIdentityOption => allowed.includes(item as StaffIdentityOption))
  if (list.includes('MANAGER') && row.deliveryEnabled && !list.includes('RIDER')) list.push('RIDER')
  return list
}

// ===== 新增 / 编辑身份 =====
const formVisible = ref(false)
const editingRow = ref<StaffAccount | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<{ identities: string[]; name: string; phone: string; shopId: string; username: string; password: string; wechatUserId: string; wechatOpenid: string }>({
  identities: ['MANAGER'],
  name: '',
  phone: '',
  shopId: '',
  username: '',
  password: '',
  wechatUserId: '',
  wechatOpenid: '',
})
/** 是否编辑模式（编辑 = D4 改身份；新增 = D1 建号）。 */
const isEditing = computed(() => Boolean(editingRow.value))
/** 需要工号密码的身份：含店长或核销店员。 */
const needAccount = computed(() => form.identities.includes('MANAGER') || form.identities.includes('VERIFIER'))
/** 需要绑定微信的身份：含店长或骑手。 */
const needWechat = computed(() => form.identities.includes('MANAGER') || form.identities.includes('RIDER'))

const rules = computed<FormRules>(() => {
  const base: FormRules = {
    name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  }
  if (!isEditing.value) base.shopId = [{ required: true, message: '请选择所属门店', trigger: 'change' }]
  if (needAccount.value) {
    base.username = [{ required: true, message: '请输入工号', trigger: 'blur' }]
    base.password = editingRow.value && editingRow.value.accountIssued ? [] : [{ required: true, message: '请输入密码', trigger: 'blur' }]
  }
  return base
})

/** 打开新增（D1）。 */
async function openCreate(): Promise<void> {
  editingRow.value = null
  Object.assign(form, { identities: ['MANAGER'], name: '', phone: '', shopId: '', username: '', password: '', wechatUserId: '', wechatOpenid: '' })
  await shopStore.fetchEnabled()
  formVisible.value = true
}

/** 打开编辑身份（D4）。 */
async function openEditIdentity(row: StaffAccount): Promise<void> {
  editingRow.value = row
  Object.assign(form, {
    identities: toFormIdentities(row),
    name: row.name || '',
    phone: row.phone || '',
    shopId: row.shopId ? String(row.shopId) : '',
    username: row.username || '',
    password: '',
    wechatUserId: row.boundUserId ? String(row.boundUserId) : '',
    wechatOpenid: '',
  })
  await shopStore.fetchEnabled()
  formVisible.value = true
}

/** 校验并提交：新增走建号，编辑走改身份（可一步式发号）；微信字段编辑时单独走绑定接口。 */
async function submitForm(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  // 微信绑定校验：店长 / 骑手至少填 userId 或 openid 之一
  if (needWechat.value && !isEditing.value && !form.wechatUserId.trim() && !form.wechatOpenid.trim()) {
    ElMessage.error('含店长 / 骑手身份时必须填写微信用户 ID 或微信号（openid）')
    return
  }
  // 身份会互相影响，提交前再确认一次（尤其"取消店长会同时取消骑手能力"）
  if (isEditing.value && editingRow.value) {
    const before = (editingRow.value.identities || []).slice().sort().join(',')
    const after = form.identities.slice().sort().join(',')
    if (before !== after) {
      const labels = form.identities.length
        ? SELECTABLE_IDENTITIES.filter((item) => form.identities.includes(item.value)).map((item) => item.label).join(' + ')
        : '仅档案（无任何入口）'
      try {
        await ElMessageBox.confirm(`将「${editingRow.value.name}」的身份改为：${labels}？`, '身份变更确认', { type: 'warning' })
      } catch {
        return
      }
    }
  }
  try {
    if (isEditing.value && editingRow.value) {
      await store.changeIdentities(editingRow.value.id, {
        identities: [...form.identities],
        ...(needAccount.value && form.username ? { username: form.username } : {}),
        ...(needAccount.value && form.password ? { password: form.password } : {}),
      })
      ElMessage.success('身份已更新')
    } else {
      const payload: StaffAccountSaveDTO = {
        identities: [...form.identities],
        name: form.name.trim(),
        shopId: form.shopId,
        phone: form.phone || undefined,
        ...(needAccount.value ? { username: form.username.trim(), password: form.password } : {}),
        ...(needWechat.value && form.wechatUserId.trim() ? { userId: form.wechatUserId.trim() } : {}),
        ...(needWechat.value && form.wechatOpenid.trim() ? { openid: form.wechatOpenid.trim() } : {}),
      }
      await store.create(payload)
      ElMessage.success('人员已创建')
    }
    formVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

// ===== 发号（D1b） =====
async function issueAccount(row: StaffAccount): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入工号与密码，用英文逗号分隔（如 mgr-90103,mgr123456）', '发号', {
      inputPattern: /^\S+\s*,\s*\S{6,}$/,
      inputErrorMessage: '格式：工号,密码（密码至少 6 位）',
    })
    const [username, password] = result.value.split(',').map((item) => item.trim())
    await store.issue(row.id, { username, password })
    ElMessage.success('已发号，该人员 C 端身份即时生效')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '发号失败')
  }
}

// ===== 查看登录密码（D2，敏感）=====
const passwordVisible = ref(false)
const passwordLoading = ref(false)
const passwordView = ref<StaffPasswordView | null>(null)
async function viewPassword(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm('查看登录密码会记录操作日志，确认继续？', '敏感操作确认', { type: 'warning', confirmButtonText: '确认查看', cancelButtonText: '取消' })
  } catch { return }
  passwordVisible.value = true
  passwordLoading.value = true
  try {
    passwordView.value = await store.viewPassword(row.id)
  } catch (error) {
    passwordVisible.value = false
    ElMessage.error(error instanceof Error ? error.message : '登录密码查看失败')
  } finally {
    passwordLoading.value = false
  }
}

// ===== 改密留痕（D3b） =====
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref<StaffPasswordLog[]>([])
async function viewHistory(row: StaffAccount): Promise<void> {
  historyVisible.value = true
  historyLoading.value = true
  try {
    historyList.value = await store.passwordHistory(row.id)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '改密留痕查询失败')
  } finally {
    historyLoading.value = false
  }
}

// ===== 绑定 / 解绑微信（D4b / D4c）=====
async function bindWechat(row: StaffAccount): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入微信用户 ID 或 openid', '绑定微信', { inputPattern: /^\S+$/, inputErrorMessage: '不能为空' })
    const value = result.value.trim()
    await store.bindWechat(row.id, /^\d+$/.test(value) ? { userId: value } : { openid: value })
    ElMessage.success('微信绑定成功')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '微信绑定失败')
  }
}
async function unbindWechat(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认解绑「${row.name}」的微信？解绑后该人 C 端身份入口消失。`, '解绑确认', { type: 'warning' })
    await store.unbindWechat(row.id)
    ElMessage.success('已解绑微信')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '微信解绑失败')
  }
}

// ===== 重置密码（D3）/ 启停（D6） =====
async function resetPassword(row: StaffAccount): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入新的登录密码', '重置密码', { inputPattern: /^.{6,}$/, inputErrorMessage: '密码至少 6 位' })
    await store.resetPassword(row.id, result.value)
    ElMessage.success('密码已重置（后端留痕并踢下线）')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '密码重置失败')
  }
}

/** D6① 启停：中控为 query 参数；禁用后该人立即掉线、C 端身份消失。 */
async function changeStatus(row: StaffAccount, value: boolean | string | number): Promise<void> {
  const next: 0 | 1 = value ? 1 : 0
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '禁用'}「${row.name}」吗？${next ? '' : '禁用后该人立即掉线，C 端身份入口消失。'}`, '状态确认', { type: 'warning' })
    await store.setStatus(row, next)
    ElMessage.success(next ? '已启用' : '已禁用')
  } catch (error) {
    row.status = next ? 0 : 1
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '状态更新失败')
  }
}

// ===== P7：删除（进回收站）/ 恢复 =====
/** 是否已删除（回收站行）。 */
function isDeleted(row: StaffAccount): boolean {
  return row.delFlag === 1
}
/** 已删除行置灰。 */
function rowClassName({ row }: { row: StaffAccount }): string {
  return isDeleted(row) ? 'row-deleted' : ''
}

/** 软删除人员（可在「回收站」恢复）。 */
async function removeRow(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」吗？删除后该人立即掉线、C 端身份消失；可在「回收站」恢复。`, '删除确认', { type: 'warning' })
    await store.remove(row.id)
    selected.value = []
    ElMessage.success('已删除（可在回收站恢复）')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

/** 恢复已删除人员。 */
async function restoreRow(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复「${row.name}」吗？恢复后其 C 端身份一并回来。`, '恢复确认', { type: 'warning' })
    await store.restore(row.id)
    selected.value = []
    ElMessage.success('已恢复')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

/** 批量删除（仅在用行）。 */
async function removeSelected(): Promise<void> {
  if (!deletableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${deletableSelected.value.length} 个人员吗？可在「回收站」恢复。`, '批量删除确认', { type: 'warning' })
    const result = await store.removeBatch(deletableSelected.value.map((item) => item.id))
    selected.value = []
    ElMessage.success(`删除成功 ${result.successIds.length} 个${result.failedIds.length ? `，失败 ${result.failedIds.length} 个` : ''}`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 批量恢复（仅已删除行）。 */
async function restoreSelected(): Promise<void> {
  if (!restorableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${restorableSelected.value.length} 个人员吗？`, '批量恢复确认', { type: 'warning' })
    const result = await store.restoreBatch(restorableSelected.value.map((item) => item.id))
    selected.value = []
    ElMessage.success(`恢复成功 ${result.successIds.length} 个${result.failedIds.length ? `，失败 ${result.failedIds.length} 个` : ''}`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量恢复失败')
  }
}

/** 切换「回收站」视图（只看已删除）。 */
function toggleRecycle(): void {
  store.page = 1
  selected.value = []
  void loadList()
}

/** 身份标签颜色（按 identityLabel 粗分）。 */
function identityTagType(row: StaffAccount): 'primary' | 'success' | 'warning' | 'info' {
  if (row.identities?.includes('VERIFIER')) return 'warning'
  if (row.identities?.includes('MANAGER')) return 'primary'
  if (row.identities?.includes('RIDER')) return 'success'
  return 'info'
}

async function loadList(): Promise<void> {
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '人员台账查询失败') }
}
function search(): void { store.page = 1; void loadList() }
function resetFilters(): void { store.keyword = ''; store.shopId = ''; store.role = ''; store.status = ''; search() }

onMounted(() => {
  // 从「门店管理 → 查看人员」跳转带入 shopId：直接按该门店过滤
  const queryShopId = route.query.shopId
  if (queryShopId) store.shopId = String(queryShopId)
  void loadList()
  shopStore.fetchEnabled().catch(() => undefined)
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>店员管理（人员台账）</h1><p>身份由「档案 + 叠加身份」构成，**可多选**（店长 + 骑手、骑手 + 核销店员…）；店长含 H5 核销账号密码、骑手无密码、核销店员不绑微信；店长 / 骑手必须绑定微信。</p></div>
      <el-button type="primary" @click="openCreate">新增人员</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="门店">
          <el-select v-model="store.shopId" clearable placeholder="全部门店" style="width: 180px">
            <el-option v-for="shop in shopStore.enabledList" :key="shop.id" :label="shop.name" :value="shop.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="身份">
          <el-select v-model="store.role" clearable placeholder="全部身份" style="width: 150px">
            <el-option v-for="item in IDENTITY_OPTIONS" :key="item.value" :label="item.label" :value="item.value === 'NONE' ? 'STAFF' : item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词"><el-input v-model="store.keyword" clearable placeholder="姓名 / 工号" style="width: 180px" @keyup.enter="search" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="store.status" clearable placeholder="全部" style="width: 110px">
            <el-option label="正常" :value="1" /><el-option label="禁用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="回收站">
          <el-switch v-model="store.onlyDeleted" @change="toggleRecycle" />
          <span class="muted" style="margin-left: 8px">只看已删除（可恢复）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>人员列表</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
        <div class="toolbar-actions">
          <span v-if="selected.length" class="selection-tip">已选择 {{ selected.length }} 项</span>
          <el-button v-if="!store.onlyDeleted" size="small" type="danger" plain :disabled="!deletableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="removeSelected">批量删除</el-button>
          <el-button v-else size="small" type="success" plain :disabled="!restorableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="restoreSelected">批量恢复</el-button>
          <el-button :loading="store.loading" @click="loadList">刷新</el-button>
        </div>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        empty-text="暂无人员数据"
        :row-class-name="rowClassName"
        @selection-change="selected = $event"
        @page-change="store.page = $event; selected = []; void loadList()"
        @size-change="store.pageSize = $event; store.page = 1; selected = []; void loadList()"
      >
        <el-table-column label="身份" width="130">
          <template #default="{ row }">
            <el-tag :type="identityTagType(row)" size="small">{{ row.identityLabel }}</el-tag>
            <el-tag v-if="row.canLoginH5" size="small" type="info" effect="plain" class="tag-gap">可登H5</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="工号" min-width="130">
          <template #default="{ row }">
            <span v-if="row.username">{{ row.username }}</span>
            <el-tag v-else size="small" type="warning" effect="plain">未发号</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column prop="shopName" label="所属门店" min-width="140" />
        <el-table-column label="微信绑定" min-width="150">
          <template #default="{ row }">
            <span v-if="row.boundUserId || row.boundNickname || row.boundOpenidMasked">{{ row.boundNickname || row.boundUserId || row.boundOpenidMasked }}</span>
            <span v-else class="muted">未绑定</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="isDeleted(row)" type="info">已删除</el-tag>
            <el-switch v-else :model-value="row.status === 1" :loading="store.actionLoading" @change="changeStatus(row, $event)" />
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="operator-actions">
              <template v-if="isDeleted(row)">
                <el-button size="small" type="success" :loading="store.actionLoading" @click="restoreRow(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button>
              </template>
              <template v-else>
                <el-button size="small" type="primary" @click="openEditIdentity(row)"><el-icon><Edit /></el-icon>改身份</el-button>
                <el-button v-if="!row.accountIssued" size="small" type="warning" plain @click="issueAccount(row)">发号</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => { if (cmd === 'password') viewPassword(row); else if (cmd === 'history') viewHistory(row); else if (cmd === 'bind') bindWechat(row); else if (cmd === 'unbind') unbindWechat(row); else if (cmd === 'reset') resetPassword(row); else if (cmd === 'delete') removeRow(row) }">
                  <el-button size="small">更多<el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="row.accountIssued" command="password"><el-icon><Key /></el-icon>查看登录密码</el-dropdown-item>
                      <el-dropdown-item command="history">改密留痕</el-dropdown-item>
                      <el-dropdown-item v-if="row.identities?.includes('VERIFIER')" disabled>核销账号不绑微信</el-dropdown-item>
                      <el-dropdown-item v-else-if="row.boundUserId || row.boundOpenidMasked" command="unbind">解绑微信</el-dropdown-item>
                      <el-dropdown-item v-else command="bind">绑定微信</el-dropdown-item>
                      <el-dropdown-item v-if="row.accountIssued" command="reset" divided>重置密码</el-dropdown-item>
                      <el-dropdown-item command="delete" divided><span class="danger-text">删除（进回收站）</span></el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </div>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 新增 / 改身份 -->
    <el-dialog v-model="formVisible" :title="isEditing ? '修改身份' : '新增人员'" width="620px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="身份" prop="identities">
          <el-checkbox-group v-model="form.identities">
            <el-checkbox-button v-for="item in SELECTABLE_IDENTITIES" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox-button>
          </el-checkbox-group>
          <span class="muted identity-tip">可多选（如「店长 + 骑手」「骑手 + 核销店员」）；都不勾 = 仅档案</span>
        </el-form-item>
        <el-form-item label-width="0">
          <el-alert type="info" :closable="false" show-icon>
            <div class="identity-hint-box">{{ identityHints }}</div>
          </el-alert>
        </el-form-item>
        <el-form-item label="姓名" prop="name"><el-input v-model="form.name" /></el-form-item>
        <el-form-item v-if="!isEditing" label="所属门店" prop="shopId">
          <el-select v-model="form.shopId" placeholder="请选择门店" style="width: 100%">
            <el-option v-for="shop in shopStore.enabledList" :key="shop.id" :label="shop.name" :value="shop.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="11" /></el-form-item>
        <template v-if="needAccount">
          <el-form-item label="工号" prop="username"><el-input v-model="form.username" placeholder="H5 核销页登录工号（全局唯一）" /></el-form-item>
          <el-form-item :label="isEditing && editingRow?.accountIssued ? '密码（留空不改）' : '密码'" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        </template>
        <template v-if="needWechat && !isEditing">
          <el-form-item label="微信用户ID"><el-input v-model="form.wechatUserId" placeholder="wx_user.id（与 openid 二选一，必填其一）" /></el-form-item>
          <el-form-item label="微信号/openid"><el-input v-model="form.wechatOpenid" placeholder="openid 或微信号（与 userId 二选一）" /></el-form-item>
        </template>
        <el-form-item v-if="isEditing && needWechat" label-width="0">
          <el-alert title="微信绑定请用操作列「绑定微信 / 解绑微信」，此处不修改。" type="warning" :closable="false" show-icon />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving || store.actionLoading" @click="submitForm">保存</el-button></template>
    </el-dialog>

    <!-- 查看登录密码（D2，敏感） -->
    <el-dialog v-model="passwordVisible" title="查看登录密码（已记录操作日志）" width="480px" append-to-body>
      <el-skeleton v-if="passwordLoading" :rows="4" animated />
      <template v-else-if="passwordView">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="姓名">{{ passwordView.name }}</el-descriptions-item>
          <el-descriptions-item label="工号">{{ passwordView.username || '—' }}</el-descriptions-item>
          <el-descriptions-item label="登录入口">{{ passwordView.entry }}</el-descriptions-item>
          <el-descriptions-item label="登录密码">
            <span v-if="passwordView.noPlainRecord" class="danger-text">{{ passwordView.hint || '该账号为历史数据（无明文留档），请使用「重置密码」' }}</span>
            <span v-else class="plain-pwd">{{ passwordView.passwordPlain }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <p class="muted">明文仅用于本次核验，请勿记录或外传。</p>
      </template>
    </el-dialog>

    <!-- 改密留痕（D3b） -->
    <el-dialog v-model="historyVisible" title="改密留痕" width="760px" append-to-body>
      <el-table v-loading="historyLoading" :data="historyList" border size="small" max-height="420">
        <el-table-column prop="createTime" label="时间" width="180" />
        <el-table-column prop="username" label="工号" width="140" />
        <el-table-column prop="passwordBefore" label="改前" width="130" />
        <el-table-column prop="passwordAfter" label="改后" width="130" />
        <el-table-column label="类型" width="90"><template #default="{ row }">{{ row.changeType === 'CREATE' ? '建号/发号' : '重置' }}</template></el-table-column>
        <el-table-column label="操作方" width="110"><template #default="{ row }">{{ row.operatorType === 'ADMIN' ? '中控' : '商家PC' }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" />
      </el-table>
    </el-dialog>
  </section>
</template>

<style scoped>
.filter-card { margin-bottom: 16px; }
.content-card { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.toolbar-count { margin-left: 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; }
.tag-gap { margin-left: 4px; }
.selection-tip { color: var(--el-text-color-secondary); font-size: 13px; }
.muted { color: var(--el-text-color-secondary); }
.danger-text { color: var(--el-color-danger); }
/* P7 回收站：已删除行置灰 */
:deep(.row-deleted) { color: var(--el-text-color-placeholder); background: var(--el-fill-color-light); }
:deep(.row-deleted .el-tag) { opacity: .8; }
.plain-pwd { font-family: monospace; font-weight: 600; }
/* 身份多选 */
.identity-tip { margin-left: 10px; font-size: 12px; }
.identity-hint-box { white-space: pre-line; line-height: 1.7; }
</style>
