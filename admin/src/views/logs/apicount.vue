<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, QuestionFilled } from '@element-plus/icons-vue'
import * as echarts from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import DataTable from '@/components/DataTable.vue'
import {
  getApiCallApiRank,
  getApiCallLogs,
  getApiCallSubjectRank,
  getApiCallSummary,
  getApiCallTrend,
} from '@/api/apicount'
import {
  API_CALL_SUBJECT_OPTIONS,
  apiCallApiKeyLabel,
  apiCallSharePercent,
  apiCallSubjectLabel,
  averageApiCallPerDay,
  buildApiCallTrendSeries,
  formatApiCallCount,
  formatApiCallShare,
  formatApiCallTime,
  isKnownApiCallKey,
} from '@/utils/apicountLabels'
import { copyToClipboard } from '@/utils/clipboard'
import { useThemeStore } from '@/stores/theme'
import type { ApiCallApiRank, ApiCallLogRecord, ApiCallSummary, ApiCallSubjectRank, ApiCallTrendPoint } from '@/types/apicount'

/**
 * 接口调用计数（平台级控制台）—— 后端积木 `fengling-apicount`。
 *
 * 一件事说清：**这里统计的是「接口被成功调用了多少次」，不是请求量，也不是业务量（订单数）。**
 * 后端判据是 `Result.code == 0`；本项目失败也返回 HTTP 200（`GlobalExceptionHandler` 把业务异常转成
 * `Result.fail`），所以「失败不计」这件事在页面上看不出来，必须在文案里讲明。
 *
 * 页面五个模块（对应后端 5 个 GET 端点，2026-09-22 dev 实测全部可用）：
 * 1. 区间筛选（`from`/`to` 闭区间，yyyy-MM-dd，不传=后端默认最近 7 天，传反后端自动交换）；
 * 2. 总览卡片 ← `GET /summary`（`from`/`to` **回显后端实际生效区间**）；
 * 3. 接口排行 ← `GET /rank/api`；主体排行 ← `GET /rank/subject`（两个端点**参数相同、返回字段不同**）；
 * 4. 趋势折线 ← `GET /trend`（⚠️ 后端**不补零**，本页按区间补齐并在图上标注）；
 * 5. 调用明细 ← `GET /logs`（按写入倒序，`pageSize` 上限 200）。
 *
 * 🔒 平台级数据（全平台接口结构 + 任意商户 `shopId` + 调用明细）：后端当前**未声明权限点**，
 * 前端按**仅超管可见**处理（`utils/permission.ts` 的 `ROLE_ROUTES` + 路由 `meta.roles`），
 * 后端口径明确后再决定是否放开给客服/财务。
 *
 * 已知取舍：**不做导出**（明细是长表，只导当前页会让人误以为导了全量；后端也没有该模块的导出端点）。
 */
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const themeStore = useThemeStore()

/** 每页条数上限：后端 `pageSize`/`limit`/`topN` 上限都是 200（实测传 500 被截为 200）。 */
const PAGE_SIZE_MAX = 200
/** 接口排行 / 主体排行的条数（后端默认 20，这里固定 20，排名更长意义有限）。 */
const RANK_LIMIT = 20

/** 顶部时间区间（`null` = 用后端默认最近 7 天）。 */
const range = ref<[string, string] | null>(null)
/** 后端实际生效区间（`summary` 回显，趋势补零也用它）。 */
const effectiveRange = ref<{ from: string; to: string }>({ from: '', to: '' })

const summary = ref<ApiCallSummary | null>(null)
const apiRank = ref<ApiCallApiRank[]>([])
const subjectRank = ref<ApiCallSubjectRank[]>([])
const trendSeries = ref<ApiCallTrendPoint[]>([])
/** 趋势里被补零的天数（后端不返回没有调用的日期 → 补零后要让用户知道哪天是"真的 0"）。 */
const trendFilledDays = ref(0)

const logs = ref<ApiCallLogRecord[]>([])
const logTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)

