<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { getWithdrawRecords } from '@/api/withdraw'
import { useWithdrawStore } from '@/stores/withdraw'
import { useTodoStore } from '@/stores/todo'
import type { WithdrawRecord, Withdrawal } from '@/types/withdraw'
import { copyToClipboard } from '@/utils/clipboard'
import { sanitizeBonusText } from '@/utils/textSafe'
import { CircleCheck, CircleClose, CopyDocument, Download, Refresh, Search, Warning } from '@element-plus/icons-vue'

const store = useWithdrawStore()
const route = useRoute()
const todoStore = useTodoStore()
const activeTab = ref('pending')
const reasonVisible = ref(false)
const reasonTitle = ref('')
const reasonValue = ref('')
const reasonAction = ref<((reason: string) => Promise<void>) | null>(null)

function money(value: number): string { return `¥ ${Number(value || 0).toFixed(2)}` }
function statusText(status: string, statusDesc = ''): string { return sanitizeBonusText(statusDesc) || ({ PENDING_REVIEW: '待审核', APPROVED: '审核通过，等待财务打款', SUCCESS: '提现成功', FAILED: '提现失败，金额已退回', REJECTED: '已拒绝，金额已退回', STUCK: '处理异常，等待人工核对' } as Record<string, string>)[status] || status || '未知' }
function statusType(status: string): 'success' | 'warning' | 'danger' | 'info' { return status === 'SUCCESS' ? 'success' : status === 'FAILED' || status === 'REJECTED' || status === 'STUCK' ? 'danger' : status === 'PENDING_REVIEW' || status === 'APPROVED' ? 'warning' : 'info' }
/** 扣款来源文案：后端 typeDesc 优先（统一做旧词兜底替换），否则按 type 兜底映射。 */
function sourceText(row: Withdrawal): string { return sanitizeBonusText(row.typeDesc) || ({ PROMOTION: '推广金', BONUS: '红包', BALANCE: '余额' } as Record<string, string>)[row.type] || row.type || '未知来源' }
function methodText(row: Withdrawal): string { return sanitizeBonusText(row.withdrawMethodDesc) || (row.withdrawMethod === 'BANK_CARD' ? '银行卡' : row.withdrawMethod === 'WECHAT_BALANCE' ? '微信零钱' : '未知方式') }
function methodHint(row: Withdrawal): string { return row.withdrawMethod === 'BANK_CARD' ? '审核通过后由财务人工银行转账，到账后还需手动确认。' : '审核通过后进入微信零钱处理流程，审核通过不代表已到账。' }
/** HTML 转义：卡号/姓名来自接口与用户输入，拼进确认框前必须转义，避免被当成标签解析。 */
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[char] || char) }
/** 银行卡提现的收款信息（列表中展示；后端未返回卡号时明确提示，避免财务盲转）。 */
function bankCardText(row: Withdrawal): string {
  const card = String(row.bankCardSnapshot || '').trim()
  const holder = String(row.realnameSnapshot || row.maskedName || '').trim()
  return `${card || '（未返回卡号）'}${holder ? ` · 持卡人 ${holder}` : ''}`
}
/** 审核 / 手动确认前的银行卡收款信息（多行 HTML，已转义）。 */
function bankAccountConfirmHtml(row: Withdrawal): string {
  if (row.withdrawMethod !== 'BANK_CARD') return ''
  const lines = [
    '收款方式：银行卡（财务人工转账）',
    `收款卡号：${String(row.bankCardSnapshot || '').trim() || '（后端未返回卡号，请先与用户核对）'}`,
    `持卡人：${String(row.realnameSnapshot || row.maskedName || '').trim() || '（未实名）'}`,
  ]
  const phone = String(row.phone || '').trim()
  if (phone) lines.push(`手机号：${phone}`)
  return lines.map((line) => escapeHtml(line)).join('<br/>')
}
/** 复制文本（审核打款时把卡号/手机号贴到网银或对账表）。 */
async function copyField(value: string | null | undefined, label: string): Promise<void> {
  const text = String(value || '').trim()
  if (!text) { ElMessage.warning(`没有可复制的${label}`); return }
  const ok = await copyToClipboard(text)
  if (ok) ElMessage.success(`${label}已复制`)
  else ElMessage.error('复制失败，请手动选中文本复制')
}
function displayTime(value: string): string { return value || '未完成' }
function openReason(title: string, action: (reason: string) => Promise<void>): void { reasonTitle.value = title; reasonValue.value = ''; reasonAction.value = action; reasonVisible.value = true }
async function submitReason(): Promise<void> { if (!reasonValue.value.trim() || !reasonAction.value) return; try { await reasonAction.value(reasonValue.value.trim()); reasonVisible.value = false; ElMessage.success('操作成功') } catch (error) { ElMessage.error(error instanceof Error ? error.message : '操作失败') } }
async function approveWithdraw(row: Withdrawal): Promise<void> {
  const account = bankAccountConfirmHtml(row)
  try {
    // 银行卡提现：确认框里带上卡号/持卡人/手机号，财务按此人工转账（避免只看金额转错卡）
    await ElMessageBox.confirm(
      `${escapeHtml(`确认通过提现 ${row.withdrawNo} 吗？${methodHint(row)}`)}${account ? `<br/><br/>${account}` : ''}`,
      '审核通过',
      { type: 'warning', dangerouslyUseHTMLString: true },
    )
    await store.approve(row.withdrawNo)
    ElMessage.success(row.withdrawMethod === 'BANK_CARD' ? '已审核通过，请财务按收款卡号人工银行转账' : '已审核通过，进入微信零钱处理流程')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '审核失败') }
}
function rejectWithdraw(row: Withdrawal): void { openReason('拒绝提现', (reason) => store.reject(row.withdrawNo, reason)) }
async function retry(row: Withdrawal): Promise<void> { try { await ElMessageBox.confirm(`确认重试查询 ${row.withdrawNo} 的微信打款结果吗？`, '重试打款查询', { type: 'warning' }); await store.retry(row.withdrawNo); ElMessage.success('已提交重试') } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '重试失败') } }
async function manualSuccess(row: Withdrawal): Promise<void> {
  const account = bankAccountConfirmHtml(row)
  try {
    await ElMessageBox.confirm(
      `${escapeHtml(`确认提现 ${row.withdrawNo} 已按${methodText(row)}实际完成转账吗？`)}${account ? `<br/><br/>${account}` : ''}`,
      '手动确认成功',
      { type: 'warning', dangerouslyUseHTMLString: true },
    )
    await store.manualSuccess(row.withdrawNo)
    ElMessage.success('已手动确认提现成功')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '确认失败') }
}
function manualFail(row: Withdrawal): void { openReason('手动确认失败', (reason) => store.manualFail(row.withdrawNo, reason)) }
async function load(): Promise<void> { try { await store.fetchAll() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '提现数据加载失败') } }
function pageChange(value: number): void { store.page = value; void load() }
function sizeChange(value: number): void { store.size = value; store.page = 1; void load() }
/** 按 URL query 打开对应页签（待办铃铛跳 `/withdraw?status=0`，后端口径 PENDING_REVIEW）。 */
function applyQuery(): void {
  const status = route.query.status
  if (status === '0' || status === 'PENDING_REVIEW') {
    activeTab.value = 'pending'
    store.page = 1
  }
}

