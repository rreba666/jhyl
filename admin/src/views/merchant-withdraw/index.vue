<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules, UploadRequestOptions } from 'element-plus'
import { CircleCheck, CircleClose, CopyDocument, Document, Refresh, Search, Upload } from '@element-plus/icons-vue'
import DataTable from '@/components/DataTable.vue'
import {
  MerchantWithdrawApiError,
  WITHDRAW_STATUS_CHANGED_CODE,
  approveMerchantWithdraw,
  confirmMerchantWithdrawPaid,
  failMerchantWithdraw,
  getMerchantWithdrawDetail,
  getMerchantWithdrawList,
  getMerchantWithdrawSummary,
  rejectMerchantWithdraw,
  uploadMerchantWithdrawVoucher,
} from '@/api/merchantWithdraw'
import { MERCHANT_WITHDRAW_STATUS } from '@/types/merchantWithdraw'
import type { MerchantWithdrawOrder, MerchantWithdrawSummary } from '@/types/merchantWithdraw'
import { copyToClipboard } from '@/utils/clipboard'

/**
 * 商户提现审核（平台财务端）—— 后端积木 `fengling-settlement`。
 *
 * ⚠️ 与既有「提现审核」`/withdraw`（C 端**用户**提现）**是两套业务**：
 * 本页审的是**商家（品牌主体）**按发票发起的提现（`merchant_withdraw_order`），
 * 默认只看 `PENDING_REVIEW`，操作有 通过 / 驳回 / 确认打款 / 打款失败 四个。
 *
 * 财务的核心动作是**「三数核对」**（开发文档 §3.3 / §4）：
 *   ① 发票图上的票面金额（人工看图） ② `balanceSnapshot`（**提交时**的可提现余额快照）
 *   ③ `amount`（商家申请金额）
 * 因而详情抽屉把这三块**并排展示**，并把 `invoiceAmount` / `invoiceNo` 放在旁边对照。
 *
 * 接口（7 条，见开发文档 §3）：
 *   GET  /list · /summary · /{withdrawNo}
 *   PUT  /{withdrawNo}/approve · /reject · /confirm-paid · /fail
 */

// ===== 常量与字典 =====

/** 页签/筛选用的状态字典（与后端 `merchant_withdraw_order.status` 一致）。 */
const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '待财务审核', value: MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW },
  { label: '待打款', value: MERCHANT_WITHDRAW_STATUS.APPROVED },
  { label: '已打款', value: MERCHANT_WITHDRAW_STATUS.SUCCESS },
  { label: '已驳回', value: MERCHANT_WITHDRAW_STATUS.REJECTED },
  { label: '打款失败', value: MERCHANT_WITHDRAW_STATUS.FAILED },
]

/** 状态中文文案（开发文档 §2.6 表格口径）。 */
const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: '待财务审核',
  APPROVED: '待打款',
  SUCCESS: '已打款',
  REJECTED: '已驳回',
  FAILED: '打款失败',
}

/** 收款方式文案。 */
const PAYEE_TYPE_LABELS: Record<string, string> = {
  WECHAT: '微信',
  BANK_CARD: '银行卡',
}

/** 列表每页条数可选值。 */
const PAGE_SIZES = [10, 20, 50, 100]