/** 明细筛选：`apiKey` 同时驱动趋势（"看某个接口的趋势 + 明细"一次完成）。 */
const filters = ref({ apiKey: '', subjectType: '', subjectId: '' })

const loadingSummary = ref(false)
const loadingApiRank = ref(false)
const loadingSubjectRank = ref(false)
const loadingTrend = ref(false)
const loadingLogs = ref(false)

/** 任一模块在加载中（顶部刷新按钮的 loading）。 */
const loading = computed(
  () => loadingSummary.value || loadingApiRank.value || loadingSubjectRank.value || loadingTrend.value || loadingLogs.value,
)

/** 明细详情抽屉。 */
const detailVisible = ref(false)
const detail = ref<ApiCallLogRecord | null>(null)

/** 区间查询参数：用户没选区间时**不传**，由后端给默认值（前端不自己算"最近 7 天"）。 */
function rangeParams(): { from?: string; to?: string } {
  const value = range.value
  if (value && value[0] && value[1]) return { from: value[0], to: value[1] }
  return {}
}

/** 明细筛选里已填条件的数量（提示用户"结果是被筛过的"）。 */
const activeFilterCount = computed(
  () => [filters.value.apiKey, filters.value.subjectType, filters.value.subjectId].filter((item) => Boolean(String(item || '').trim())).length,
)

/** 加载总览；同时把后端生效区间回显到顶部选择器与趋势坐标轴。 */
async function loadSummary(): Promise<void> {
  loadingSummary.value = true
  try {
    const data = await getApiCallSummary({ ...rangeParams(), topN: RANK_LIMIT })
    summary.value = data
    if (data.from && data.to) {
      effectiveRange.value = { from: data.from, to: data.to }
      // 回显到选择器：让用户看到"当前看的是哪段区间"（后端不传时会补默认值，前端不重复算）
      const current = range.value
      if (!current || current[0] !== data.from || current[1] !== data.to) range.value = [data.from, data.to]
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '接口调用总览查询失败')
  } finally {
    loadingSummary.value = false
  }
}

/** 加载接口排行（⚠️ 该端点不支持按 `apiKey` 过滤，始终是全量排行）。 */
async function loadApiRank(): Promise<void> {
  loadingApiRank.value = true
  try {
    apiRank.value = await getApiCallApiRank({ ...rangeParams(), limit: RANK_LIMIT })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '接口排行查询失败')
  } finally {
    loadingApiRank.value = false
  }
}

/** 加载主体排行（含 `shopId`；可选只看某类主体）。 */
async function loadSubjectRank(): Promise<void> {
  loadingSubjectRank.value = true
  try {
    subjectRank.value = await getApiCallSubjectRank({
      ...rangeParams(),
      subjectType: filters.value.subjectType || undefined,
      limit: RANK_LIMIT,
    })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '主体排行查询失败')
  } finally {
    loadingSubjectRank.value = false
  }
}

/** 加载趋势并按区间补零（后端不返回"没有调用的日期"）。 */
async function loadTrend(): Promise<void> {
  loadingTrend.value = true
  try {
    const apiKey = filters.value.apiKey.trim()
    const points = await getApiCallTrend({ ...rangeParams(), apiKey: apiKey || undefined })
    // 区间以"后端生效区间"为准：首次加载时 summary 与 trend 并发，若 summary 还没回来则先用用户选的区间
    const from = effectiveRange.value.from || range.value?.[0] || ''
    const to = effectiveRange.value.to || range.value?.[1] || ''
    const built = buildApiCallTrendSeries(points, from, to)
    trendSeries.value = built.series
    trendFilledDays.value = built.filledDays
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '接口调用趋势查询失败')
  } finally {
    loadingTrend.value = false
  }
}