/** 重新套用 URL 条件并刷新（待办铃铛信号；200ms 去重避免与路由变化重复请求）。 */
let lastTodoApply = 0
function applyTodoAndReload(): void {
  const now = Date.now()
  if (now - lastTodoApply < 200) return
  lastTodoApply = now
  applyQuery()
  void load()
}

// 同一模块内点不同待办/重复点同一待办都要有反应：query 变化 + 铃铛点击信号 双保险
watch(() => route.query.status, () => { applyTodoAndReload() })
watch(() => todoStore.clickTick, () => { applyTodoAndReload() })

onMounted(() => {
  applyQuery()
  void load()
})

// ===== 提现交易记录（全量提现单，面向财务对账） =====
// 说明：本页签数据源独立于待审核 / 异常提现，分页与筛选状态互不干扰；
// 且为**懒加载**——只有首次切到该页签才发起请求，不影响进入页面时的首屏请求数。

/** 记录列表数据与分页状态。 */
const records = ref<WithdrawRecord[]>([])
const recordsLoading = ref(false)
/** 是否已成功加载过（懒加载标记：false 时切页签才请求，true 后不再自动重复请求）。 */
const recordsLoaded = ref(false)
const recordsTotal = ref(0)
const recordsPage = ref(1)
const recordsSize = ref(20)

