<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { QuestionFilled } from '@element-plus/icons-vue'
import DataTable from '@/components/DataTable.vue'
import AuditTimeline from '@/components/audit/AuditTimeline.vue'
import LedgerDiffTable from '@/components/audit/LedgerDiffTable.vue'
import { UNIFIED_UNSUPPORTED_FIELDS, useLedgerStore, type LedgerUnsupportedField } from '@/stores/ledger'
import { copyToClipboard } from '@/utils/clipboard'
import {
  LEDGER_BLOCK_OPTIONS,
  LEDGER_LEGACY_CATEGORY_LABEL,
  LEDGER_OPERATION_UNKNOWN_HINT,
  LEDGER_REQUEST_ID_EMPTY,
  LEDGER_REQUEST_ID_TIP,
  LEDGER_RESULT_OPTIONS,
  buildLedgerDiff,
  buildLedgerOperationOptions,
  buildTargetTypeLabelMap,
  formatCoverageRate,
  formatLedgerTime,
  isLedgerChangeRecord,
  isLedgerOperationKnown,
  isLedgerOperationKnownRecord,
  isSkippedLedger,
  ledgerBlockLabel,
  ledgerCategoryLabel,
  ledgerOperationLabel,
  ledgerOperationRecordTooltip,
  ledgerOperationText,
  ledgerOperatorText,
  ledgerRawSnapshot,
  ledgerResultMeta,
  ledgerTargetText,
  ledgerTargetTypeText,
  operatorTypeLabel,
} from '@/utils/ledgerLabels'
import type { LedgerRecord, LedgerReconcileResult } from '@/types/ledger'

/**
 * 留痕台账（操作留痕回溯）。
 *
 * 页面分三个模块，**不再是一张堆满筛选的大表**：
 * 1. 分类视图 Tab：`全部` / 分类字典顺序逐类 / `含金额的统一台账`（`/unified`）；
 * 2. 筛选：常用条件（目标 ID / 结果 / 请求链路 ID / 操作时间 / 排除 SKIPPED）在外，其余收进「高级筛选」折叠；
 * 3. 列表 + 详情抽屉 + 时间线 / 请求链路 / 自检状态 / 对账结果四个对话框。
 *
 * 数据源二选一：`/ledger`（9 类，不含金额）与 `/unified`（含金额 MONEY）。
 * 仅平台角色可见（SUPER_ADMIN / CUSTOMER_SERVICE / FINANCE），商户管理员看不到（跨商户全量 + 金额/库存）。
 * 纯查询接口，无实时推送。
 *
 * ✅ 2026-09-21 跟进后端已落地能力：操作码中文字典（`/ledger/operations`）、目标类型权威枚举
 * （`/ledger/target-types`）、记录上的 `operationDesc`、`excludeSkipped`、结构化对账结果、
 * 含金额的统一口径导出（`unified=true`）。前端硬编码映射表只作兜底（见 `utils/ledgerLabels.ts`）。
 */
const store = useLedgerStore()
const dateRange = ref<[string, string] | null>(null)

/** 后端 `pageSize` 上限（超过**静默按 200 截断、不报错**）→ 选择器与提交都要限幅，否则用户以为拿到了全部。 */
const PAGE_SIZE_MAX = 200

/** Tab 名常量：`all` = 全部（不传 categories）；`unified` = 含金额的统一台账；其余 = 分类字典的枚举名。 */
const ALL_TAB = 'all'
const UNIFIED_TAB = 'unified'
/** 当前分类视图 Tab（分类 Tab 承载 `categories` 筛选，见 `onTabChange`）。 */
const activeTab = ref<string>(ALL_TAB)

/** 当前是否为「某个分类」Tab（此时分类下拉被 Tab 钉住 → 禁用并提示）。 */
const activeCategoryTab = computed(() => activeTab.value !== ALL_TAB && activeTab.value !== UNIFIED_TAB)

/**
 * Tab 标签：**只给当前选中的 Tab 追加条数**。
 * 条数直接用本次查询的 `total` —— 为 10 个分类各查一次条数需要 10 个请求，代价太大，**不额外发请求**。
 * 查询中不显示条数，避免闪现上一次的旧值。
 */
function tabLabel(name: string, label: string): string {
  if (name !== activeTab.value || store.loading) return label
  return `${label}（${store.total}）`
}

/** 列表工具栏的视图标题（切了 Tab 也知道自己正在看哪个模块）。 */
const activeViewTitle = computed(() => {
  if (activeTab.value === UNIFIED_TAB) return '含金额的统一台账'
  if (activeTab.value === ALL_TAB) return '全部留痕记录'
  return `${ledgerCategoryLabel(activeTab.value, store.categoryLabelMap)} · 留痕记录`
})

/** 详情抽屉展示的记录（用空白对象兜底，避免模板里到处判空）。 */
function createEmptyRecord(): LedgerRecord {
  return { id: '', operatorType: '', operatorId: '', operatorName: null, operation: '', operationDesc: null, category: null, block: null, result: null, requestId: null, beforeJson: null, afterJson: null, targetType: null, targetId: null, detail: null, ipAddress: null, createTime: null, rowKey: '' }
}
const detail = ref<LedgerRecord>(createEmptyRecord())
const detailVisible = ref(false)
const statusVisible = ref(false)

/** 对账结果对话框（结构化展示，替代原先只能弹一句文案的行为）。 */
const reconcileVisible = ref(false)
const reconcileResult = ref<LedgerReconcileResult | null>(null)

/** 高级筛选折叠面板（默认收起；一旦有已设置项就自动展开，避免"填过的条件藏在折叠里"）。 */
const advancedOpen = ref<string[]>([])

/**
 * 高级筛选里"已设置"的项数（折叠标题上的小标签）。
 * ⚠️ 分类被分类 Tab 钉住时**不算**用户手填的条件，否则每次切分类 Tab 都会把折叠撑开。
 */
const advancedActiveCount = computed(() => {
  const filters = store.filters
  const categoryActive = !activeCategoryTab.value && filters.categories.length > 0
  return [categoryActive, Boolean(filters.block), Boolean(filters.operation), Boolean(filters.operatorType), Boolean(filters.operatorId), Boolean(filters.targetType)].filter(Boolean).length
})