// ===== 列表状态 =====
const rows = ref<MerchantWithdrawOrder[]>([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const size = ref(20)
/** 筛选条件：`status` 多选（默认只选「待财务审核」，即财务待办口径）；`keyword` 匹配单号/申请人/收款人/收款账号。 */
const filters = ref<{ status: string[]; keyword: string }>({
  status: [MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW],
  keyword: '',
})

// ===== 汇总状态（顶部两张卡片）=====
const summary = ref<MerchantWithdrawSummary>({ pendingCount: 0, pendingAmount: 0 })
const summaryLoading = ref(false)

// ===== 详情抽屉状态 =====
const detailVisible = ref(false)
const detail = ref<MerchantWithdrawOrder | null>(null)
const detailLoading = ref(false)

// ===== 操作弹窗状态 =====
/** 当前正在执行操作的提现单号（按钮 loading 与防重复提交）。 */
const actionLoading = ref(false)

/** 驳回弹窗（remark **必填**）。 */
const rejectVisible = ref(false)
const rejectFormRef = ref<FormInstance>()
const rejectForm = ref<{ remark: string }>({ remark: '' })
const rejectRules: FormRules = {
  remark: [{ required: true, message: '驳回原因必填，请填写后提交', trigger: 'blur' }],
}

/** 确认打款弹窗（`payNo` / `payVoucherUrl` / `remark` 均选填）。 */
const paidVisible = ref(false)
const paidForm = ref<{ payNo: string; payVoucherUrl: string; remark: string }>({ payNo: '', payVoucherUrl: '', remark: '' })
/** 打款回单上传中（上传期间禁用提交）。 */
const voucherUploading = ref(false)
/** 通用备注弹窗（通过 / 打款失败共用，remark 选填）。 */
const remarkVisible = ref(false)
const remarkTitle = ref('')
const remarkPlaceholder = ref('')
const remarkValue = ref('')
/**
 * 备注弹窗的提交动作：`approve` = 带备注审核通过；`fail` = 标记打款失败。
 * ⚠️ 用显式状态而不是「按标题文案 includes('失败') 猜动作」——文案一改就会静默跑错接口。
 */
const remarkMode = ref<'approve' | 'fail'>('approve')

// ===== 展示工具函数 =====

/** 金额格式化（两位小数，带 ¥）。 */
function money(value: number | null | undefined): string {
  return `¥ ${Number(value ?? 0).toFixed(2)}`
}

/** 时间展示：后端口径为 `yyyy-MM-ddTHH:mm:ss`，把 `T` 换成空格便于阅读。 */
function displayTime(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return '—'
  return text.replace('T', ' ')
}

/** 状态中文文案（未知状态原样回显，避免显示空白）。 */
function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status || '未知状态'
}

/** 状态标签颜色。 */
function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'primary' | 'info' {
  if (status === MERCHANT_WITHDRAW_STATUS.SUCCESS) return 'success'
  if (status === MERCHANT_WITHDRAW_STATUS.APPROVED) return 'primary'
  if (status === MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW) return 'warning'
  if (status === MERCHANT_WITHDRAW_STATUS.REJECTED || status === MERCHANT_WITHDRAW_STATUS.FAILED) return 'danger'
  return 'info'
}

/** 收款方式文案。 */
function payeeTypeLabel(value: string): string {
  return PAYEE_TYPE_LABELS[value] || value || '未填写'
}

/** 申请人展示：`applyName` 为空时回退到申请账号 ID（避免出现空单元格）。 */
function applicantText(row: MerchantWithdrawOrder): string {
  const name = String(row.applyName || '').trim()
  if (name) return name
  return row.applyStaffId ? `店员#${row.applyStaffId}` : row.applyUserId ? `用户#${row.applyUserId}` : '—'
}

/** 三数是否一致（判断用字符串比，避免浮点直接比较的误差）。 */
function threeNumbersMatched(row: MerchantWithdrawOrder): boolean {
  const amount = Number(row.amount).toFixed(2)
  return Number(row.invoiceAmount).toFixed(2) === amount && Number(row.balanceSnapshot).toFixed(2) === amount
}

/** 复制文本（财务把收款账号贴到网银 / 微信转账时用）。 */
async function copyField(value: string | null | undefined, label: string): Promise<void> {
  const text = String(value ?? '').trim()
  if (!text) {
    ElMessage.warning(`没有可复制的${label}`)
    return
  }
  const ok = await copyToClipboard(text)
  if (ok) ElMessage.success(`${label}已复制`)
  else ElMessage.error('复制失败，请手动选中文本复制')
}

/** HTML 转义：提现单号 / 收款信息来自接口，拼进确认框前必须转义，避免被当成标签解析。 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[char] || char)
}

/** 操作按钮的可用性判断（与后端状态机一致，见开发文档 §4）。 */
function canApprove(row: MerchantWithdrawOrder): boolean {
  return row.status === MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW
}
function canReject(row: MerchantWithdrawOrder): boolean {
  return row.status === MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW
}
/**
 * 确认打款允许从 `APPROVED` **或** `PENDING_REVIEW` 执行
 * （后端支持财务在一个弹窗里做完"核对 + 打款"，见开发文档 §3.4）。
 */
function canConfirmPaid(row: MerchantWithdrawOrder): boolean {
  return row.status === MERCHANT_WITHDRAW_STATUS.APPROVED || row.status === MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW
}
/** 打款失败仅对「待打款」开放（`PENDING_REVIEW` 还没进入打款环节）。 */
function canMarkFailed(row: MerchantWithdrawOrder): boolean {
  return row.status === MERCHANT_WITHDRAW_STATUS.APPROVED
}

// ===== 数据加载 =====

/** 拼接列表查询参数：状态多选 → 英文逗号分隔的多值；空数组 = 不筛选（看全部）。 */
function buildQuery(): { status?: string; keyword?: string } {
  const status = filters.value.status.length ? filters.value.status.join(',') : ''
  const keyword = filters.value.keyword.trim()
  return {
    status: status || undefined,
    keyword: keyword || undefined,
  }
}

/** 查询列表（分页 + 筛选）。 */
async function loadList(): Promise<void> {
  loading.value = true
  try {
    const result = await getMerchantWithdrawList({ ...buildQuery(), page: page.value, size: size.value })
    rows.value = result.list
    total.value = result.total
    // 分页字段以后端返回为准（后端可能对 size 做上限截断）
    page.value = result.page
    size.value = result.pageSize
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '商户提现列表查询失败')
  } finally {
    loading.value = false
  }
}

