import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  exportLedgerCsv,
  getLedgerCategories,
  getLedgerList,
  getLedgerOperations,
  getLedgerStatus,
  getLedgerTargetTypes,
  getLedgerUnified,
  runLedgerReconcile,
} from '@/api/ledger'
import { buildCategoryLabelMap } from '@/utils/ledgerLabels'
import type {
  LedgerCategoryOption,
  LedgerOption,
  LedgerQueryParams,
  LedgerReconcileResult,
  LedgerRecord,
  LedgerStatus,
  LedgerUnifiedQueryParams,
} from '@/types/ledger'

/** 数据源：`ledger` = 9 类台账（不含金额）；`unified` = 含金额的统一台账。 */
export type LedgerSource = 'ledger' | 'unified'

/**
 * `unified` 接口**不支持**的筛选项（§4.2）。
 * 切到 unified 时页面必须禁用这几个输入并清空，避免"填了却没生效"的静默失真。
 * ⚠️ 两个**不在**本名单里的参数（后端 `/unified` 同样支持）：
 *   - `excludeSkipped`：只排除台账侧的 `SKIPPED` 行；
 *   - `requestId`：**2026-09-21 复核 `/v3/api-docs` 确认 `/unified` 已支持**
 *     （描述原文"金额流水与业务留痕同源…故两侧一起过滤"）→ 已从本名单移除。
 */
export const UNIFIED_UNSUPPORTED_FIELDS = ['block', 'operation', 'targetType'] as const
export type LedgerUnsupportedField = (typeof UNIFIED_UNSUPPORTED_FIELDS)[number]

/** 台账筛选条件（`categories` 是**多选数组**，提交时逗号拼接）。 */
export interface LedgerFilters {
  categories: string[]
  block: string
  operation: string
  operatorType: string
  operatorId: string
  targetType: string
  targetId: string
  result: string
  /** 排除 `result=SKIPPED` 的行（✅ 9 类与统一台账**都支持**；追责场景建议开）。 */
  excludeSkipped: boolean
  requestId: string
  startTime: string
  endTime: string
}

/** 空白筛选条件。 */
function createEmptyFilters(): LedgerFilters {
  return {
    categories: [],
    block: '',
    operation: '',
    operatorType: '',
    operatorId: '',
    targetType: '',
    targetId: '',
    result: '',
    excludeSkipped: false,
    requestId: '',
    startTime: '',
    endTime: '',
  }
}