watch(advancedActiveCount, (count) => {
  if (count > 0 && !advancedOpen.value.includes('advanced')) advancedOpen.value = ['advanced']
})

/** 按目标查时间线（用独立 ref 保存"已提交"的目标，避免模板里对可空对象取属性）。 */
const timelineVisible = ref(false)
const timelineTargetType = ref('ORDER')
const timelineTargetId = ref('')
const queriedTargetType = ref('')
const queriedTargetId = ref('')
const timelineSearched = ref(false)

/** 请求链路弹窗（点 requestId → 看"这一次请求到底改了哪几条"）。 */
const requestChainVisible = ref(false)
const requestChainId = ref('')
/** 链路条数：null = 尚未读到（标题保持中性），读到后标题写明"同一次请求共 N 条"。 */
const requestChainTotal = ref<number | null>(null)

/** 操作人类型筛选项（§3.2）。 */
const OPERATOR_TYPE_OPTIONS = ['ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_PC', 'STAFF', 'USER', 'DELIVERY_PERSON', 'PLATFORM', 'SYSTEM']

/**
 * 目标类型**兜底**筛选项（§3.3，实测 12 种）。
 * ⚠️ 既有定位已变：2026-09-21 起后端提供权威枚举 `GET /api/admin/ledger/target-types`，
 * 本数组只在字典接口取不到时兜底（见 `targetTypeOptions`）；**不要**再按它硬编码新增类型。
 */
const FALLBACK_TARGET_TYPE_OPTIONS = ['ORDER', 'PRODUCT_SKU', 'DELIVERY_TASK', 'AFTER_SALE', 'WAYBILL', 'ADMIN', 'MERCHANT', 'MERCHANT_APPLY', 'SHOP', 'STAFF', 'SCHEMA', 'SYSTEM', 'FINANCE_FLOW']

/** 时间线支持的逻辑目标类型清单（⚠️ 必须是逻辑类型，不是表名）；中文名优先取后端字典（见 `timelineTargetTypeOptions`）。 */
const FALLBACK_TIMELINE_TARGET_TYPE_OPTIONS = ['ORDER', 'DELIVERY_TASK', 'PRODUCT_SKU', 'AFTER_SALE', 'WAYBILL', 'ADMIN', 'MERCHANT', 'SHOP', 'STAFF']

/** 后端目标类型字典 → `枚举名: 中文标签` 映射（详情抽屉与各类下拉的展示优先用它）。 */
const targetTypeLabelMap = computed(() => buildTargetTypeLabelMap(store.targetTypes))

/**
 * 目标类型筛选项：**优先后端权威枚举** `/ledger/target-types`，取不到时回退硬编码数组。
 * ⚠️ 后端字典的 `value` 才是筛选值，`label` 为中英文名；
 * label 若等于 value（说明后端只回显了枚举名、没翻译），展示层会自动回退 `labels.ts` 的映射。
 */
const targetTypeOptions = computed<Array<{ value: string; label: string }>>(() => {
  if (store.targetTypes.length) {
    return store.targetTypes.map((item) => ({ value: item.value, label: `${ledgerTargetTypeText(item.value, targetTypeLabelMap.value)}（${item.value}）` }))
  }
  return FALLBACK_TARGET_TYPE_OPTIONS.map((value) => ({ value, label: `${ledgerTargetTypeText(value, targetTypeLabelMap.value)}（${value}）` }))
})

/**
 * 时间线下拉的目标类型。
 * ⚠️ 这里**故意不用"字典全集优先"**：字典是 targetType 的**全量**枚举，而 `/timeline` 只认**逻辑类型**，
 * 用全量清单会让用户选到 `SCHEMA`/`SYSTEM`/`FINANCE_FLOW` 这类查不出东西的类型。
 * 所以候选值仍用既有"逻辑类型"清单（不回归），只把**展示中文名**优先换成后端字典的。
 */
const timelineTargetTypeOptions = computed<Array<{ value: string; label: string }>>(() =>
  FALLBACK_TIMELINE_TARGET_TYPE_OPTIONS.map((value) => ({ value, label: `${ledgerTargetTypeText(value, targetTypeLabelMap.value)}（${value}）` })),
)

/**
 * 操作码下拉候选：后端字典 `/ledger/operations`（label 形如 `中文名（CODE）`）。
 * ⚠️ 下拉是 `filterable + allow-create` —— 字典是**候选**，用户仍可手工输入 `ORDER_*` 这类通配写法。
 */
const operationOptions = computed(() => buildLedgerOperationOptions(store.operations))

/** 该筛选项在当前数据源下是否被后端支持（unified 不支持 block/operation/targetType；requestId 与 excludeSkipped 两种口径都支持）。 */
function isFilterDisabled(field: LedgerUnsupportedField): boolean {
  return store.source === 'unified' && UNIFIED_UNSUPPORTED_FIELDS.includes(field)
}

/** 详情抽屉的「前 → 后」对比行。 */
const detailDiffRows = computed(() => buildLedgerDiff(detail.value.beforeJson, detail.value.afterJson))
/** 详情记录是否变更类（有前后快照）。 */
const detailIsChange = computed(() => isLedgerChangeRecord(detail.value))

/** 自检状态视图（带默认值，避免模板判空）。 */
const statusView = computed(() => ({
  loaded: Boolean(store.status),
  queryReady: store.status?.queryReady ?? false,
  writeReady: store.status?.writeReady ?? false,
  categoryCount: store.status?.categoryCount ?? 0,
  degraded: store.status?.degraded ?? false,
  note: store.status?.note || '',
  coverage: store.status?.requestIdCoverage ?? null,
}))

/** 顶部告警：写侧未装配 或 覆盖率巡检 degraded 时提示（运维风险信号）。 */
const statusWarning = computed(() => {
  if (!statusView.value.loaded) return ''
  if (!statusView.value.writeReady) return '留痕写入未装配（writeReady=false）：新的留痕会被静默丢弃，请后端确认 audit 积木是否已装配。'
  if (statusView.value.degraded) return `requestId 覆盖率偏低（${formatCoverageRate(statusView.value.coverage?.rate)}），按请求链路串联的能力受限；这是已知埋点问题，不代表留痕缺失。`
  return ''
})