/** 申请时间区间：界面上是日期（YYYY-MM-DD），提交时补 00:00:00 / 23:59:59。 */
const recordsDateRange = ref<[string, string] | null>(null)

/** 记录页签的筛选条件（状态为多选，其余为单选/文本精确匹配）。 */
const recordsFilters = ref<{ status: string[]; type: string; withdrawMethod: string; userId: string; withdrawNo: string; phone: string }>({
  status: [],
  type: '',
  withdrawMethod: '',
  userId: '',
  withdrawNo: '',
  phone: '',
})

/** 详情弹窗当前记录与显隐。 */
const recordDetail = ref<WithdrawRecord | null>(null)
const recordDetailVisible = ref(false)

/** 接口未发版（404 / 接口不存在）时置 true，页签内改为显示说明性提示，不再反复弹错误。 */
const recordsUnavailable = ref(false)

/** 状态选项（与后端 `AdminWithdrawVO.status` 口径一致）。 */
const RECORD_STATUS_OPTIONS = [
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '打款中', value: 'APPROVED' },
  { label: '提现成功', value: 'SUCCESS' },
  { label: '提现失败', value: 'FAILED' },
  { label: '已拒绝', value: 'REJECTED' },
  { label: '处理异常', value: 'STUCK' },
]
/** 扣款来源选项。 */
const RECORD_TYPE_OPTIONS = [
  { label: '推广金提现', value: 'PROMOTION' },
  { label: '红包提现', value: 'BONUS' },
  { label: '余额提现', value: 'BALANCE' },
]
/** 收款方式选项。 */
const RECORD_METHOD_OPTIONS = [
  { label: '微信零钱（自动转账）', value: 'WECHAT_BALANCE' },
  { label: '银行卡（财务人工转账）', value: 'BANK_CARD' },
]

/** 记录「扣款来源」文案：后端 typeDesc 优先（含旧词兜底替换），否则按 type 兜底映射。 */
function recordSourceText(row: Withdrawal): string { return sanitizeBonusText(row.typeDesc) || ({ PROMOTION: '推广金提现', BONUS: '红包提现', BALANCE: '余额提现' } as Record<string, string>)[row.type] || row.type || '未知来源' }
/** 记录「状态」文案：后端 statusDesc 优先（含旧词兜底替换），否则按 status 兜底映射。 */
function recordStatusText(row: Withdrawal): string { return sanitizeBonusText(row.statusDesc) || ({ PENDING_REVIEW: '待审核', APPROVED: '打款中', SUCCESS: '提现成功', FAILED: '提现失败', REJECTED: '已拒绝', STUCK: '处理异常' } as Record<string, string>)[row.status] || row.status || '未知' }
/** 记录「状态」标签颜色（复用与待审核/异常列表相同的口径）。 */
function recordStatusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED' || status === 'REJECTED' || status === 'STUCK') return 'danger'
  if (status === 'PENDING_REVIEW' || status === 'APPROVED') return 'warning'
  return 'info'
}