/** 加载调用明细（分页；`pageSize` 前端也按 200 封顶）。 */
async function loadLogs(targetPage = page.value): Promise<void> {
  loadingLogs.value = true
  try {
    const data = await getApiCallLogs({
      ...rangeParams(),
      apiKey: filters.value.apiKey.trim() || undefined,
      subjectType: filters.value.subjectType || undefined,
      subjectId: filters.value.subjectId.trim() || undefined,
      page: targetPage,
      pageSize: Math.min(pageSize.value, PAGE_SIZE_MAX),
    })
    logs.value = data.list
    logTotal.value = data.total
    page.value = data.page
    pageSize.value = data.pageSize
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '调用明细查询失败')
  } finally {
    loadingLogs.value = false
  }
}

/**
 * 全量刷新：5 个端点并发（明细单独一轮，因为它带自己的筛选与分页）。
 * ⚠️ 趋势依赖「后端生效区间」（来自 summary）→ 先等总览回来再画趋势，保证补零区间与卡片一致。
 */
async function reloadAll(): Promise<void> {
  await loadSummary()
  await Promise.all([loadApiRank(), loadSubjectRank(), loadTrend(), loadLogs(1)])
}

/** 明细/趋势的接口筛选变化后重新查询（趋势 + 明细两个模块）。 */
async function applyApiKeyFilter(): Promise<void> {
  page.value = 1
  await Promise.all([loadTrend(), loadLogs(1)])
}

/** 主体筛选变化后：主体排行 + 明细一起跟着变（排行本身就是"按主体看"的视图）。 */
async function applySubjectFilter(): Promise<void> {
  page.value = 1
  await Promise.all([loadSubjectRank(), loadLogs(1)])
}

/** 重置全部筛选与区间（回到后端默认最近 7 天）。 */
async function resetAll(): Promise<void> {
  range.value = null
  filters.value = { apiKey: '', subjectType: '', subjectId: '' }
  page.value = 1
  pageSize.value = 20
  await reloadAll()
}