/** 日期范围 → 接口时间参数（`yyyy-MM-dd HH:mm:ss`）。 */
function updateDateRange(value: [string, string] | null): void {
  dateRange.value = value
  store.filters.startTime = value?.[0] ? `${value[0]} 00:00:00` : ''
  store.filters.endTime = value?.[1] ? `${value[1]} 23:59:59` : ''
}

/** 查询（回到第一页）。 */
async function search(): Promise<void> {
  store.page = 1
  await load()
}

/** 执行查询，失败提示业务文案。 */
async function load(): Promise<void> {
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '留痕台账查询失败')
  }
}

/**
 * 切换分类视图 Tab（**Tab 就是分类筛选**）。
 * - 分类 Tab：数据源回到 9 类台账，并把 `categories` 钉成该分类；
 * - 「全部」Tab：数据源回到 9 类台账，`categories` 置空（仍可在高级筛选里多选交叉筛选）；
 * - 「含金额的统一台账」Tab：沿用既有 `switchSource('unified')` 逻辑（禁用并清空
 *   `block`/`operation`/`targetType`，回到第一页；`requestId` 自 2026-09-21 起已支持，不再清空）。
 * ⚠️ **其它筛选条件保持不变**（不因为切 Tab 把用户输入清掉）。
 */
async function onTabChange(name: string | number): Promise<void> {
  const value = String(name)
  if (value === UNIFIED_TAB) {
    store.switchSource('unified')
    store.filters.categories = []
  } else {
    store.switchSource('ledger')
    store.filters.categories = value === ALL_TAB ? [] : [value]
  }
  store.page = 1
  await load()
}

/** 重置筛选：清空全部条件与日期；分类视图回到「全部」（在统一台账 Tab 下则保持统一台账）。 */
async function reset(): Promise<void> {
  store.resetFilters()
  dateRange.value = null
  activeTab.value = store.source === 'unified' ? UNIFIED_TAB : ALL_TAB
  await load()
}

function onPageChange(value: number): void { store.page = value; void load() }

/**
 * 切换每页条数。
 * ⚠️ 后端 `pageSize` 上限 **200**，超过**按 200 静默截断、不报错** —— 若不在这里限幅，
 * 用户会以为"我选了 500 条就该拿到 500 条"，实际只回 200 条且没有任何提示。
 * 选择器已把可选值限制在 ≤200（见模板 `:page-sizes`），本函数是**第二道防线**（直接改 store 或后端调小上限时兜底）。
 */
function onSizeChange(value: number): void {
  const requested = Math.trunc(Number(value)) || store.pageSize
  const size = Math.min(Math.max(requested, 1), PAGE_SIZE_MAX)
  if (requested > PAGE_SIZE_MAX) ElMessage.warning(`后端单页最多返回 ${PAGE_SIZE_MAX} 条（超出会静默截断），已按 ${PAGE_SIZE_MAX} 条查询`)
  store.pageSize = size
  store.page = 1
  void load()
}

/** 打开详情抽屉。 */
function openDetail(row: LedgerRecord): void {
  detail.value = row
  detailVisible.value = true
}

/** 打开自检状态对话框（每次打开都重新拉一次，状态会变）。 */
function openStatus(): void {
  statusVisible.value = true
  void store.loadStatus().catch((error: unknown) => ElMessage.error(error instanceof Error ? error.message : '台账自检状态查询失败'))
}

/** 复制请求链路 ID（后端缺失时不能复制，先提示）。 */
async function copyRequestId(value?: string | null): Promise<void> {
  if (!value) {
    ElMessage.warning('该行没有请求链路 ID（历史行/定时任务行天然为空），无法复制')
    return
  }
  const ok = await copyToClipboard(value)
  ElMessage[ok ? 'success' : 'error'](ok ? '请求链路 ID 已复制' : '复制失败，请手动选择复制')
}

/** 用请求链路 ID 反查同一次请求的全部留痕（链路可能跨分类 → 回到「全部」Tab 才不会漏行）。 */
async function filterByRequestId(value?: string | null): Promise<void> {
  if (!value) {
    ElMessage.warning('该行没有请求链路 ID（历史行/定时任务行天然为空），无法按链路筛选')
    return
  }
  // ⚠️ 2026-09-21 复核 `/v3/api-docs`：`/unified` **已支持** `requestId`（"金额流水与业务留痕同源…两侧一起过滤"），
  // 因此原先"统一台账不支持按请求链路 ID 筛选"的拦截分支已成死代码，本次删除。
  store.filters.requestId = value
  // 一次请求可能同时改到多个分类，钉着单一分类会漏行 → 回到「全部」Tab
  store.filters.categories = []
  activeTab.value = ALL_TAB
  detailVisible.value = false
  await search()
}

/** 打开「请求链路」对话框（点表格或详情里的 requestId）。 */
function openRequestChain(value?: string | null): void {
  if (!value) {
    ElMessage.warning('该行没有请求链路 ID（历史行/定时任务行天然为空），无法查看链路')
    return
  }
  requestChainTotal.value = null
  requestChainId.value = value
  detailVisible.value = false
  requestChainVisible.value = true
}

/** 子组件加载完成 → 回填条数（标题写「同一次请求共 N 条」）。 */
function onRequestChainLoaded(count: number): void {
  requestChainTotal.value = count
}

/** 请求链路弹窗标题（读不到条数时保持中性文案，不让"0 条"误导）。 */
const requestChainTitle = computed(() =>
  requestChainTotal.value === null ? '同一次请求的留痕（正在读取…）' : `同一次请求共 ${requestChainTotal.value} 条留痕`,
)

/**
 * 「按统一口径导出（含金额行）」时**会被后端忽略**的筛选（与 `api/ledger.ts` 的 `EXPORT_IGNORED_WHEN_UNIFIED` 同一口径）。
 * 页面用它在导出前提醒：这些条件填了也不生效，避免"以为导出了筛过的结果"。
 */
const UNIFIED_EXPORT_IGNORED_FILTERS: Array<{ key: 'block' | 'operation' | 'targetType' | 'requestId'; label: string }> = [
  { key: 'block', label: '产生方' },
  { key: 'operation', label: '操作码' },
  { key: 'targetType', label: '目标类型' },
  { key: 'requestId', label: '请求链路 ID' },
]