/** 查询全量提现交易记录（分页 + 组合筛选）。 */
async function loadRecords(): Promise<void> {
  recordsLoading.value = true
  try {
    const filters = recordsFilters.value
    const range = recordsDateRange.value
    const result = await getWithdrawRecords({
      // 状态多选 → 英文逗号分隔的多值参数；空数组表示不筛选
      status: filters.status.length ? filters.status.join(',') : undefined,
      type: filters.type || undefined,
      withdrawMethod: filters.withdrawMethod || undefined,
      userId: filters.userId.trim() || undefined,
      withdrawNo: filters.withdrawNo.trim() || undefined,
      phone: filters.phone.trim() || undefined,
      // 日期选择器只给到天，这里补全为后端口径的 yyyy-MM-dd HH:mm:ss
      startTime: range?.[0] ? `${range[0]} 00:00:00` : undefined,
      endTime: range?.[1] ? `${range[1]} 23:59:59` : undefined,
      page: recordsPage.value,
      size: recordsSize.value,
    })
    records.value = result.list
    recordsTotal.value = result.total
    recordsLoaded.value = true
    recordsUnavailable.value = false
  } catch (error) {
    const message = error instanceof Error ? error.message : '提现交易记录查询失败'
    // 容错：当前环境的接口未发版时会返回 404（请求拦截器已把文案归一为「接口不存在或尚未上线…」），
    // 此时在页签内展示说明性 el-alert，而不是每次切页签都弹一次错误。
    // ⚠️ 正则**不能**匹配泛化的「不存在」：业务错误里也常见（如「提现单不存在」），
    // 一旦匹配就会把真实业务错误吞掉、把整页切成"接口不可用"（今华有肽踩过同款坑）。
    if (/接口不存在|尚未上线|not\s*found|404/i.test(message)) {
      recordsUnavailable.value = true
      recordsLoaded.value = true
      records.value = []
      recordsTotal.value = 0
    } else {
      ElMessage.error(message)
    }
  } finally {
    recordsLoading.value = false
  }
}

/** 查询（条件变化后回到第 1 页）。 */
function searchRecords(): void {
  recordsPage.value = 1
  void loadRecords()
}

/** 重置全部筛选条件并重新查询。 */
function resetRecords(): void {
  recordsFilters.value = { status: [], type: '', withdrawMethod: '', userId: '', withdrawNo: '', phone: '' }
  recordsDateRange.value = null
  searchRecords()
}

/** 记录列表翻页。 */
function recordsPageChange(value: number): void { recordsPage.value = value; void loadRecords() }
/** 记录列表切换每页条数（回到第 1 页）。 */
function recordsSizeChange(value: number): void { recordsSize.value = value; recordsPage.value = 1; void loadRecords() }

/** 打开记录详情（对账时核对实名快照 / 银行卡 / 微信转账单号 / 审核人）。 */
function openRecordDetail(row: WithdrawRecord): void {
  recordDetail.value = row
  recordDetailVisible.value = true
}

/** 本地日期（YYYY-MM-DD），用于导出文件命名，避免 toISOString 的 UTC 偏移导致跨天。 */
function localDateStamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 导出**当前页**为 CSV（无导出接口，前端生成；对账可先按条件缩小范围再导出）。 */
function exportRecords(): void {
  if (!records.value.length) {
    ElMessage.warning('当前没有可导出的记录')
    return
  }
  const header = ['提现单号', '申请时间', '用户ID', '手机号', '扣款来源', '收款方式', '申请金额', '手续费', '实际到账', '状态', '完成时间', '失败原因', '微信转账单号', '审核人', '审核时间', '实名姓名', '脱敏身份证', '银行卡快照']
  const rows = records.value.map((item) => [
    item.withdrawNo,
    item.createdAt,
    item.userId,
    item.phone || '',
    recordSourceText(item),
    methodText(item),
    Number(item.amount || 0).toFixed(2),
    Number(item.feeAmount || 0).toFixed(2),
    Number(item.netAmount || 0).toFixed(2),
    recordStatusText(item),
    item.finishedAt || '',
    sanitizeBonusText(item.failReason),
    item.wxTransferBillNo || '',
    item.reviewedBy || '',
    item.reviewedAt || '',
    item.realnameSnapshot || item.maskedName || '',
    item.maskedCertNo || '',
    item.bankCardSnapshot || '',
  ])
  // CSV 单元格统一加双引号并转义内部引号，避免单号/卡号里的逗号拆列
  const escapeCell = (cell: string): string => `"${String(cell).replace(/"/g, '""')}"`
  const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\r\n')
  // BOM 保证 Excel 正确识别 UTF-8 中文
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `提现交易记录_${localDateStamp()}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出当前页 ${records.value.length} 条`)
}