/** 查询待办汇总（待审核笔数 + 金额）。 */
async function loadSummary(): Promise<void> {
  summaryLoading.value = true
  try {
    summary.value = await getMerchantWithdrawSummary()
  } catch (error) {
    // 汇总失败不阻塞列表（权限/接口异常时列表才是主视图），仅重置为 0 并提示
    summary.value = { pendingCount: 0, pendingAmount: 0 }
    ElMessage.error(error instanceof Error ? error.message : '商户提现汇总查询失败')
  } finally {
    summaryLoading.value = false
  }
}

/** 列表 + 汇总一起刷新（每个操作成功后、以及 13015 并发冲突后都必须调用）。 */
async function reload(): Promise<void> {
  await Promise.all([loadList(), loadSummary()])
}

/** 点击查询（条件变化后回到第 1 页）。 */
function search(): void {
  page.value = 1
  void loadList()
}

/** 重置筛选：状态回到「待财务审核」，关键词清空。 */
function resetFilters(): void {
  filters.value = { status: [MERCHANT_WITHDRAW_STATUS.PENDING_REVIEW], keyword: '' }
  search()
}

/** 翻页。 */
function pageChange(value: number): void {
  page.value = value
  void loadList()
}

/** 切换每页条数（回到第 1 页）。 */
function sizeChange(value: number): void {
  size.value = value
  page.value = 1
  void loadList()
}

// ===== 详情（三数核对）=====

/**
 * 打开详情抽屉并**重新拉一次详情接口**（而不是直接用列表行）：
 * 列表可能是几分钟前拉的，财务核对前看到的必须是**最新**状态与金额快照。
 * 拉取失败时退化为使用列表行（至少不阻断核对），并提示失败原因。
 */
async function openDetail(row: MerchantWithdrawOrder): Promise<void> {
  detail.value = row
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await getMerchantWithdrawDetail(row.withdrawNo)
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '提现单详情查询失败，展示的是列表数据')
  } finally {
    detailLoading.value = false
  }
}

/** 操作成功后刷新抽屉里的详情（抽屉开着时必须同步，否则财务看到的是旧状态）。 */
async function refreshDetail(): Promise<void> {
  const no = detail.value?.withdrawNo
  if (!no) return
  try {
    detail.value = await getMerchantWithdrawDetail(no)
  } catch {
    // 详情刷新失败不影响主流程（列表与汇总已刷新），下次打开抽屉会重新拉取
  }
}

// ===== 四个操作 =====

/**
 * 统一的操作收口：执行 → 提示 → **刷新列表 + 汇总**（+ 详情）。
 *
 * ⚠️ `13015 提现单状态已变化，请刷新后重试` 是并发操作（别人先处理了 / 自己重复点击）的**正常结果**，
 * 必须明确提示并刷新数据，而不是当普通报错。这里通过 {@link MerchantWithdrawApiError} 的 `code` 识别；
 * 同时用文案兜底匹配（后端若未透传 code 也不漏）。
 */