/** 导出 CSV（⚠️ 上限 5000 条：按筛选条件取最新一批，不是全量导出）。 */
async function exportCsv(): Promise<void> {
  if (store.source === 'unified') {
    // 当前视图是含金额的统一台账，但默认导出走 9 类口径（不含金额）→ 提示并指向另一个按钮
    ElMessage.warning('默认导出按 9 类台账口径（不含金额）；需要含金额请用「导出（含金额）」')
  }
  try {
    await store.exportCsv(false)
    ElMessage.success('导出已开始（最多 5000 条，按筛选条件取最新一批）')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '留痕导出失败')
  }
}

/**
 * 导出「含金额台账（统一口径）」（`export?unified=true`）。
 * ⚠️ 该口径只支持 `/unified` 的参数子集 → `block` / `operation` / `targetType` / `requestId`
 *   （注意：`/unified` **查询**接口已支持 `requestId`，但 `export?unified=true` 的参数子集仍不含它，
 *   api_doc 明确"会被忽略" —— 所以导出前会把这几项剔掉并提示用户）
 * 会被后端忽略。这里在**用户确实填了这些条件**时先弹确认框说明，否则直接导出（不打扰）。
 */
async function exportUnifiedCsv(): Promise<void> {
  const filled = UNIFIED_EXPORT_IGNORED_FILTERS.filter((item) => Boolean(store.filters[item.key]))
  if (filled.length) {
    try {
      await ElMessageBox.confirm(
        `按统一口径导出（含金额 MONEY 行）时，后端只支持统一台账的参数子集，以下已填筛选会被忽略：${filled.map((item) => item.label).join('、')}。继续导出将得到"忽略这些条件后"的数据。`,
        '确认按统一口径导出',
        { type: 'warning', confirmButtonText: '继续导出', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  try {
    await store.exportCsv(true)
    ElMessage.success('含金额的统一口径导出已开始（最多 5000 条）')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '留痕导出失败')
  }
}

/** 对账结果的一句话摘要（`structured=false` 时后端只回了纯文本，不做任何计数推断）。 */
const reconcileSummary = computed(() => {
  const result = reconcileResult.value
  if (!result) return ''
  if (!result.structured) return '后端返回的是旧版纯文本结果（非结构化），下方为原文。'
  return `检查了 ${result.invariantsChecked} 条不变式，发现 ${result.inconsistencies} 处不一致。`
})

/**
 * 对账结论是否可信：后端文档明确「`inconsistencies=0` 且 `invariantsChecked<4` 说明有 SQL 没跑成、结论不可信」。
 * 正常应检查 4 条不变式 → 少于 4 条时页面必须给警告，而不是显示"全部通过"。
 */
const reconcileIncomplete = computed(() =>
  Boolean(reconcileResult.value?.structured) && (reconcileResult.value?.invariantsChecked ?? 0) < 4,
)

/** 手动对账。 */
async function reconcile(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将对 4 条不变式立即跑一次交叉校验（发现不一致会落成 ANOMALY 异常留痕）。该操作幂等但不会去重：重复触发会把同一批不一致再记一条，请勿连点。',
      '确认手动对账',
      { type: 'warning', confirmButtonText: '立即对账', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const result = await store.reconcile()
    if (!result) return
    reconcileResult.value = result
    reconcileVisible.value = true
    if (result.structured) {
      // 有命中 → warning（需要人看）；无命中且不变式跑全 → success
      const message = `对账完成：检查 ${result.invariantsChecked} 条不变式，发现 ${result.inconsistencies} 处不一致`
      ElMessage[result.inconsistencies > 0 ? 'warning' : 'success'](message)
    } else {
      ElMessage.info(result.note || '对账已完成（后端未返回结构化结果）')
    }
    // 对账可能新增 ANOMALY 留痕 → 刷新当前列表
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '手动对账失败')
  }
}

/**
 * 从对账结果的命中明细跳到筛选：按 `targetId` 查（`/ledger` 与 `/unified` 都支持 targetId）。
 * ⚠️ `InvariantHit` 里**没有 targetType**，所以不能走"按目标查时间线"；同时清掉分类 Tab
 * （命中的异常留痕可能落在 ANOMALY 之外的分类，钉着单一分类会漏行）。
 */
async function filterByReconcileHit(targetId: string): Promise<void> {
  const id = String(targetId ?? '').trim()
  if (!id) {
    ElMessage.warning('该条命中没有目标 ID，无法跳转筛选')
    return
  }
  store.filters.targetId = id
  store.filters.categories = []
  activeTab.value = ALL_TAB
  reconcileVisible.value = false
  await search()
}

/** 打开「按目标查时间线」对话框（可带当前行的目标作为初值）。 */
function openTimeline(row?: LedgerRecord): void {
  if (row?.targetType && row.targetId) {
    timelineTargetType.value = row.targetType
    timelineTargetId.value = row.targetId
  }
  detailVisible.value = false
  timelineVisible.value = true
}

/** 提交时间线查询（两个参数都必填，后端缺一不可）。 */
function queryTimeline(): void {
  if (!timelineTargetType.value) {
    ElMessage.warning('请选择目标类型')
    return
  }
  if (!timelineTargetId.value.trim()) {
    ElMessage.warning('请输入目标 ID（订单号 / 任务号 / SKU ID）')
    return
  }
  queriedTargetType.value = timelineTargetType.value
  queriedTargetId.value = timelineTargetId.value.trim()
  timelineSearched.value = true
}

onMounted(() => {
  void store.loadCategories().catch(() => ElMessage.warning('留痕分类字典加载失败，筛选项暂不可用'))
  // 操作码 / 目标类型字典：各自失败各自兜底（下拉回退硬编码、操作码仍可自由输入）→ 失败时只提示一次，不阻塞页面
  void store
    .loadDictionaries()
    .then(({ operationsFailed, targetTypesFailed }) => {
      if (operationsFailed || targetTypesFailed) ElMessage.warning('操作码 / 目标类型字典加载失败，筛选与展示已回退本地映射表')
    })
    .catch(() => ElMessage.warning('操作码 / 目标类型字典加载失败，筛选与展示已回退本地映射表'))
  void store.loadStatus().catch(() => undefined)
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>留痕台账</h1>
        <p>平台级操作留痕回溯：谁、什么时候、把什么、从什么改成了什么。留痕只增不改，页面仅查询，不提供编辑/删除。</p>
      </div>
      <div class="heading-actions">
        <el-button :loading="store.statusLoading" @click="openStatus">自检状态</el-button>
        <el-button :loading="store.exporting" :disabled="store.exporting" @click="exportCsv">导出 CSV</el-button>
        <!-- 含金额导出：后端 /export?unified=true 已支持（需求 §4 落地），与上一个是**两个口径**，故并列成两个按钮 -->
        <el-button :loading="store.exporting" :disabled="store.exporting" @click="exportUnifiedCsv">导出（含金额）</el-button>
        <el-button type="danger" plain :loading="store.reconciling" :disabled="store.reconciling" @click="reconcile">手动对账</el-button>
      </div>
    </div>

    <el-alert v-if="statusWarning" class="status-alert" type="warning" show-icon :closable="false" :title="statusWarning" />

    <!-- 模块 1：分类视图 Tab —— 一次只看一类，不再"一张大表看全部" -->
    <el-card shadow="never" class="tab-card">
      <el-tabs v-model="activeTab" class="ledger-tabs" @tab-change="onTabChange">
        <el-tab-pane :label="tabLabel(ALL_TAB, '全部')" :name="ALL_TAB" />
        <el-tab-pane
          v-for="option in store.categories"
          :key="option.value"
          :label="tabLabel(option.value, option.label)"
          :name="option.value"
        />
        <el-tab-pane :label="tabLabel(UNIFIED_TAB, '含金额的统一台账')" :name="UNIFIED_TAB" />
      </el-tabs>
      <p class="filter-hint">
        {{ store.sourceHint }}
        切换 Tab 会按该分类重新查询（回到第 1 页），其它筛选条件保持不变；Tab 上的条数取自本次查询结果（不为每个分类额外发请求）。
      </p>
    </el-card>

    <!-- 模块 2：筛选 —— 常用条件在外，其余收进「高级筛选」折叠 -->
    <el-card shadow="never" class="filter-card">
      <el-form inline class="quick-filter-form" @submit.prevent="search">
        <el-form-item label="目标 ID">
          <el-input v-model="store.filters.targetId" clearable placeholder="订单号/任务号/SKU ID" />
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="store.filters.result" clearable placeholder="全部结果">
            <el-option v-for="option in LEDGER_RESULT_OPTIONS" :key="option.value" :label="`${option.label}（${option.value}）`" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-help">
              请求链路 ID
              <el-tooltip placement="top" :content="LEDGER_REQUEST_ID_TIP" :show-after="200">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <!-- 请求链路 ID：✅ 9 类与统一台账**都支持**（2026-09-21 复核 /unified 已支持 requestId）→ 不放进 unified 禁用名单 -->
          <el-input
            v-model="store.filters.requestId"
            clearable
            placeholder="一次 HTTP 请求的链路 ID，如 ORD11851213561858"
          />
        </el-form-item>
        <!-- 排除 SKIPPED：✅ 9 类与统一台账**都支持**（后端需求 §2 落地）→ 不放进 unified 禁用名单 -->
        <el-form-item>
          <template #label>
            <span class="label-with-help">
              结果过滤
              <el-tooltip
                placement="top"
                :content="`勾选后排除 result=SKIPPED 的行（「本次未改成」）。SKIPPED 行的变更前值取自没命中的 WHERE 条件、可能断言一个从未存在过的状态 —— 追责/风控场景建议勾选。⚠️ result 为空的历史行不会被误伤（后端做了 NULL 安全处理）。`"
                :show-after="200"
              >
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-checkbox v-model="store.filters.excludeSkipped" @change="search">排除「未改成」(SKIPPED)</el-checkbox>
        </el-form-item>
        <el-form-item label="操作时间">
          <el-date-picker
            :model-value="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @update:model-value="updateDateRange"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button text type="primary" @click="openTimeline()">按目标查时间线</el-button>
        </el-form-item>
      </el-form>

      <el-collapse v-model="advancedOpen" class="filter-advanced">
        <el-collapse-item name="advanced">
          <template #title>
            <span class="advanced-title">高级筛选</span>
            <el-tag v-if="advancedActiveCount" size="small" effect="plain" class="advanced-badge">已设置 {{ advancedActiveCount }} 项</el-tag>
          </template>
          <el-form inline class="advanced-filter-form" @submit.prevent="search">
            <el-form-item label="分类">
              <el-select
                v-model="store.filters.categories"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部分类（可多选）"
                :disabled="activeCategoryTab"
              >
                <el-option v-for="option in store.categories" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
              <span v-if="activeCategoryTab" class="inline-hint">分类由当前 Tab 决定；需要多选分类请切到「全部」Tab</span>
            </el-form-item>
            <el-form-item label="产生方">
              <el-select v-model="store.filters.block" clearable placeholder="全部产生方" :disabled="isFilterDisabled('block')">
                <el-option v-for="option in LEDGER_BLOCK_OPTIONS" :key="option.value" :label="`${option.label}（${option.value}）`" :value="option.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <template #label>
                <span class="label-with-help">
                  操作码
                  <el-tooltip placement="top" content="支持通配：带 * 为前缀匹配（ORDER_* 匹配 ORDER_STATUS / ORDER_CREATED）；不带 * 为精确匹配。可从下拉选后端字典里的操作码，也可直接输入。" :show-after="200">
                    <el-icon class="help-icon"><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <!-- 可输入下拉：候选来自后端字典 /ledger/operations；allow-create 保留手输 ORDER_* 通配写法 -->
              <el-select
                v-model="store.filters.operation"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="如 ORDER_STATUS 或 ORDER_*（前缀通配）"
                class="operation-select"
                :disabled="isFilterDisabled('operation')"
              >
                <el-option v-for="option in operationOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
              <span v-if="!operationOptions.length" class="inline-hint">操作码字典暂不可用，仍可直接输入操作码</span>
            </el-form-item>
            <el-form-item label="操作人类型">
              <el-select v-model="store.filters.operatorType" clearable placeholder="全部">
                <el-option v-for="type in OPERATOR_TYPE_OPTIONS" :key="type" :label="`${operatorTypeLabel(type)}（${type}）`" :value="type" />
              </el-select>
            </el-form-item>
            <el-form-item label="操作人 ID">
              <el-input v-model="store.filters.operatorId" clearable placeholder="操作人 ID" inputmode="numeric" />
            </el-form-item>
            <el-form-item label="目标类型">
              <!-- 选项来自后端权威枚举 /ledger/target-types；取不到时回退硬编码数组（见 targetTypeOptions） -->
              <el-select v-model="store.filters.targetType" clearable filterable placeholder="全部目标" :disabled="isFilterDisabled('targetType')">
                <el-option v-for="option in targetTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

      <p class="filter-hint">
        操作码支持两种写法：<strong>不带 <code>*</code> 为精确匹配</strong>（如 <code>ORDER_STATUS</code>），
        <strong>带 <code>*</code> 为前缀通配</strong>（如 <code>ORDER_*</code> 匹配 <code>ORDER_STATUS</code> / <code>ORDER_CREATED</code>）；
        下拉候选来自后端操作码字典，也可直接手工输入。
        「结果过滤」的排除 SKIPPED 在 9 类台账与含金额的统一台账下<span class="text-strong">都生效</span>（后端做了 NULL 安全处理，result 为空的历史行不会被误伤）。
      </p>
    </el-card>

    <!-- 模块 3：列表 -->
    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div>
          <strong>{{ activeViewTitle }}</strong>
          <span class="toolbar-count">共 {{ store.total }} 条</span>
        </div>
        <span class="toolbar-count">导出上限 5000 条；「导出 CSV」按 9 类口径（不含金额），含金额请用「导出（含金额）」</span>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        :page-sizes="[20, 50, 100, 200]"
        row-key="rowKey"
        :show-selection="false"
        empty-text="暂无留痕记录"
        @page-change="onPageChange"
        @size-change="onSizeChange"
      >
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatLedgerTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="分类" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.category" size="small" effect="plain">{{ ledgerCategoryLabel(row.category, store.categoryLabelMap) }}</el-tag>
            <el-tag v-else size="small" type="info" effect="plain">{{ LEDGER_LEGACY_CATEGORY_LABEL }}</el-tag>
          </template>
        </el-table-column>
        <!-- 操作码：**优先展示后端下发的 operationDesc 中文名**，为空才回退前端映射表；未知码原样回显 -->
        <el-table-column min-width="200">
          <template #header>
            <span class="label-with-help">
              操作码
              <el-tooltip placement="top" :content="`中文名优先取后端下发的 operationDesc；取不到时才用本地映射表。${LEDGER_OPERATION_UNKNOWN_HINT}（如 INV-1_… 这类长码建议看 tooltip 全称）`" :show-after="200">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <el-tooltip placement="top" :content="ledgerOperationRecordTooltip(row)" :show-after="200">
              <span class="ellipsis-text" :class="{ 'text-unknown': !isLedgerOperationKnownRecord(row) }">{{ ledgerOperationText(row) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="140">
          <template #default="{ row }">
            <span>{{ ledgerOperatorText(row) }}</span>
            <small class="code-text">{{ operatorTypeLabel(row.operatorType) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="目标" min-width="160">
          <template #default="{ row }">{{ ledgerTargetText(row) }}</template>
        </el-table-column>
        <el-table-column label="结果" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="ledgerResultMeta(row.result).tag">{{ ledgerResultMeta(row.result).label }}</el-tag>
            <small v-if="isSkippedLedger(row)" class="skipped-hint">本次未改成，前值不可信</small>
          </template>
        </el-table-column>
        <!-- 请求链路 ID：同一次 HTTP 请求的多条留痕共用它；点击查看该链路全部留痕 -->
        <el-table-column width="190">
          <template #header>
            <span class="label-with-help">
              请求链路 ID
              <el-tooltip placement="top" :content="LEDGER_REQUEST_ID_TIP" :show-after="200">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <el-tooltip v-if="row.requestId" placement="top" :content="LEDGER_REQUEST_ID_TIP" :show-after="200">
              <span class="link-text" @click="openRequestChain(row.requestId)">{{ row.requestId }}</span>
            </el-tooltip>
            <el-tooltip v-else placement="top" :content="LEDGER_REQUEST_ID_TIP" :show-after="200">
              <span class="text-unknown ellipsis-text">{{ LEDGER_REQUEST_ID_EMPTY }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="详情" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.targetType && row.targetId" link type="primary" @click="openTimeline(row)">时间线</el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 详情抽屉：展示全部 16 字段 + 变更类「前 → 后」对比 -->
    <el-drawer v-model="detailVisible" title="留痕详情" size="min(760px, calc(100vw - 24px))" append-to-body destroy-on-close>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="留痕 ID">{{ detail.id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="分类">
          {{ ledgerCategoryLabel(detail.category, store.categoryLabelMap) }}
          <span v-if="detail.category" class="code-text">（{{ detail.category }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作码">
          <!-- 与表格列同一入口：优先后端 operationDesc，缺失才回退本地映射表 -->
          <el-tooltip placement="top" :content="ledgerOperationRecordTooltip(detail)" :show-after="200">
            <span>{{ ledgerOperationText(detail) }}</span>
          </el-tooltip>
          <span v-if="!isLedgerOperationKnownRecord(detail)" class="code-text">（{{ LEDGER_OPERATION_UNKNOWN_HINT }}）</span>
          <span v-else-if="detail.operation" class="code-text">（{{ detail.operation }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作人类型">{{ operatorTypeLabel(detail.operatorType) }}（{{ detail.operatorType || '—' }}）</el-descriptions-item>
        <el-descriptions-item label="操作人 ID">{{ detail.operatorId || '—' }}</el-descriptions-item>
        <el-descriptions-item label="操作人名称">{{ detail.operatorName || '—（系统发起时为 null）' }}</el-descriptions-item>
        <el-descriptions-item label="产生方积木">
          {{ detail.block ? `${ledgerBlockLabel(detail.block)}（${detail.block}）` : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="结果">
          <el-tag size="small" :type="ledgerResultMeta(detail.result).tag">{{ ledgerResultMeta(detail.result).label }}</el-tag>
          <span class="code-text">（{{ detail.result || 'null' }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="请求链路 ID">
          <el-tooltip placement="top" :content="LEDGER_REQUEST_ID_TIP" :show-after="200">
            <span :class="detail.requestId ? '' : 'text-unknown'">{{ detail.requestId || LEDGER_REQUEST_ID_EMPTY }}</span>
          </el-tooltip>
          <el-button v-if="detail.requestId" link type="primary" @click="copyRequestId(detail.requestId)">复制</el-button>
          <el-button v-if="detail.requestId" link type="primary" @click="openRequestChain(detail.requestId)">查看该链路全部留痕</el-button>
          <el-button v-if="detail.requestId" link type="primary" @click="filterByRequestId(detail.requestId)">按此请求链路筛选</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="目标类型">{{ detail.targetType ? `${ledgerTargetTypeText(detail.targetType, targetTypeLabelMap)}（${detail.targetType}）` : '—' }}</el-descriptions-item>
        <el-descriptions-item label="目标 ID">{{ detail.targetId || '—' }}</el-descriptions-item>
        <el-descriptions-item label="操作时间">{{ formatLedgerTime(detail.createTime) }}</el-descriptions-item>
        <el-descriptions-item label="详情">{{ detail.detail || '—' }}</el-descriptions-item>
        <el-descriptions-item label="来源 IP">{{ detail.ipAddress || '—（埋点普遍未传，不要用于风控）' }}</el-descriptions-item>
        <el-descriptions-item label="变更前 beforeJson">
          <pre class="raw-json">{{ ledgerRawSnapshot(detail.beforeJson) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="变更后 afterJson">
          <pre class="raw-json">{{ ledgerRawSnapshot(detail.afterJson) }}</pre>
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="isSkippedLedger(detail)"
        class="detail-alert"
        type="warning"
        show-icon
        :closable="false"
        title="本行 result=SKIPPED：本次未改成"
        description="条件更新未命中时，变更前值取自 SQL 的 WHERE 条件，可能断言一个数据库里从未存在过的状态，追责展示时不要采信。"
      />

      <template v-if="detailIsChange">
        <el-divider>变更对比（前 → 后）</el-divider>
        <LedgerDiffTable :before-json="detail.beforeJson" :after-json="detail.afterJson" :result="detail.result" />
        <p v-if="!detailDiffRows.length" class="detail-hint">快照不是可解析的 JSON 对象，请以上方 beforeJson / afterJson 原文为准。</p>
      </template>
      <p v-else class="detail-hint">本条为动作类事件（无前后快照），内容以「详情」字段为准。</p>
    </el-drawer>

    <!-- 按目标查时间线：可复用组件 AuditTimeline -->
    <el-dialog v-model="timelineVisible" title="按目标查操作时间线" width="820px" append-to-body destroy-on-close>
      <el-form inline @submit.prevent="queryTimeline">
        <el-form-item label="目标类型">
          <el-select v-model="timelineTargetType" filterable placeholder="请选择逻辑目标类型">
            <el-option v-for="option in timelineTargetTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标 ID">
          <el-input v-model="timelineTargetId" clearable placeholder="订单号 / 任务号 / SKU ID" @keyup.enter="queryTimeline" />
        </el-form-item>
        <el-form-item><el-button type="primary" @click="queryTimeline">查询</el-button></el-form-item>
      </el-form>
      <p class="filter-hint">目标类型必须是逻辑类型（ORDER / DELIVERY_TASK / PRODUCT_SKU…），不是数据库表名。时间线按时间升序展示执行顺序。</p>
      <AuditTimeline v-if="timelineSearched" :target-type="queriedTargetType" :target-id="queriedTargetId" />
    </el-dialog>

    <!-- 请求链路：同一次 HTTP 请求产生的全部留痕（时间升序） -->
    <el-dialog v-model="requestChainVisible" :title="requestChainTitle" width="860px" append-to-body destroy-on-close>
      <p class="filter-hint">
        请求链路 ID：<span class="code-text">{{ requestChainId }}</span>
        —— 同一次请求产生的多条留痕共用一个 ID，用来回答「我刚点了一次按钮，到底改了哪几条数据」。
      </p>
      <AuditTimeline v-if="requestChainId" :request-id="requestChainId" @loaded="onRequestChainLoaded" />
    </el-dialog>

    <!-- 对账结果：结构化展示（检查条数 / 不一致条数 / 命中明细），替代原先只能弹一句文案 -->
    <el-dialog v-model="reconcileVisible" title="对账结果" width="820px" append-to-body destroy-on-close>
      <template v-if="reconcileResult">
        <!-- 正常路径：后端返回结构化 ReconcileResult -->
        <template v-if="reconcileResult.structured">
          <p class="detail-hint">{{ reconcileSummary }}</p>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="检查窗口起点 since">{{ reconcileResult.since || '—' }}</el-descriptions-item>
            <el-descriptions-item label="执行不变式数 invariantsChecked">{{ reconcileResult.invariantsChecked }} / 4</el-descriptions-item>
            <el-descriptions-item label="发现不一致 inconsistencies">{{ reconcileResult.inconsistencies }}</el-descriptions-item>
            <el-descriptions-item label="命中明细条数 hits">{{ reconcileResult.hits.length }}</el-descriptions-item>
          </el-descriptions>

          <!-- ⚠️ 后端文档：inconsistencies=0 且 invariantsChecked<4 说明有 SQL 没跑成、结论不可信 → 不能显示"全部通过" -->
          <el-alert
            v-if="reconcileIncomplete"
            class="detail-alert"
            type="warning"
            show-icon
            :closable="false"
            title="本次没有跑满 4 条不变式，结论不可信"
            description="至少有一条不变式未执行成功（可能 SQL 报错），此时「发现 0 处不一致」不代表数据没问题 —— 请把本结果反馈给后端排查，不要当成本次校验全部通过。"
          />
          <el-alert
            v-else-if="!reconcileResult.inconsistencies"
            class="detail-alert"
            type="success"
            show-icon
            :closable="false"
            title="4 条不变式全部执行，未发现不一致"
          />
          <el-alert v-if="reconcileResult.note" class="detail-alert" type="info" show-icon :closable="false" :title="reconcileResult.note" />

          <template v-if="reconcileResult.hits.length">
            <el-divider>命中明细（{{ reconcileResult.hits.length }} 条）</el-divider>
            <el-table :data="reconcileResult.hits" border size="small">
              <el-table-column label="不变式" min-width="260">
                <template #default="{ row }">
                  <el-tooltip placement="top" :content="row.operation || '—'" :show-after="200">
                    <span>{{ ledgerOperationLabel(row.operation) }}</span>
                  </el-tooltip>
                  <small class="code-text">{{ row.operation }}</small>
                </template>
              </el-table-column>
              <el-table-column label="涉及对象" min-width="180">
                <template #default="{ row }">
                  <span v-if="row.targetId" class="link-text" @click="filterByReconcileHit(row.targetId)">{{ row.targetId }}</span>
                  <span v-else class="text-unknown">—</span>
                </template>
              </el-table-column>
              <el-table-column label="说明" min-width="240">
                <template #default="{ row }">{{ row.described || '—' }}</template>
              </el-table-column>
            </el-table>
            <p class="detail-hint">
              点「涉及对象」的值可按该目标 ID 筛选留痕。⚠️ 命中明细里没有 targetType，所以不能直接跳「按目标查时间线」。
            </p>
          </template>
          <p v-else-if="!reconcileIncomplete" class="detail-hint">没有命中明细，说明本次交叉校验未发现不一致。</p>
        </template>

        <!-- 降级路径：后端回退成旧版纯文本（ResultString）→ 只展示原文，绝不显示"检查了 0 条不变式" -->
        <template v-else>
          <el-alert
            class="detail-alert"
            type="info"
            show-icon
            :closable="false"
            title="后端返回的是旧版纯文本结果（非结构化）"
            description="无法给出检查条数/命中明细，下方为后端原文。"
          />
          <pre class="raw-json">{{ reconcileResult.note || '（后端返回了空内容）' }}</pre>
        </template>
      </template>
      <template #footer><el-button @click="reconcileVisible = false">关闭</el-button></template>
    </el-dialog>

    <!-- 自检状态 -->
    <el-dialog v-model="statusVisible" title="台账自检状态" width="640px" append-to-body>
      <template v-if="!statusView.loaded">
        <el-skeleton :rows="4" animated />
        <p class="detail-hint">正在读取台账自检状态…（读取失败可关闭后重试）</p>
      </template>
      <template v-else>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="查询可用 queryReady">
            <el-tag size="small" :type="statusView.queryReady ? 'success' : 'danger'">{{ statusView.queryReady ? '可用' : '不可用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="写入可用 writeReady">
            <el-tag size="small" :type="statusView.writeReady ? 'success' : 'danger'">{{ statusView.writeReady ? '可用' : '未装配' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="分类数 categoryCount">{{ statusView.categoryCount }}</el-descriptions-item>
          <el-descriptions-item label="覆盖率巡检 degraded">
            <el-tag size="small" :type="statusView.degraded ? 'warning' : 'success'">{{ statusView.degraded ? '低于阈值' : '正常' }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>requestId 覆盖率</el-divider>
        <el-descriptions v-if="statusView.coverage" :column="2" border>
          <el-descriptions-item label="统计窗口">{{ statusView.coverage?.hours ?? 0 }} 小时</el-descriptions-item>
          <el-descriptions-item label="覆盖率">{{ formatCoverageRate(statusView.coverage?.rate) }}</el-descriptions-item>
          <el-descriptions-item label="样本总数">{{ statusView.coverage?.total ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="带 requestId">{{ statusView.coverage?.withRequestId ?? 0 }}</el-descriptions-item>
        </el-descriptions>
        <p v-else class="detail-hint">后端未返回覆盖率巡检数据。</p>

        <el-alert v-if="statusView.note" class="detail-alert" type="info" show-icon :closable="false" :title="statusView.note" />
        <p class="detail-hint">分母已排除 SYSTEM 行与 SKIPPED 行；覆盖率偏低是已知埋点限制（实测约 14.2%），不代表留痕缺失。</p>
      </template>
      <template #footer><el-button @click="statusVisible = false">关闭</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.heading-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.status-alert { margin-bottom: 16px; }
.tab-card { margin-bottom: 16px; border: 1px solid var(--vben-border); border-radius: var(--vben-card-radius); background: var(--vben-surface); box-shadow: var(--vben-shadow); }
.tab-card :deep(.el-card__body) { padding: 16px 20px 4px; }
.ledger-tabs :deep(.el-tabs__header) { margin-bottom: 6px; }
.filter-hint { margin: 12px 0 0; color: var(--vben-muted); font-size: 12px; line-height: 1.6; }
.label-with-help { display: inline-flex; align-items: center; gap: 4px; }
.help-icon { color: var(--el-text-color-secondary); cursor: help; }
.filter-advanced { margin-top: 12px; }
/*
 * 全局样式把筛选卡片的表单项 margin-bottom 置 0（`.filter-card .el-form-item`），
 * 筛选条件换行时两行会挤在一起。本页把两个筛选表单改成 flex 换行容器，用 gap 控行距，
 * **只作用于本页**，不改全局样式。
 */
.quick-filter-form, .advanced-filter-form { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px 24px; }
.quick-filter-form .el-form-item, .advanced-filter-form .el-form-item { margin-right: 0; margin-bottom: 0; }
.advanced-title { font-size: 13px; font-weight: 600; }
.advanced-badge { margin-left: 8px; }
.inline-hint { margin-left: 8px; color: var(--vben-muted); font-size: 12px; }
/*
 * 操作码下拉：全局 `.filter-card .el-select` 是 220px，装不下「中文名（CODE）」这种 label（会截断成"订单状态变…"），
 * 本页单独放宽到 280px；`max-width: 100%` 保证窄屏（媒体查询把宽度改成 100%）不被撑破。
 */
.operation-select { width: 280px; min-width: 280px; max-width: 100%; }
.text-strong { color: var(--vben-text); font-weight: 600; }
.code-text { color: var(--el-text-color-secondary); font-size: 12px; }
.skipped-hint { display: block; margin-top: 2px; color: var(--el-text-color-secondary); font-size: 12px; }
/* 长枚举（如 INV-1_MONEY_WITHOUT_ORDER_STATUS）列内省略显示，全称靠 tooltip */
.ellipsis-text { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text-unknown { color: var(--el-text-color-secondary); }
.link-text { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-color-primary); cursor: pointer; }
.link-text:hover { text-decoration: underline; }
.raw-json { max-height: 180px; margin: 0; overflow: auto; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.detail-alert { margin-top: 12px; }
.detail-hint { margin: 12px 0 0; color: var(--vben-muted); font-size: 12px; line-height: 1.6; }
:deep(.el-drawer__body) { padding: 20px 24px; }
</style>
