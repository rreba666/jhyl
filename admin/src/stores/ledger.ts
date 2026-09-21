import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  exportLedgerCsv,
  getLedgerCategories,
  getLedgerList,
  getLedgerStatus,
  getLedgerUnified,
  runLedgerReconcile,
} from '@/api/ledger'
import { buildCategoryLabelMap } from '@/utils/ledgerLabels'
import type { LedgerCategoryOption, LedgerQueryParams, LedgerRecord, LedgerStatus, LedgerUnifiedQueryParams } from '@/types/ledger'

/** 数据源：`ledger` = 9 类台账（不含金额）；`unified` = 含金额的统一台账。 */
export type LedgerSource = 'ledger' | 'unified'

/**
 * `unified` 接口**不支持**的筛选项（§4.2）。
 * 切到 unified 时页面必须禁用这几个输入并清空，避免"填了却没生效"的静默失真。
 */
export const UNIFIED_UNSUPPORTED_FIELDS = ['block', 'operation', 'targetType', 'requestId'] as const
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
  const status = ref<LedgerStatus | null>(null)
  const statusLoading = ref(false)
  const exporting = ref(false)
  const reconciling = ref(false)

  /** 分类枚举名 → 中文标签（表格"分类"列用）。 */
  const categoryLabelMap = computed(() => buildCategoryLabelMap(categories.value))

  /** 当前数据源的接口说明（页面上给一句人话提示，避免"为什么查不到金额"的困惑）。 */
  const sourceHint = computed(() =>
    source.value === 'unified'
      ? '统一台账：在 9 类之外额外合并了金额流水（MONEY），不支持"产生方/操作码/目标类型/请求号"筛选。'
      : '9 类台账：不含金额流水（MONEY 类请切到"统一台账（含金额）"）。',
  )

  /**
   * 组装查询参数。
   * - `categories` 多选 → **逗号分隔**（⚠️ 参数名是复数，传单数会被后端忽略并返回全量）；
   * - `unified` 会剔除它不支持的四个参数。
   */
  function buildParams(): LedgerQueryParams | LedgerUnifiedQueryParams {
    const base = {
      categories: filters.categories.length ? filters.categories.join(',') : '',
      operatorType: filters.operatorType,
      operatorId: filters.operatorId,
      targetId: filters.targetId,
      result: filters.result,
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
      requestId: filters.requestId,
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
      // 这四项 unified 不支持，留着只会让用户误以为筛选生效了
      filters.block = ''
      filters.operation = ''
      filters.targetType = ''
      filters.requestId = ''
    }
  }

  /** 导出 CSV（同筛选条件，⚠️ 上限 5000 条）。 */
  async function exportCsv(): Promise<void> {
    if (exporting.value) return
    exporting.value = true
    try {
      await exportLedgerCsv(buildParams() as LedgerQueryParams)
    } finally {
      exporting.value = false
    }
  }

  /** 手动触发一次对账（⚠️ 幂等但不防重：这里用 reconciling 做防连点）。 */
  async function reconcile(): Promise<string> {
    if (reconciling.value) return ''
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
    status,
    statusLoading,
    exporting,
    reconciling,
    categoryLabelMap,
    sourceHint,
    fetchList,
    loadCategories,
    loadStatus,
    switchSource,
    exportCsv,
    reconcile,
    resetFilters,
  }
})