/** 点排行的「看明细」：把接口/主体填进明细筛选并重新查询。 */
async function drillDown(payload: { apiKey?: string; subjectType?: string; subjectId?: string }): Promise<void> {
  if (payload.apiKey !== undefined) filters.value.apiKey = payload.apiKey
  if (payload.subjectType !== undefined) filters.value.subjectType = payload.subjectType
  if (payload.subjectId !== undefined) filters.value.subjectId = payload.subjectId
  page.value = 1
  await Promise.all([loadSubjectRank(), loadTrend(), loadLogs(1)])
  document.querySelector('.apicount-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handlePageChange(target: number): void {
  page.value = target
  void loadLogs(target)
}

function handleSizeChange(size: number): void {
  pageSize.value = Math.min(size, PAGE_SIZE_MAX)
  page.value = 1
  void loadLogs(1)
}

/** 打开明细详情抽屉。 */
function openDetail(record: ApiCallLogRecord): void {
  detail.value = record
  detailVisible.value = true
}

/** 复制一段文本（复制失败时给明确提示，不静默）。 */
async function copyText(text: string | null | undefined, label: string): Promise<void> {
  const ok = await copyToClipboard(String(text || ''))
  if (ok) ElMessage.success(`${label}已复制`)
  else ElMessage.warning(`${label}复制失败，请手动选择复制`)
}

/* ------------------------------ 趋势折线图 ------------------------------ */

type EChartsInstance = ReturnType<typeof echarts.init>

const trendChartRef = ref<HTMLDivElement | null>(null)
let trendChart: EChartsInstance | null = null
let resizeObserver: ResizeObserver | null = null

/** 取 CSS 变量里的主题色（暗色主题下图表文字不能是硬编码黑色）。 */
function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** 趋势图的标题说明：当前看的是哪个接口。 */
const trendScopeText = computed(() => {
  const apiKey = filters.value.apiKey.trim()
  if (!apiKey) return '全部接口合计'
  return `${apiCallApiKeyLabel(apiKey)}（${apiKey}）`
})

/** 渲染趋势折线（含"补零"提示：区间内没有调用的日期按 0 画）。 */
function renderTrendChart(): void {
  if (!trendChart) return
  const primary = themeColor('--vben-primary', '#1677ff')
  const text = themeColor('--vben-text', '#1f2937')
  const muted = themeColor('--vben-muted', '#86909c')
  const border = themeColor('--vben-border', '#e5e6eb')
  const option: EChartsOption = {
    grid: { left: 56, right: 24, top: 28, bottom: 40 },
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${formatApiCallCount(Number(value))} 次` },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendSeries.value.map((item) => item.statDate),
      axisLabel: { color: muted, hideOverlap: true },
      axisLine: { lineStyle: { color: border } },
    },
    yAxis: {
      type: 'value',
      // 次数是整数：不加 minInterval 会出现 0.5 这种刻度
      minInterval: 1,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: border } },
    },
    series: [
      {
        name: '成功调用次数',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        data: trendSeries.value.map((item) => item.cnt),
        itemStyle: { color: primary },
        lineStyle: { color: primary, width: 2 },
        areaStyle: { color: primary, opacity: 0.12 },
      },
    ],
    textStyle: { color: text },
  }
  trendChart.setOption(option, true)
  if (!trendSeries.value.length) trendChart.clear()
}

function initTrendChart(): void {
  if (!trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => trendChart?.resize())
    resizeObserver.observe(trendChartRef.value)
  }
  renderTrendChart()
}

watch(trendSeries, async () => {
  await nextTick()
  renderTrendChart()
}, { deep: true })

// 主题切换要重取颜色（否则暗色主题下坐标轴文字仍是深色、看不清）
watch(() => themeStore.isDark, async () => {
  await nextTick()
  renderTrendChart()
})

onMounted(async () => {
  await reloadAll()
  await nextTick()
  initTrendChart()
  // 首次的 summary 回显会把区间写进 effectiveRange，趋势需要按该区间重画一次（补零范围才对）
  renderTrendChart()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (trendChart && !trendChart.isDisposed()) trendChart.dispose()
  trendChart = null
})
</script>

<template>
  <section class="page-container page-enter apicount-page">
    <div class="page-heading">
      <div>
        <h1>接口调用计数</h1>
        <p>
          平台级：<strong>每成功调一次接口，次数 +1</strong>，并能追到「谁、什么时候、从哪个 IP 调的」。
          只统计<strong>业务成功</strong>的调用（后端判据 <code>Result.code == 0</code>），失败与被鉴权拦下的调用都不计。
        </p>
      </div>
      <div class="heading-actions">
        <el-button type="primary" :loading="loading" :disabled="loading" @click="reloadAll">刷新</el-button>
        <el-button :disabled="loading" @click="resetAll">重置</el-button>
      </div>
    </div>

    <el-alert class="scope-alert" type="info" show-icon :closable="false">
      <template #title>
        口径提醒：这是<strong>接口成功调用量</strong>，不是请求量、更不是业务量（订单数）。
        它统计「接口被调了多少次」，与「成交了多少单」不是一个口径，不要混用。
      </template>
    </el-alert>

    <!-- 模块 1：区间筛选（from/to 为自然日闭区间；不选 = 后端默认最近 7 天） -->
    <el-card shadow="never" class="filter-card">
      <el-form inline class="filter-form" @submit.prevent="reloadAll">
        <el-form-item label="调用日期">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            :clearable="true"
          />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="label-with-help">
              接口
              <el-tooltip
                placement="top"
                :show-after="200"
                content="按接口逻辑 key 精确匹配（如 delivery.quote）。它同时作用于「趋势」与「调用明细」；接口排行为全量，不支持按接口过滤（后端未支持）。"
              >
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="filters.apiKey"
            clearable
            placeholder="如 delivery.quote / audit.ledger.query"
            class="api-key-input"
            @keyup.enter="applyApiKeyFilter"
            @clear="applyApiKeyFilter"
          />
        </el-form-item>
        <el-form-item label="主体类型">
          <el-select v-model="filters.subjectType" placeholder="全部主体" class="subject-select" @change="applySubjectFilter">
            <el-option v-for="option in API_CALL_SUBJECT_OPTIONS" :key="option.value || 'all'" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="主体 ID">
          <el-input
            v-model="filters.subjectId"
            clearable
            placeholder="用户 ID / 店员 ID / 管理员 ID"
            class="subject-id-input"
            @keyup.enter="applySubjectFilter"
            @clear="applySubjectFilter"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reloadAll">查询</el-button>
          <el-button @click="resetAll">清空条件</el-button>
          <span class="effective-range">生效区间：{{ effectiveRange.from || '—' }} ~ {{ effectiveRange.to || '—' }}</span>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 模块 2：总览（GET /summary） -->
    <section v-loading="loadingSummary" class="stat-grid">
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">成功调用总次数</span>
        <strong class="stat-value">{{ formatApiCallCount(summary?.totalCnt ?? 0) }}</strong>
        <span class="stat-hint">区间内所有被计数接口的合计</span>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">覆盖接口数</span>
        <strong class="stat-value">{{ formatApiCallCount(summary?.apiCount ?? 0) }}</strong>
        <span class="stat-hint">被成功调用过的不同接口</span>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">覆盖主体数</span>
        <strong class="stat-value">{{ formatApiCallCount(summary?.subjectCount ?? 0) }}</strong>
        <span class="stat-hint">类型 + ID 去重：判断「少数人在刷」还是「用户面在扩大」</span>
      </el-card>
      <el-card shadow="never" class="stat-card">
        <span class="stat-label">日均调用次数</span>
        <strong class="stat-value">{{ averageApiCallPerDay(summary?.totalCnt ?? 0, effectiveRange.from, effectiveRange.to) }}</strong>
        <span class="stat-hint">按区间自然日数平均（含没有调用的日子）</span>
      </el-card>
    </section>

    <!-- 模块 3：两个排行（rank/api + rank/subject） -->
    <section class="rank-grid">
      <el-card v-loading="loadingApiRank" shadow="never" class="rank-card">
        <div class="card-heading">
          <div>
            <strong>接口排行</strong>
            <span>哪些接口是大头（前 {{ RANK_LIMIT }} 名）</span>
          </div>
        </div>
        <el-table :data="apiRank" border stripe size="small" empty-text="该区间内没有成功调用记录">
          <el-table-column type="index" label="#" width="52" />
          <el-table-column label="接口" min-width="220">
            <template #default="{ row }">
              <div class="api-cell">
                <span class="api-name">{{ apiCallApiKeyLabel(row.apiKey) }}</span>
                <span class="api-key">{{ row.apiKey }}</span>
                <el-tag v-if="!isKnownApiCallKey(row.apiKey)" size="small" type="warning" effect="plain">中文名未收录</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="调用次数" width="100" align="right">
            <template #default="{ row }">{{ formatApiCallCount(row.cnt) }}</template>
          </el-table-column>
          <el-table-column label="涉及主体数" width="110" align="right">
            <template #default="{ row }">
              <el-tooltip placement="top" :show-after="200" content="该接口涉及的「主体类型 + 主体 ID」去重数。次数高但主体数只有 1，通常意味着单人高频刷。">
                <span>{{ formatApiCallCount(row.subjectCount) }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="占比" min-width="140">
            <template #default="{ row }">
              <div class="share-cell">
                <el-progress :percentage="apiCallSharePercent(row.cnt, summary?.totalCnt ?? 0)" :show-text="false" :stroke-width="10" />
                <span class="share-text">{{ formatApiCallShare(row.cnt, summary?.totalCnt ?? 0) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="drillDown({ apiKey: row.apiKey })">看明细</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card v-loading="loadingSubjectRank" shadow="never" class="rank-card">
        <div class="card-heading">
          <div>
            <strong>主体排行</strong>
            <span>谁在调（前 {{ RANK_LIMIT }} 名，含所属门店）</span>
          </div>
        </div>
        <el-table :data="subjectRank" border stripe size="small" empty-text="该区间内没有成功调用记录">
          <el-table-column type="index" label="#" width="52" />
          <el-table-column label="主体" min-width="180">
            <template #default="{ row }">
              <div class="api-cell">
                <span class="api-name">{{ apiCallSubjectLabel(row.subjectType) }}</span>
                <span class="api-key">{{ row.subjectType }}#{{ row.subjectId }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="所属门店" width="100" align="right">
            <template #default="{ row }">
              <!-- shopId=0 表示无门店归属（C 端用户与平台管理员天然为 0）→ 显示「—」而不是 0 -->
              <span :class="{ 'muted-text': !row.shopId || row.shopId === '0' }">{{ !row.shopId || row.shopId === '0' ? '—' : row.shopId }}</span>
            </template>
          </el-table-column>
          <el-table-column label="调用次数" width="100" align="right">
            <template #default="{ row }">{{ formatApiCallCount(row.cnt) }}</template>
          </el-table-column>
          <el-table-column label="接口数" width="90" align="right">
            <template #default="{ row }">{{ formatApiCallCount(row.apiCount) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="drillDown({ subjectType: row.subjectType, subjectId: row.subjectId })">看明细</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <!-- 模块 4：趋势（GET /trend，前端按区间补零） -->
    <el-card v-loading="loadingTrend" shadow="never" class="trend-card">
      <div class="card-heading">
        <div>
          <strong>调用趋势</strong>
          <span>{{ trendScopeText }} · 按自然日 · {{ effectiveRange.from || '—' }} ~ {{ effectiveRange.to || '—' }}</span>
        </div>
        <el-tooltip placement="top" :show-after="200" content="后端对「没有成功调用的日期」不返回数据行（刻意不补零）。本页按区间补齐为 0，因此折线里的 0 不代表接口异常。">
          <el-tag v-if="trendFilledDays" size="small" type="info" effect="plain">已补 {{ trendFilledDays }} 天为 0</el-tag>
        </el-tooltip>
      </div>
      <div ref="trendChartRef" class="trend-canvas" />
      <div v-if="!trendSeries.length && !loadingTrend" class="trend-empty">该区间内没有成功调用记录</div>
    </el-card>

    <!-- 模块 5：调用明细（GET /logs） -->
    <el-card shadow="never" class="logs-card apicount-logs">
      <div class="card-heading">
        <div>
          <strong>调用明细</strong>
          <span>按写入倒序（同秒并发也不会并列）· 共 {{ formatApiCallCount(logTotal) }} 条</span>
        </div>
        <div class="heading-side">
          <el-tag v-if="activeFilterCount" size="small" type="warning" effect="plain">已应用 {{ activeFilterCount }} 个筛选条件</el-tag>
          <el-button :loading="loadingLogs" :disabled="loadingLogs" @click="loadLogs(page)">刷新明细</el-button>
        </div>
      </div>
      <DataTable
        :data="logs"
        :loading="loadingLogs"
        :total="logTotal"
        :page="page"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :show-selection="false"
        row-key="id"
        empty-text="该条件下暂无调用明细"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
      >
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatApiCallTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="接口" min-width="220">
          <template #default="{ row }">
            <div class="api-cell">
              <span class="api-name">{{ apiCallApiKeyLabel(row.apiKey) }}</span>
              <span class="api-key">{{ row.apiKey }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="主体" width="180">
          <template #default="{ row }">
            <div class="api-cell">
              <span class="api-name">{{ apiCallSubjectLabel(row.subjectType) }}</span>
              <span class="api-key">{{ row.subjectType }}#{{ row.subjectId }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="门店" width="90" align="right">
          <template #default="{ row }">
            <span :class="{ 'muted-text': !row.shopId || row.shopId === '0' }">{{ !row.shopId || row.shopId === '0' ? '—' : row.shopId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90" align="right">
          <template #default="{ row }">
            <el-tooltip placement="top" :show-after="200" content="⚠️ 并发下该值含「聚合表行锁竞争」的时间，不能当接口性能指标用（要查真实耗时应按 traceId 看日志）。">
              <span>{{ row.costMs === null ? '—' : `${row.costMs} ms` }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="来源 IP" width="130">
          <template #default="{ row }">{{ row.ipAddress || '—' }}</template>
        </el-table-column>
        <el-table-column label="链路 ID" min-width="170">
          <template #default="{ row }">
            <span v-if="row.traceId" class="mono-link" @click="copyText(row.traceId, '链路 ID')">{{ row.traceId }}</span>
            <span v-else class="muted-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 明细详情抽屉 -->
    <el-drawer v-model="detailVisible" title="调用明细" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="时间">{{ formatApiCallTime(detail.createTime) }}</el-descriptions-item>
          <el-descriptions-item label="接口">
            {{ apiCallApiKeyLabel(detail.apiKey) }}
            <span class="api-key">（{{ detail.apiKey }}）</span>
          </el-descriptions-item>
          <el-descriptions-item label="主体">
            {{ apiCallSubjectLabel(detail.subjectType) }}
            <span class="api-key">（{{ detail.subjectType }}#{{ detail.subjectId }}）</span>
          </el-descriptions-item>
          <el-descriptions-item label="所属门店">
            {{ !detail.shopId || detail.shopId === '0' ? '—（无门店归属）' : detail.shopId }}
          </el-descriptions-item>
          <el-descriptions-item label="幂等键 X-Request-Id">
            <template v-if="detail.requestId">
              <span class="mono-link" @click="copyText(detail.requestId, '幂等键')">{{ detail.requestId }}</span>
            </template>
            <span v-else class="muted-text">未传（未传即无幂等，重试会重复计数）</span>
          </el-descriptions-item>
          <el-descriptions-item label="链路 ID">
            <template v-if="detail.traceId">
              <span class="mono-link" @click="copyText(detail.traceId, '链路 ID')">{{ detail.traceId }}</span>
            </template>
            <span v-else class="muted-text">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="来源 IP">{{ detail.ipAddress || '—' }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ detail.costMs === null ? '—' : `${detail.costMs} ms` }}</el-descriptions-item>
          <el-descriptions-item label="User-Agent">
            <span class="ua-text">{{ detail.userAgent || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="明细主键 ID">{{ detail.id }}</el-descriptions-item>
        </el-descriptions>
        <p class="drawer-hint">
          <el-icon><InfoFilled /></el-icon>
          明细只记录<strong>成功</strong>调用。要看某次失败的原因，请用链路 ID 去日志/留痕里查，计数表不记失败详情。
        </p>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.apicount-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scope-alert :deep(.el-alert__title) {
  line-height: 1.6;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.api-key-input {
  width: 260px;
}

.subject-select {
  width: 200px;
}

.subject-id-input {
  width: 200px;
}

.label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.help-icon {
  color: var(--vben-muted, #86909c);
  cursor: help;
}

.effective-range {
  margin-left: 8px;
  color: var(--vben-muted, #86909c);
  font-size: 13px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  color: var(--vben-muted, #86909c);
  font-size: 13px;
}

.stat-value {
  font-size: 26px;
  line-height: 1.2;
}

.stat-hint {
  color: var(--vben-muted, #86909c);
  font-size: 12px;
  line-height: 1.5;
}

.rank-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.card-heading strong {
  display: block;
  font-size: 15px;
}

.card-heading span {
  color: var(--vben-muted, #86909c);
  font-size: 12px;
}

.heading-side {
  display: flex;
  align-items: center;
  gap: 8px;
}

.api-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.api-name {
  font-weight: 500;
}

.api-key {
  color: var(--vben-muted, #86909c);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

.share-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-text {
  color: var(--vben-muted, #86909c);
  font-size: 12px;
  white-space: nowrap;
}

.trend-canvas {
  width: 100%;
  height: 320px;
}

.trend-empty {
  color: var(--vben-muted, #86909c);
  font-size: 13px;
  text-align: center;
}

.mono-link {
  color: var(--vben-primary, #1677ff);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  cursor: pointer;
}

.muted-text {
  color: var(--vben-muted, #86909c);
}

.ua-text {
  font-size: 12px;
  word-break: break-all;
}

.drawer-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  color: var(--vben-muted, #86909c);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 1400px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rank-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