async function runAction(label: string, action: () => Promise<void>, successText: string): Promise<void> {
  actionLoading.value = true
  try {
    await action()
    ElMessage.success(successText)
    await reload()
    await refreshDetail()
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label}失败`
    const code = error instanceof MerchantWithdrawApiError ? error.code : null
    if (code === WITHDRAW_STATUS_CHANGED_CODE || message.includes('13015') || message.includes('状态已变化')) {
      ElMessage.warning('提现单状态已变化，请刷新后重试（列表已自动刷新）')
      page.value = 1
      await reload()
      await refreshDetail()
    } else {
      ElMessage.error(message)
    }
  } finally {
    actionLoading.value = false
  }
}

/** 通过（`approve` → `APPROVED`）：二次确认里带上收款信息与三数，避免看错单。 */
async function handleApprove(row: MerchantWithdrawOrder): Promise<void> {
  // 列表行与抽屉共用同一份「当前单」，保证操作后的详情刷新落在正确的单号上
  detail.value = row
  try {
    const lines = [
      `确认通过提现单 ${row.withdrawNo} 吗？`,
      `申请金额：${money(row.amount)}（通过后进入「待打款」，**还没到账**）`,
      `收款方式：${payeeTypeLabel(row.payeeType)}`,
      `收款人：${row.payeeName || '（未填写）'}`,
      `收款账号：${row.payeeAccount || '（未填写）'}`,
    ]
    await ElMessageBox.confirm(lines.map(escapeHtml).join('<br/>'), '审核通过', {
      type: 'warning',
      dangerouslyUseHTMLString: true,
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
    })
  } catch (error) {
    // 用户取消不算失败
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('确认框渲染失败，请重试')
    return
  }
  await runAction('审核通过', () => approveMerchantWithdraw(row.withdrawNo), '已审核通过，提现单进入「待打款」，请线下转账后回填打款信息')
}

/** 打开驳回弹窗（remark **必填**）。 */
function openReject(row: MerchantWithdrawOrder): void {
  detail.value = row
  rejectForm.value = { remark: '' }
  rejectVisible.value = true
}

/** 提交驳回（表单校验 remark 必填）。 */
async function submitReject(): Promise<void> {
  const form = rejectFormRef.value
  if (!form) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return
  const remark = rejectForm.value.remark.trim()
  if (!remark) {
    ElMessage.warning('驳回原因必填，请填写后提交')
    return
  }
  const row = detail.value
  if (!row) return
  await runAction('驳回', () => rejectMerchantWithdraw(row.withdrawNo, remark), '已驳回，该笔提现的冻结金额已立即解冻回商户可提现余额')
  rejectVisible.value = false
}

/** 打开确认打款弹窗（从 `APPROVED` 或 `PENDING_REVIEW` 都可执行）。 */
function openConfirmPaid(row: MerchantWithdrawOrder): void {
  detail.value = row
  paidForm.value = { payNo: '', payVoucherUrl: '', remark: '' }
  paidVisible.value = true
}

/** 提交确认打款（成功即 `SUCCESS`，冻结真正出账）。 */
async function submitConfirmPaid(): Promise<void> {
  const row = detail.value
  if (!row) return
  // `payNo` / `payVoucherUrl` 后端与需求都是**选填**，但两者都空时无法对账 → 只做一次二次确认，不硬拦
  if (!paidForm.value.payNo.trim() && !paidForm.value.payVoucherUrl.trim()) {
    try {
      await ElMessageBox.confirm('未填写打款流水号与打款回单，后续对账将缺少凭证。确认已在【线下完成转账】并继续提交吗？', '缺少打款凭证', {
        type: 'warning',
        confirmButtonText: '确认已打款',
        cancelButtonText: '返回填写',
      })
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error('确认框渲染失败，请重试')
      return
    }
  }
  await runAction(
    '确认打款',
    () =>
      confirmMerchantWithdrawPaid(row.withdrawNo, {
        payNo: paidForm.value.payNo.trim(),
        payVoucherUrl: paidForm.value.payVoucherUrl.trim(),
        remark: paidForm.value.remark.trim(),
      }),
    '已确认打款，该笔提现完成',
  )
  paidVisible.value = false
}

/** 上传打款回单（`POST /api/common/upload` → OSS 直链，回填到 `payVoucherUrl`）。 */
async function uploadVoucher(options: UploadRequestOptions): Promise<void> {
  voucherUploading.value = true
  try {
    // 只支持图片格式与 10MB 上限（与上传接口限制一致），前置拦掉避免白传
    const file = options.file
    if (file.size > 10 * 1024 * 1024) {
      ElMessage.error('打款回单图片不能超过 10MB')
      return
    }
    paidForm.value.payVoucherUrl = await uploadMerchantWithdrawVoucher(file)
    ElMessage.success('打款回单已上传')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '打款回单上传失败')
  } finally {
    voucherUploading.value = false
  }
}

/**
 * 打开通用备注弹窗（通过 / 打款失败共用，remark 选填）。
 * @param mode 提交动作：`approve` 审核通过 / `fail` 标记打款失败
 */
function openRemarkDialog(mode: 'approve' | 'fail', title: string, placeholder: string): void {
  remarkMode.value = mode
  remarkTitle.value = title
  remarkPlaceholder.value = placeholder
  remarkValue.value = ''
  remarkVisible.value = true
}

/** 备注弹窗提交：按 {@link remarkMode} 分发到对应接口（remark 为空也允许提交，即"不填备注"）。 */
async function submitRemarkDialog(): Promise<void> {
  if (remarkMode.value === 'fail') await submitFail()
  else await submitApproveWithRemark()
}

/** 通过（带可选备注版本）：先填备注再调用，备注为空也能提交。 */
async function submitApproveWithRemark(): Promise<void> {
  const row = detail.value
  if (!row) return
  const remark = remarkValue.value.trim()
  remarkVisible.value = false
  await runAction('审核通过', () => approveMerchantWithdraw(row.withdrawNo, remark || undefined), '已审核通过，提现单进入「待打款」')
}

/** 打款失败（remark 选填，如"收款账号有误"）。 */
async function submitFail(): Promise<void> {
  const row = detail.value
  if (!row) return
  const remark = remarkValue.value.trim()
  remarkVisible.value = false
  await runAction('标记打款失败', () => failMerchantWithdraw(row.withdrawNo, remark || undefined), '已标记打款失败，冻结金额已解冻回商户可提现余额')
}

/** 三数不对齐时给出显式提示（财务据此决定驳回而不是硬着头皮打款）。 */
const threeNumberHint = computed(() => {
  const row = detail.value
  if (!row) return ''
  if (threeNumbersMatched(row)) return '三数一致（发票金额 = 余额快照 = 申请金额），请再人工核对发票票面金额后放行。'
  return '⚠️ 发票金额 / 余额快照 / 申请金额不一致，请人工核对发票票面金额后再决定通过或驳回。'
})

onMounted(() => {
  void reload()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>商户提现审核</h1>
        <p>审核商户（品牌主体）按发票发起的提现申请：核对「发票金额 / 余额快照 / 申请金额」三数后通过、驳回，或线下转账后确认打款。</p>
      </div>
      <el-button :loading="loading || summaryLoading" @click="reload"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <!-- 顶部汇总卡：待财务审核笔数 + 金额合计（GET /summary） -->
    <section v-loading="summaryLoading" class="stat-grid">
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">待财务审核笔数</span>
        <strong class="stat-value">{{ summary.pendingCount }}</strong>
        <span class="stat-hint">状态为「待财务审核」的提现单数量</span>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">待审核金额合计</span>
        <strong class="stat-value">{{ money(summary.pendingAmount) }}</strong>
        <span class="stat-hint">这些申请此刻在商户账户里是冻结状态，驳回 / 打款失败会立刻解冻</span>
      </el-card>
    </section>

    <!-- 筛选区：状态多选（默认只选待财务审核）+ 关键词 -->
    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="状态">
          <el-select v-model="filters.status" multiple collapse-tags clearable placeholder="全部状态（不选=全部）" style="width: 300px">
            <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" clearable placeholder="提现单号 / 申请人 / 收款人 / 收款账号" style="width: 300px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" :loading="loading" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div>
          <strong>提现单列表</strong>
          <span class="toolbar-count">共 {{ total }} 条</span>
          <span class="toolbar-hint">点「详情」进入三数核对；通过后还需线下转账再点「确认打款」</span>
        </div>
      </div>
      <DataTable
        :data="rows"
        :loading="loading"
        :total="total"
        :page="page"
        :page-size="size"
        :page-sizes="PAGE_SIZES"
        row-key="id"
        empty-text="暂无商户提现单"
        @page-change="pageChange"
        @size-change="sizeChange"
      >
        <el-table-column prop="withdrawNo" label="提现单号" min-width="200" />
        <el-table-column label="申请时间" min-width="170">
          <template #default="{ row }">{{ displayTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="申请人" min-width="130">
          <template #default="{ row }">{{ applicantText(row) }}</template>
        </el-table-column>
        <el-table-column label="申请金额" width="120">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="发票金额" width="120">
          <template #default="{ row }">
            <span :class="{ 'value-mismatch': Number(row.invoiceAmount).toFixed(2) !== Number(row.amount).toFixed(2) }">{{ money(row.invoiceAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="余额快照" width="120">
          <template #default="{ row }">{{ money(row.balanceSnapshot) }}</template>
        </el-table-column>
        <el-table-column label="收款信息" min-width="230">
          <template #default="{ row }">
            <div class="payee-cell">
              <span>{{ payeeTypeLabel(row.payeeType) }} · {{ row.payeeName || '（未填写收款人）' }}</span>
              <span class="payee-account">{{ row.payeeAccount || '（未填写收款账号）' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }"><el-tag :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="审核意见 / 打款信息" min-width="190">
          <template #default="{ row }">
            <!-- 已驳回 / 打款失败：展示后端下发的原因；已打款：展示打款流水号与时间（列表即可对账） -->
            <span v-if="row.reviewRemark" :class="{ 'value-mismatch': row.status === 'REJECTED' || row.status === 'FAILED' }">{{ row.reviewRemark }}</span>
            <span v-else-if="row.status === 'SUCCESS'">{{ row.payNo || '未回填流水号' }} · {{ displayTime(row.paidAt) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button v-if="canApprove(row)" link type="success" :disabled="actionLoading" @click="handleApprove(row)">通过</el-button>
              <el-button v-if="canReject(row)" link type="danger" :disabled="actionLoading" @click="openReject(row)">驳回</el-button>
              <el-button v-if="canConfirmPaid(row)" link type="primary" :disabled="actionLoading" @click="openConfirmPaid(row)">确认打款</el-button>
              <el-button v-if="canMarkFailed(row)" link type="warning" :disabled="actionLoading" @click="openRemarkDialog('fail', '标记打款失败', '请填写失败原因，如：收款账号有误（选填）')">打款失败</el-button>
            </div>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 详情抽屉：三数核对（① 发票图 ② 余额快照 ③ 申请金额 并排）+ 收款信息 + 四个操作 -->
    <el-drawer v-model="detailVisible" title="商户提现详情 · 三数核对" size="900px" :destroy-on-close="true">
      <div v-if="detail" v-loading="detailLoading" class="detail-body">
        <div class="detail-head">
          <div class="detail-no">
            <span class="detail-no-label">提现单号</span>
            <strong>{{ detail.withdrawNo }}</strong>
            <el-button link type="primary" :icon="CopyDocument" @click="copyField(detail.withdrawNo, '提现单号')">复制</el-button>
          </div>
          <el-tag :type="statusTagType(detail.status)" size="large">{{ statusLabel(detail.status) }}</el-tag>
        </div>

        <!-- ① ② ③ 三块并排 -->
        <section class="triple-grid">
          <el-card shadow="never" class="triple-card">
            <span class="triple-index">①</span>
            <span class="triple-label">发票图（人工看票面金额）</span>
            <div v-if="detail.invoiceImages.length" class="invoice-grid">
              <el-image
                v-for="(url, index) in detail.invoiceImages"
                :key="`${url}-${index}`"
                class="invoice-thumb"
                :src="url"
                :preview-src-list="detail.invoiceImages"
                :initial-index="index"
                fit="cover"
                preview-teleported
              >
                <template #error><div class="invoice-error"><el-icon><Document /></el-icon><span>图片加载失败</span></div></template>
              </el-image>
            </div>
            <div v-else class="triple-empty">后端未返回发票图片（invoiceImages 解析为空数组）</div>
            <span class="triple-hint">共 {{ detail.invoiceImages.length }} 张（上传规则为 1~6 张）；点击图片可放大查看票面金额</span>
          </el-card>

          <el-card shadow="never" class="triple-card">
            <span class="triple-index">②</span>
            <span class="triple-label">提交时可提现余额快照</span>
            <strong class="triple-value">{{ money(detail.balanceSnapshot) }}</strong>
            <span class="triple-hint">该金额是商家提交申请那一刻的余额快照，不随后续余额变动而变</span>
          </el-card>

          <el-card shadow="never" class="triple-card">
            <span class="triple-index">③</span>
            <span class="triple-label">商家申请金额</span>
            <strong class="triple-value">{{ money(detail.amount) }}</strong>
            <span class="triple-hint">本次申请的提现金额，也是提交时被冻结的金额</span>
          </el-card>
        </section>

        <el-alert
          :type="threeNumbersMatched(detail) ? 'success' : 'warning'"
          :closable="false"
          show-icon
          class="triple-alert"
          :title="threeNumberHint"
        />

        <!-- 对照字段 -->
        <el-descriptions :column="2" border size="small" class="detail-desc">
          <el-descriptions-item label="发票金额（invoiceAmount）">{{ money(detail.invoiceAmount) }}</el-descriptions-item>
          <el-descriptions-item label="发票号（invoiceNo）">{{ detail.invoiceNo || '未填写' }}</el-descriptions-item>
          <el-descriptions-item label="申请时间">{{ displayTime(detail.createTime) }}</el-descriptions-item>
          <el-descriptions-item label="商户 ID">{{ detail.merchantId || '—' }}</el-descriptions-item>
          <el-descriptions-item label="申请人">{{ applicantText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="主体类型">{{ detail.subjectType || '—' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 收款信息（人工线下转账依据） -->
        <div class="section-title">收款信息（财务线下转账依据）</div>
        <el-descriptions :column="2" border size="small" class="detail-desc">
          <el-descriptions-item label="收款方式">{{ payeeTypeLabel(detail.payeeType) }}</el-descriptions-item>
          <el-descriptions-item label="收款人姓名">{{ detail.payeeName || '（未填写）' }}</el-descriptions-item>
          <el-descriptions-item label="收款账号" :span="2">
            <span class="payee-account-value">{{ detail.payeeAccount || '（未填写）' }}</span>
            <el-button v-if="detail.payeeAccount" link type="primary" :icon="CopyDocument" @click="copyField(detail.payeeAccount, '收款账号')">复制</el-button>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.payeeQrUrl" label="收款码" :span="2">
            <el-image class="payee-qr" :src="detail.payeeQrUrl" :preview-src-list="[detail.payeeQrUrl]" fit="contain" preview-teleported />
          </el-descriptions-item>
        </el-descriptions>

        <!-- 处理结果（按状态展示） -->
        <template v-if="detail.status === 'SUCCESS' || detail.status === 'REJECTED' || detail.status === 'FAILED' || detail.payNo || detail.reviewRemark">
          <div class="section-title">处理结果</div>
          <el-descriptions :column="2" border size="small" class="detail-desc">
            <el-descriptions-item v-if="detail.status === 'SUCCESS'" label="打款流水号（payNo）">{{ detail.payNo || '未回填' }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.status === 'SUCCESS'" label="打款时间（paidAt）">{{ displayTime(detail.paidAt) }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.reviewRemark" label="审核意见 / 失败原因" :span="2">{{ detail.reviewRemark }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.reviewTime" label="审核时间">{{ displayTime(detail.reviewTime) }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.reviewerAdminId" label="审核人管理员 ID">{{ detail.reviewerAdminId }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.payVoucherUrl" label="打款回单" :span="2">
              <el-image class="payee-qr" :src="detail.payVoucherUrl" :preview-src-list="[detail.payVoucherUrl]" fit="contain" preview-teleported />
            </el-descriptions-item>
          </el-descriptions>
        </template>
      </div>

      <template #footer>
        <div v-if="detail" class="drawer-footer">
          <el-button v-if="canApprove(detail)" type="success" :disabled="actionLoading" @click="handleApprove(detail)">
            <el-icon><CircleCheck /></el-icon>通过（remark 选填）
          </el-button>
          <el-button v-if="canApprove(detail)" type="primary" plain :disabled="actionLoading" @click="openRemarkDialog('approve', '审核通过（可填备注）', '审核意见，如：三数一致，同意打款（选填）')">通过并填备注</el-button>
          <el-button v-if="canReject(detail)" type="danger" :disabled="actionLoading" @click="openReject(detail)">
            <el-icon><CircleClose /></el-icon>驳回（remark 必填）
          </el-button>
          <el-button v-if="canConfirmPaid(detail)" type="primary" :disabled="actionLoading" @click="openConfirmPaid(detail)">
            <el-icon><Upload /></el-icon>确认打款
          </el-button>
          <el-button v-if="canMarkFailed(detail)" type="warning" plain :disabled="actionLoading" @click="openRemarkDialog('fail', '标记打款失败', '失败原因，如：收款账号有误（选填）')">打款失败</el-button>
          <el-button @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 驳回弹窗：remark 必填 -->
    <el-dialog v-model="rejectVisible" title="驳回商户提现" width="520px" append-to-body>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="驳回后该笔提现的冻结金额会【立即解冻】回商户可提现余额；驳回原因必填，商家端「提现记录」会展示该原因。"
        class="dialog-alert"
      />
      <el-form ref="rejectFormRef" :model="rejectForm" :rules="rejectRules" label-width="90px">
        <el-form-item label="驳回原因" prop="remark">
          <el-input v-model="rejectForm.remark" type="textarea" :rows="4" maxlength="200" show-word-limit placeholder="必填，如：发票票面金额与申请金额不一致 / 发票图片不清晰" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" :loading="actionLoading" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 确认打款弹窗：payNo / payVoucherUrl / remark 均选填（建议回填 payNo 便于对账） -->
    <el-dialog v-model="paidVisible" title="确认打款" width="560px" append-to-body>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="系统【不自动打款】：请先线下转账完成，再在此确认，并尽量回填打款流水号，便于后续对账。"
        class="dialog-alert"
      />
      <el-descriptions v-if="detail" :column="1" border size="small" class="dialog-desc">
        <el-descriptions-item label="提现单号">{{ detail.withdrawNo }}</el-descriptions-item>
        <el-descriptions-item label="打款金额">{{ money(detail.amount) }}</el-descriptions-item>
        <el-descriptions-item label="收款信息">{{ payeeTypeLabel(detail.payeeType) }} · {{ detail.payeeName || '（未填写）' }} · {{ detail.payeeAccount || '（未填写）' }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="110px" class="dialog-form">
        <el-form-item label="打款流水号">
          <el-input v-model="paidForm.payNo" clearable placeholder="选填，如微信转账单号 / 银行流水号" />
        </el-form-item>
        <el-form-item label="打款回单">
          <div class="voucher-row">
            <el-input v-model="paidForm.payVoucherUrl" clearable placeholder="选填，可上传图片或直接粘贴 URL" />
            <el-upload :show-file-list="false" accept="image/*" :http-request="uploadVoucher" :disabled="voucherUploading">
              <el-button :loading="voucherUploading">上传图片</el-button>
            </el-upload>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="paidForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="选填，如：微信零钱已转" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="paidVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" :disabled="voucherUploading" @click="submitConfirmPaid">确认已打款</el-button>
      </template>
    </el-dialog>

    <!-- 通用备注弹窗：通过 / 打款失败共用（remark 选填） -->
    <el-dialog v-model="remarkVisible" :title="remarkTitle" width="480px" append-to-body>
      <el-input v-model="remarkValue" type="textarea" :rows="4" maxlength="200" show-word-limit :placeholder="remarkPlaceholder" />
      <template #footer>
        <el-button @click="remarkVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitRemarkDialog">确认提交</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
/* 顶部汇总卡（与接口调用计数页同款视觉，保持后台一致性） */
.stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
.stat-card { display: flex; flex-direction: column; gap: 6px; }
.stat-label { color: var(--vben-muted, #86909c); font-size: 13px; }
.stat-value { font-size: 26px; line-height: 1.2; }
.stat-hint { color: var(--vben-muted, #86909c); font-size: 12px; line-height: 1.5; }

.toolbar-hint { margin-left: 12px; color: var(--vben-muted); font-size: 12px; }

/* 列表：收款信息两行展示（姓名在上、账号在下，便于财务扫读） */
.payee-cell { display: flex; flex-direction: column; gap: 2px; line-height: 18px; }
.payee-account { color: var(--vben-muted); font-size: 12px; word-break: break-all; }
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.row-actions :deep(.el-button) { margin-left: 0; padding: 4px 6px; }
/* 发票金额与申请金额不一致时标红（正常情况下后端强校验相等，出现即异常） */
.value-mismatch { color: var(--el-color-danger); font-weight: 600; }
.muted { color: var(--vben-muted); font-size: 12px; }

/* 详情抽屉 */
.detail-body { display: flex; flex-direction: column; gap: 16px; }
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vben-border); }
.detail-no { display: flex; align-items: center; gap: 8px; }
.detail-no-label { color: var(--vben-muted); font-size: 13px; }

/* ① ② ③ 三块并排（财务核对的核心视图） */
.triple-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.triple-card { position: relative; display: flex; flex-direction: column; gap: 8px; }
.triple-index { position: absolute; top: 8px; right: 12px; color: var(--vben-primary-deep); font-size: 18px; font-weight: 700; }
.triple-label { color: var(--vben-muted); font-size: 13px; }
.triple-value { font-size: 24px; line-height: 1.2; }
.triple-hint { color: var(--vben-muted); font-size: 12px; line-height: 1.6; }
.triple-empty { padding: 16px 0; color: var(--vben-muted); font-size: 13px; }
.invoice-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.invoice-thumb { width: 84px; height: 84px; border: 1px solid var(--vben-border); border-radius: 8px; cursor: zoom-in; }
.invoice-error { display: grid; place-items: center; height: 100%; gap: 4px; color: var(--vben-muted); font-size: 11px; }
.triple-alert { margin-top: 4px; }

.section-title { margin-top: 8px; color: var(--vben-text); font-size: 14px; font-weight: 600; }
.detail-desc { margin-top: 8px; }
.payee-account-value { margin-right: 6px; font-weight: 600; word-break: break-all; }
.payee-qr { width: 120px; height: 120px; border: 1px solid var(--vben-border); border-radius: 8px; cursor: zoom-in; }
.drawer-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.drawer-footer :deep(.el-button) { margin-left: 0; }

/* 弹窗 */
.dialog-alert { margin-bottom: 14px; }
.dialog-desc { margin-bottom: 14px; }
.dialog-form :deep(.el-form-item) { margin-bottom: 14px; }
.voucher-row { display: flex; align-items: center; gap: 10px; width: 100%; }

@media (max-width: 1360px) {
  .triple-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 900px) {
  .stat-grid { grid-template-columns: minmax(0, 1fr); }
  .triple-grid { grid-template-columns: minmax(0, 1fr); }
  .voucher-row { flex-direction: column; align-items: stretch; }
}
</style>
