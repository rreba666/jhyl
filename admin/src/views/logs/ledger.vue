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
  formatCoverageRate,
  formatLedgerTime,
  isLedgerChangeRecord,
  isLedgerOperationKnown,
  isSkippedLedger,
  ledgerBlockLabel,
  ledgerCategoryLabel,
  ledgerOperationLabel,
  ledgerOperationTooltip,
  ledgerOperatorText,
  ledgerRawSnapshot,
  ledgerResultMeta,
  ledgerTargetText,
  ledgerTargetTypeLabel,
  operatorTypeLabel,
} from '@/utils/ledgerLabels'
import type { LedgerRecord } from '@/types/ledger'

/**
 * 留痕台账（操作留痕回溯）。
 *
 * 页面分三个模块，**不再是一张堆满筛选的大表**：
 * 1. 分类视图 Tab：`全部` / 分类字典顺序逐类 / `含金额的统一台账`（`/unified`）；
 * 2. 筛选：常用条件（目标 ID / 结果 / 请求链路 ID / 操作时间）在外，其余收进「高级筛选」折叠；
 * 3. 列表 + 详情抽屉 + 时间线 / 请求链路 / 自检状态三个对话框。
 *
 * 数据源二选一：`/ledger`（9 类，不含金额）与 `/unified`（含金额 MONEY）。
 * 仅平台角色可见（SUPER_ADMIN / CUSTOMER_SERVICE / FINANCE），商户管理员看不到（跨商户全量 + 金额/库存）。
 * 纯查询接口，无实时推送。
 */
const store = useLedgerStore()
const dateRange = ref<[string, string] | null>(null)

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
  return { id: '', operatorType: '', operatorId: '', operatorName: null, operation: '', category: null, block: null, result: null, requestId: null, beforeJson: null, afterJson: null, targetType: null, targetId: null, detail: null, ipAddress: null, createTime: null, rowKey: '' }
}
const detail = ref<LedgerRecord>(createEmptyRecord())
const detailVisible = ref(false)
const statusVisible = ref(false)

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

/** 目标类型筛选项（§3.3，实测 12 种）。 */
const TARGET_TYPE_OPTIONS = ['ORDER', 'PRODUCT_SKU', 'DELIVERY_TASK', 'AFTER_SALE', 'WAYBILL', 'ADMIN', 'MERCHANT', 'MERCHANT_APPLY', 'SHOP', 'STAFF', 'SCHEMA', 'SYSTEM', 'FINANCE_FLOW']

/** 时间线支持的逻辑目标类型（⚠️ 必须是逻辑类型，不是表名）。 */
const TIMELINE_TARGET_TYPE_OPTIONS = ['ORDER', 'DELIVERY_TASK', 'PRODUCT_SKU', 'AFTER_SALE', 'WAYBILL', 'ADMIN', 'MERCHANT', 'SHOP', 'STAFF']

/** 该筛选项在当前数据源下是否被后端支持（unified 不支持 block/operation/targetType/requestId）。 */
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
 *   `block`/`operation`/`targetType`/`requestId`，回到第一页）。
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
function onSizeChange(value: number): void { store.pageSize = value; store.page = 1; void load() }

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
  if (isFilterDisabled('requestId')) {
    ElMessage.warning('统一台账不支持按请求链路 ID 筛选（该接口没有 requestId 参数），请用「查看该链路全部留痕」')
    return
  }
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

/** 导出 CSV（⚠️ 上限 5000 条：按筛选条件取最新一批，不是全量导出）。 */
async function exportCsv(): Promise<void> {
  if (store.source === 'unified') {
    // 文档只定义了与 /ledger 同参数的导出接口，金额（MONEY）不在 CSV 范围内 —— 明确提示，避免误以为导出了金额
    ElMessage.warning('导出接口与 9 类台账同参数，金额（MONEY）不在导出范围内')
  }
  try {
    await store.exportCsv()
    ElMessage.success('导出已开始（最多 5000 条，按筛选条件取最新一批）')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '留痕导出失败')
  }
}

/**
 * 手动对账。
 * ⚠️ 接口幂等但**不防重**：连点两次会把同一批不一致落两条异常留痕 → 二次确认 + 请求期间禁用按钮。
 */
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
    const message = await store.reconcile()
    ElMessage.success(message || '对账已完成，可切到「异常」Tab 查看结果')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '手动对账失败')
  }
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
          <el-input
            v-model="store.filters.requestId"
            clearable
            placeholder="一次 HTTP 请求的链路 ID，如 ORD11851213561858"
            :disabled="isFilterDisabled('requestId')"
          />
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
            <el-form-item label="操作码">
              <el-input v-model="store.filters.operation" clearable placeholder="精确匹配，如 ORDER_STATUS" :disabled="isFilterDisabled('operation')" />
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
              <el-select v-model="store.filters.targetType" clearable filterable placeholder="全部目标" :disabled="isFilterDisabled('targetType')">
                <el-option v-for="type in TARGET_TYPE_OPTIONS" :key="type" :label="`${ledgerTargetTypeLabel(type)}（${type}）`" :value="type" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

      <p class="filter-hint">操作码为精确匹配，不支持模糊搜索（后端未收录中文名的操作码会原样显示英文，可提需求补充）。</p>
    </el-card>

    <!-- 模块 3：列表 -->
    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div>
          <strong>{{ activeViewTitle }}</strong>
          <span class="toolbar-count">共 {{ store.total }} 条</span>
        </div>
        <span class="toolbar-count">导出上限 5000 条（与 9 类台账同参数，不含金额）</span>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
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
        <!-- 操作码：中文名优先，未知码原样回显；列内省略显示，全称与原始码看 tooltip -->
        <el-table-column min-width="200">
          <template #header>
            <span class="label-with-help">
              操作码
              <el-tooltip placement="top" :content="`${LEDGER_OPERATION_UNKNOWN_HINT}（如 INV-1_… 这类长码建议看 tooltip 全称）`" :show-after="200">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <el-tooltip placement="top" :content="ledgerOperationTooltip(row.operation)" :show-after="200">
              <span class="ellipsis-text" :class="{ 'text-unknown': !isLedgerOperationKnown(row.operation) }">{{ ledgerOperationLabel(row.operation) }}</span>
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
          <el-tooltip placement="top" :content="ledgerOperationTooltip(detail.operation)" :show-after="200">
            <span>{{ ledgerOperationLabel(detail.operation) }}</span>
          </el-tooltip>
          <span v-if="detail.operation && !isLedgerOperationKnown(detail.operation)" class="code-text">（{{ LEDGER_OPERATION_UNKNOWN_HINT }}）</span>
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
        <el-descriptions-item label="目标类型">{{ detail.targetType ? `${ledgerTargetTypeLabel(detail.targetType)}（${detail.targetType}）` : '—' }}</el-descriptions-item>
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
            <el-option v-for="type in TIMELINE_TARGET_TYPE_OPTIONS" :key="type" :label="`${ledgerTargetTypeLabel(type)}（${type}）`" :value="type" />
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