// 懒加载：仅当首次切到「提现交易记录」页签时才请求数据
watch(activeTab, (tab) => {
  if (tab === 'records' && !recordsLoaded.value) void loadRecords()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading"><div><h1>提现审核</h1><p>审核用户提现申请，处理微信打款异常。</p></div><el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></div>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="待审核提现" name="pending"><el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>待审核提现</strong><span class="toolbar-count">共 {{ store.pendingTotal }} 条</span><span class="toolbar-hint">银行卡提现请在「收款账户」列核对卡号后再点通过</span></div></div><DataTable :data="store.pendingWithdrawals" :loading="store.loading" :total="store.pendingTotal" :page="store.page" :page-size="store.size" empty-text="暂无待审核提现" @page-change="pageChange" @size-change="sizeChange"><el-table-column prop="id" label="记录 ID" width="110" /><el-table-column prop="withdrawNo" label="提现单号" min-width="220" /><el-table-column prop="userId" label="用户 ID" width="110" /><el-table-column label="手机号" width="130"><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column><el-table-column label="扣款来源" width="110"><template #default="{ row }">{{ sourceText(row) }}</template></el-table-column><el-table-column label="收款账户" min-width="250"><template #default="{ row }"><div class="pay-account"><span>{{ methodText(row) }}</span><span v-if="row.withdrawMethod === 'BANK_CARD'" class="pay-card">{{ bankCardText(row) }}<el-button v-if="row.bankCardSnapshot" link type="primary" :icon="CopyDocument" @click="copyField(row.bankCardSnapshot, '银行卡号')">复制</el-button></span></div></template></el-table-column><el-table-column label="申请金额（冻结）" width="145"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column><el-table-column label="手续费" width="110"><template #default="{ row }">{{ money(row.feeAmount) }}</template></el-table-column><el-table-column label="预计到账" width="125"><template #default="{ row }">{{ money(row.netAmount) }}</template></el-table-column><el-table-column label="状态" min-width="170"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusText(row.status, row.statusDesc) }}</el-tag></template></el-table-column><el-table-column prop="createdAt" label="申请时间" min-width="180" /><el-table-column label="操作" width="220" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="success" :loading="store.actionLoading" @click="approveWithdraw(row)"><el-icon><CircleCheck /></el-icon>通过</el-button><el-button size="small" type="danger" :loading="store.actionLoading" @click="rejectWithdraw(row)"><el-icon><CircleClose /></el-icon>拒绝</el-button></div></template></el-table-column></DataTable></el-card></el-tab-pane>
      <el-tab-pane label="异常提现" name="stuck"><el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>异常提现</strong><span class="toolbar-count">共 {{ store.stuckTotal }} 条</span><span class="toolbar-hint">手动成功前请核对「收款账户」卡号与实际打款卡一致</span></div></div><DataTable :data="store.stuckWithdrawals" :loading="store.loading" :total="store.stuckTotal" :page="store.page" :page-size="store.size" empty-text="暂无异常提现" @page-change="pageChange" @size-change="sizeChange"><el-table-column prop="id" label="记录 ID" width="110" /><el-table-column prop="withdrawNo" label="提现单号" min-width="220" /><el-table-column prop="userId" label="用户 ID" width="110" /><el-table-column label="手机号" width="130"><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column><el-table-column label="扣款来源" width="110"><template #default="{ row }">{{ sourceText(row) }}</template></el-table-column><el-table-column label="收款账户" min-width="250"><template #default="{ row }"><div class="pay-account"><span>{{ methodText(row) }}</span><span v-if="row.withdrawMethod === 'BANK_CARD'" class="pay-card">{{ bankCardText(row) }}<el-button v-if="row.bankCardSnapshot" link type="primary" :icon="CopyDocument" @click="copyField(row.bankCardSnapshot, '银行卡号')">复制</el-button></span></div></template></el-table-column><el-table-column label="申请金额（冻结）" width="145"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column><el-table-column label="手续费" width="110"><template #default="{ row }">{{ money(row.feeAmount) }}</template></el-table-column><el-table-column label="预计到账" width="125"><template #default="{ row }">{{ money(row.netAmount) }}</template></el-table-column><el-table-column label="状态" min-width="170"><template #default="{ row }"><el-tag :type="statusType(row.status)"><el-icon><Warning /></el-icon>{{ statusText(row.status, row.statusDesc) }}</el-tag></template></el-table-column><el-table-column prop="failReason" label="失败/异常原因" min-width="190" /><el-table-column prop="createdAt" label="申请时间" min-width="180" /><el-table-column prop="finishedAt" label="完成时间" min-width="170" /><el-table-column label="操作" width="330" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button v-if="row.withdrawMethod !== 'BANK_CARD'" size="small" type="primary" :loading="store.actionLoading" @click="retry(row)"><el-icon><Refresh /></el-icon>重试</el-button><el-button size="small" type="success" :loading="store.actionLoading" @click="manualSuccess(row)">手动成功</el-button><el-button size="small" type="danger" :loading="store.actionLoading" @click="manualFail(row)">手动失败</el-button></div></template></el-table-column></DataTable></el-card></el-tab-pane>
      <!-- 提现交易记录：全量提现单（所有状态），面向财务对账；数据源 GET /api/admin/withdraw/records -->
      <el-tab-pane label="提现交易记录" name="records">
        <el-card shadow="never" class="content-card">
          <!-- 容错：接口未发版（404 / 接口不存在）时给出说明，不再反复弹错误 -->
          <el-alert
            v-if="recordsUnavailable"
            type="warning"
            :closable="false"
            show-icon
            class="records-alert"
            title="当前环境的「提现交易记录」接口不可用（返回 404 / 接口不存在），暂时查不到数据。请确认后端版本是否已包含 GET /api/admin/withdraw/records。"
          />
          <el-form inline class="records-form" @submit.prevent="searchRecords">
            <el-form-item label="状态">
              <el-select v-model="recordsFilters.status" multiple collapse-tags clearable placeholder="全部状态" style="width: 260px">
                <el-option v-for="item in RECORD_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="扣款来源">
              <el-select v-model="recordsFilters.type" clearable placeholder="全部" style="width: 150px">
                <el-option v-for="item in RECORD_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="收款方式">
              <el-select v-model="recordsFilters.withdrawMethod" clearable placeholder="全部" style="width: 210px">
                <el-option v-for="item in RECORD_METHOD_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="申请时间">
              <el-date-picker v-model="recordsDateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
            </el-form-item>
            <el-form-item label="用户 ID"><el-input v-model="recordsFilters.userId" clearable placeholder="精确匹配" style="width: 140px" /></el-form-item>
            <el-form-item label="提现单号"><el-input v-model="recordsFilters.withdrawNo" clearable placeholder="精确匹配" style="width: 210px" /></el-form-item>
            <el-form-item label="手机号"><el-input v-model="recordsFilters.phone" clearable placeholder="精确匹配" style="width: 150px" /></el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" :loading="recordsLoading" @click="searchRecords">查询</el-button>
              <el-button @click="resetRecords">重置</el-button>
              <el-button :icon="Download" :disabled="!records.length" @click="exportRecords">导出当前页</el-button>
            </el-form-item>
          </el-form>
          <DataTable
            :data="records"
            :loading="recordsLoading"
            :total="recordsTotal"
            :page="recordsPage"
            :page-size="recordsSize"
            row-key="withdrawNo"
            empty-text="暂无提现交易记录"
            @page-change="recordsPageChange"
            @size-change="recordsSizeChange"
          >
            <el-table-column prop="withdrawNo" label="提现单号" min-width="200" />
            <el-table-column prop="createdAt" label="申请时间" min-width="180" />
            <el-table-column prop="userId" label="用户 ID" width="110" />
            <el-table-column label="手机号" width="140"><template #default="{ row }">{{ row.phone || '—' }}</template></el-table-column>
            <el-table-column label="扣款来源" width="120"><template #default="{ row }">{{ recordSourceText(row) }}</template></el-table-column>
            <el-table-column label="收款方式" width="130"><template #default="{ row }">{{ methodText(row) }}</template></el-table-column>
            <el-table-column label="申请金额" width="120"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
            <el-table-column label="手续费" width="100"><template #default="{ row }">{{ money(row.feeAmount) }}</template></el-table-column>
            <el-table-column label="实际到账" width="120"><template #default="{ row }">{{ money(row.netAmount) }}</template></el-table-column>
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="recordStatusType(row.status)">{{ recordStatusText(row) }}</el-tag></template></el-table-column>
            <el-table-column label="完成时间" min-width="170"><template #default="{ row }">{{ row.finishedAt || '未完成' }}</template></el-table-column>
            <el-table-column label="微信转账单号" min-width="220">
              <template #default="{ row }">
                <span v-if="row.wxTransferBillNo">{{ row.wxTransferBillNo }}</span>
                <span v-else class="muted">—（银行卡提现无微信单号）</span>
              </template>
            </el-table-column>
            <el-table-column label="审核人" width="120"><template #default="{ row }">{{ row.reviewedBy || '未审核' }}</template></el-table-column>
            <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openRecordDetail(row)">详情</el-button></template></el-table-column>
          </DataTable>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 提现记录详情（对账：实名快照 / 银行卡快照 / 微信转账单号 / 审核人；字段有值才展示） -->
    <el-dialog v-model="recordDetailVisible" title="提现记录详情" width="680px" append-to-body>
      <el-descriptions v-if="recordDetail" :column="2" border size="small">
        <el-descriptions-item label="提现单号">
          {{ recordDetail.withdrawNo }}
          <el-button link type="primary" :icon="CopyDocument" @click="copyField(recordDetail?.withdrawNo, '提现单号')">复制</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="状态"><el-tag :type="recordStatusType(recordDetail.status)">{{ recordStatusText(recordDetail) }}</el-tag></el-descriptions-item>
        <el-descriptions-item label="用户 ID">{{ recordDetail.userId || '—' }}</el-descriptions-item>
        <el-descriptions-item label="手机号">
          {{ recordDetail.phone || '—' }}
          <el-button v-if="recordDetail.phone" link type="primary" :icon="CopyDocument" @click="copyField(recordDetail?.phone, '手机号')">复制</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="扣款来源">{{ recordSourceText(recordDetail) }}</el-descriptions-item>
        <el-descriptions-item label="收款方式">{{ methodText(recordDetail) }}</el-descriptions-item>
        <el-descriptions-item label="申请金额">{{ money(recordDetail.amount) }}</el-descriptions-item>
        <el-descriptions-item label="手续费">{{ money(recordDetail.feeAmount) }}</el-descriptions-item>
        <el-descriptions-item label="实际到账">{{ money(recordDetail.netAmount) }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.wxTransferBillNo" label="微信转账单号">
          {{ recordDetail.wxTransferBillNo }}
          <el-button link type="primary" :icon="CopyDocument" @click="copyField(recordDetail?.wxTransferBillNo, '微信转账单号')">复制</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="申请时间">{{ recordDetail.createdAt || '—' }}</el-descriptions-item>
        <el-descriptions-item label="完成时间">{{ recordDetail.finishedAt || '未完成' }}</el-descriptions-item>
        <!-- 以下为对账增强字段，后端返回才有值 -->
        <el-descriptions-item v-if="recordDetail.realnameSnapshot || recordDetail.maskedName" label="实名快照">{{ recordDetail.realnameSnapshot || recordDetail.maskedName }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.maskedCertNo" label="脱敏身份证">{{ recordDetail.maskedCertNo }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.bankCardSnapshot" label="银行卡快照" :span="2">{{ recordDetail.bankCardSnapshot }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.reviewedBy" label="审核人">{{ recordDetail.reviewedBy }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.reviewedAt" label="审核时间">{{ recordDetail.reviewedAt }}</el-descriptions-item>
        <el-descriptions-item v-if="recordDetail.failReason" label="失败原因" :span="2">{{ sanitizeBonusText(recordDetail.failReason) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer><el-button @click="recordDetailVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="reasonVisible" :title="reasonTitle" width="460px" append-to-body><el-input v-model="reasonValue" type="textarea" :rows="4" placeholder="请输入原因" /><template #footer><el-button @click="reasonVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitReason">确定</el-button></template></el-dialog>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
/* 收款账户列：银行卡提现展示卡号 + 持卡人（财务人工转账前核对） */
.pay-account { display: flex; flex-direction: column; gap: 2px; line-height: 18px; }
.pay-card { color: var(--el-color-primary); word-break: break-all; }
.toolbar-hint { margin-left: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
/* ===== 提现交易记录页签（新增，样式独立，不影响前两个页签） ===== */
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.records-alert { margin-bottom: 12px; }
.records-form :deep(.el-form-item) { margin-bottom: 12px; }
</style>