export const useLedgerStore = defineStore('ledger', () => {
  const source = ref<LedgerSource>('ledger')
  const list = ref<LedgerRecord[]>([])
  const total = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(20)
  const filters = reactive<LedgerFilters>(createEmptyFilters())
  const categories = ref<LedgerCategoryOption[]>([])
  /**
   * 操作码字典（`/ledger/operations`）与目标类型权威枚举（`/ledger/target-types`）。
   * ⚠️ 后端已提供权威字典 → 页面下拉**优先用它们**，硬编码数组只作兜底（见 `views/logs/ledger.vue`）。
   */
  const operations = ref<LedgerOption[]>([])
  const targetTypes = ref<LedgerOption[]>([])
  const status = ref<LedgerStatus | null>(null)
  const statusLoading = ref(false)
  const exporting = ref(false)
  const reconciling = ref(false)

  /** 分类枚举名 → 中文标签（表格"分类"列用）。 */
  const categoryLabelMap = computed(() => buildCategoryLabelMap(categories.value))

  /**
   * 当前分类视图的一句话说明（展示在页面 Tab 下方，避免"为什么查不到金额 / 为什么筛选项灰了"的困惑）。
   * ⚠️ 文案里的 Tab 名与 `views/logs/ledger.vue` 的 Tab 标签保持一致（「含金额的统一台账」）。
   */
  const sourceHint = computed(() =>
    source.value === 'unified'
      ? '统一台账：在 9 类之外额外合并了金额流水（MONEY）；该接口不支持「产生方 / 操作码 / 目标类型」筛选（页面已禁用并清空）。「排除未改成（SKIPPED）」与「请求链路 ID」两种口径**都支持**。'
      : '9 类台账：不含金额流水；要看金额（MONEY）请切到「含金额的统一台账」Tab。',
  )

  /**
   * 组装查询参数。
   * - `categories` 多选 → **逗号分隔**（⚠️ 参数名是复数，传单数会被后端忽略并返回全量）；
   * - `unified` 会剔除它不支持的**三个**参数（`block` / `operation` / `targetType`）；
   *   `requestId` 与 `excludeSkipped` 两种口径都支持，故放在 `base` 里。
   */
  function buildParams(): LedgerQueryParams | LedgerUnifiedQueryParams {
    const base = {
      categories: filters.categories.length ? filters.categories.join(',') : '',
      operatorType: filters.operatorType,
      operatorId: filters.operatorId,
      targetId: filters.targetId,
      result: filters.result,
      // 仅开启时带上（关掉即不发该参数，避免 URL 噪声；后端省略与 false 等价）
      ...(filters.excludeSkipped ? { excludeSkipped: true } : {}),
      requestId: filters.requestId,
      startTime: filters.startTime,
      endTime: filters.endTime,
      page: page.value,
      pageSize: pageSize.value,
    }
    if (source.value === 'unified') return base as LedgerUnifiedQueryParams
    return {
      ...base,
      block: filters.block,
      operation: filters.operation,
      targetType: filters.targetType,
    }
  }

  /** 查询当前数据源的台账分页（空值由 API 层剔除，不会发空条件）。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const params = buildParams()
      const result = source.value === 'unified'
        ? await getLedgerUnified(params as LedgerUnifiedQueryParams)
        : await getLedgerList(params)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 加载分类字典（下拉数据源，**动态取、不硬编码**；API 层已做会话级缓存）。 */
  async function loadCategories(): Promise<void> {
    categories.value = await getLedgerCategories()
  }

  /**
   * 加载操作码字典与目标类型枚举（后端权威数据）。
   * ⚠️ 两个字典**各自失败各自兜底**：用 `allSettled` 而不是 `all` —— 一个接口没上线不该把另一个也拖垮
   * （页面各自回退到硬编码数组/自由输入）。
   * 返回哪个失败了，供页面提示一次（不改抛错语义，避免调用方要写两层 try）。
   */
  async function loadDictionaries(): Promise<{ operationsFailed: boolean; targetTypesFailed: boolean }> {
    const [operationResult, targetResult] = await Promise.allSettled([getLedgerOperations(), getLedgerTargetTypes()])
    operations.value = operationResult.status === 'fulfilled' ? operationResult.value : []
    targetTypes.value = targetResult.status === 'fulfilled' ? targetResult.value : []
    return { operationsFailed: operationResult.status === 'rejected', targetTypesFailed: targetResult.status === 'rejected' }
  }

  /** 加载台账自检状态（queryReady / writeReady / categoryCount / requestIdCoverage / degraded）。 */
  async function loadStatus(): Promise<void> {
    statusLoading.value = true
    try {
      status.value = await getLedgerStatus()
    } finally {
      statusLoading.value = false
    }
  }

  /** 切换数据源：清空对方不支持的筛选条件，并回到第一页（避免带着无效条件翻页）。 */
  function switchSource(next: LedgerSource): void {
    source.value = next
    page.value = 1
    if (next === 'unified') {
      // 这三项 unified 不支持，留着只会让用户误以为筛选生效了
      // （`requestId` 自 2026-09-21 起 unified **已支持**，不再清空）
      filters.block = ''
      filters.operation = ''
      filters.targetType = ''
    }
  }

  /**
   * 导出 CSV。
   * - `unified=false`（默认）：与 `/ledger` 同口径，**不含金额**，⚠️ 上限 5000 条；
   * - `unified=true`：按统一台账口径导出（**含 MONEY 金额行**），API 层会剔除
   *   `block`/`operation`/`targetType`/`requestId` 这四项被后端忽略的筛选。
   *   ⚠️ 注意区分：`/unified` **查询**接口自 2026-09-21 起**已支持** `requestId`，
   *   但 `export?unified=true` 的参数子集**仍不含**它（api_doc 明确"会被忽略"）→ 导出时照旧剔除。
   */
  async function exportCsv(unified = false): Promise<void> {
    if (exporting.value) return
    exporting.value = true
    try {
      await exportLedgerCsv(buildParams() as LedgerQueryParams, unified)
    } finally {
      exporting.value = false
    }
  }

  /**
   * 手动触发一次对账（⚠️ 幂等但不防重：这里用 reconciling 做防连点）。
   * 返回结构化结果（`structured=false` 表示后端降级成纯文本，原文在 `note`）。
   */
  async function reconcile(): Promise<LedgerReconcileResult | null> {
    if (reconciling.value) return null
    reconciling.value = true
    try {
      return await runLedgerReconcile()
    } finally {
      reconciling.value = false
    }
  }

  /** 重置筛选条件并回到第一页（数据源保持不变）。 */
  function resetFilters(): void {
    Object.assign(filters, createEmptyFilters())
    page.value = 1
  }

  return {
    source,
    list,
    total,
    loading,
    page,
    pageSize,
    filters,
    categories,
    operations,
    targetTypes,
    status,
    statusLoading,
    exporting,
    reconciling,
    categoryLabelMap,
    sourceHint,
    fetchList,
    loadCategories,
    loadDictionaries,
    loadStatus,
    switchSource,
    exportCsv,
    reconcile,
    resetFilters,
  }
})
