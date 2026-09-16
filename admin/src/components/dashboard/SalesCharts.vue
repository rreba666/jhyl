<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DailySales, ProductSales } from '@/types/dashboard'

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  productSales: ProductSales[]
  dailySales: DailySales[]
  focusProduct?: string
  focusProductSales?: ProductSales | null
  focusProductDailySales?: DailySales[]
  loading?: boolean
  dark?: boolean
}>(), {
  loading: false,
  dark: false,
  focusProduct: '',
  focusProductSales: null,
  focusProductDailySales: () => [],
})

type EChartsInstance = ReturnType<typeof echarts.init>
type TooltipItem = { dataIndex?: number; axisValue?: string }

const quantityChartRef = ref<HTMLDivElement | null>(null)
const amountChartRef = ref<HTMLDivElement | null>(null)
const shareChartRef = ref<HTMLDivElement | null>(null)
const trendChartRef = ref<HTMLDivElement | null>(null)
const focusTrendChartRef = ref<HTMLDivElement | null>(null)
let quantityChart: EChartsInstance | null = null
let amountChart: EChartsInstance | null = null
let shareChart: EChartsInstance | null = null
let trendChart: EChartsInstance | null = null
let focusTrendChart: EChartsInstance | null = null
let resizeObserver: ResizeObserver | null = null

function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function chartColors(): { text: string; muted: string; border: string; primary: string; success: string; surface: string } {
  return {
    text: themeColor('--vben-text', props.dark ? '#e5e6eb' : '#1f2937'),
    muted: themeColor('--vben-muted', props.dark ? '#8f9aaa' : '#86909c'),
    border: themeColor('--vben-border', props.dark ? '#303030' : '#e5e6eb'),
    primary: themeColor('--vben-primary', '#1677ff'),
    success: '#21a366',
    surface: themeColor('--vben-surface', props.dark ? '#1f1f1f' : '#ffffff'),
  }
}

function formatMoney(value: number): string {
  return `¥ ${Number(value || 0).toFixed(2)}`
}

function tooltipItems(value: unknown): TooltipItem[] {
  return (Array.isArray(value) ? value : [value]) as TooltipItem[]
}

function baseOption(colors: ReturnType<typeof chartColors>): EChartsOption {
  return {
    animationDuration: 320,
    textStyle: { color: colors.text, fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" },
    grid: { left: 12, right: 18, top: 12, bottom: 12, containLabel: true },
    tooltip: {
      confine: true,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      textStyle: { color: colors.text },
    },
  }
}

function createBarOption(items: ProductSales[], metric: 'quantity' | 'amount', colors: ReturnType<typeof chartColors>): EChartsOption {
  const visible = items.slice(0, 10).reverse()
  const isAmount = metric === 'amount'
  const values = visible.map((item) => item[metric])

  return {
    ...baseOption(colors),
    tooltip: {
      ...baseOption(colors).tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (value: unknown) => {
        const item = tooltipItems(value)[0]
        const product = item?.dataIndex === undefined ? undefined : visible[item.dataIndex]
        if (!product) return ''
        return `${product.name}<br/>${isAmount ? `销售额：${formatMoney(product.amount)}` : `销量：${product.quantity}`}`
      },
    },
    xAxis: {
      type: 'value',
      min: 0,
      axisLabel: {
        color: colors.muted,
        formatter: (value: number) => isAmount ? `¥${value}` : String(value),
      },
      axisLine: { lineStyle: { color: colors.border } },
      splitLine: { lineStyle: { color: colors.border, opacity: props.dark ? 0.65 : 0.8 } },
    },
    yAxis: {
      type: 'category',
      data: visible.map((item) => item.name),
      axisLabel: {
        color: colors.text,
        width: 150,
        overflow: 'truncate',
        ellipsis: '…',
      },
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: values,
      barMaxWidth: 18,
      showBackground: true,
      backgroundStyle: { color: colors.border, opacity: 0.28, borderRadius: 4 },
      itemStyle: {
        color: isAmount ? colors.success : colors.primary,
        borderRadius: [0, 4, 4, 0],
      },
    }],
  }
}

function createTrendOption(items: DailySales[], colors: ReturnType<typeof chartColors>): EChartsOption {
  return {
    ...baseOption(colors),
    grid: { left: 14, right: 18, top: 18, bottom: 12, containLabel: true },
    tooltip: {
      ...baseOption(colors).tooltip,
      trigger: 'axis',
      formatter: (value: unknown) => {
        const item = tooltipItems(value)[0]
        const date = item?.axisValue || ''
        const daily = items.find((entry) => entry.date === date)
        return daily ? `${date}<br/>销售额：${formatMoney(daily.amount)}<br/>销量：${daily.quantity}` : date
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: items.map((item) => item.date),
      axisLabel: { color: colors.muted, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { color: colors.muted, formatter: (value: number) => `¥${value}` },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: colors.border, opacity: props.dark ? 0.65 : 0.8 } },
    },
    series: [{
      type: 'line',
      data: items.map((item) => item.amount),
      smooth: true,
      symbol: 'circle',
      symbolSize: 7,
      lineStyle: { width: 3, color: colors.primary },
      itemStyle: { color: colors.primary, borderColor: colors.surface, borderWidth: 2 },
      areaStyle: { color: colors.primary, opacity: props.dark ? 0.18 : 0.1 },
    }],
  }
}

function createShareOption(items: ProductSales[], colors: ReturnType<typeof chartColors>): EChartsOption {
  const sorted = [...items].sort((a, b) => b.amount - a.amount)
  const visible = sorted.slice(0, 7)
  const otherAmount = sorted.slice(7).reduce((sum, item) => sum + item.amount, 0)
  const data = visible.map((item) => ({ name: item.name, value: item.amount }))
  if (otherAmount > 0) data.push({ name: '其他', value: Number(otherAmount.toFixed(2)) })

  return {
    ...baseOption(colors),
    tooltip: {
      ...baseOption(colors).tooltip,
      trigger: 'item',
      formatter: (value: unknown) => {
        const item = value as { name?: string; value?: number; percent?: number }
        return `${item.name || ''}<br/>销售额：${formatMoney(item.value || 0)}（${Number(item.percent || 0).toFixed(1)}%）`
      },
    },
    legend: {
      type: 'scroll',
      bottom: 2,
      left: 'center',
      textStyle: { color: colors.muted },
    },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: colors.surface, borderWidth: 2 },
      label: { color: colors.text, formatter: '{b}' },
      data,
    }],
  }
}

function setOption(chart: EChartsInstance | null, option: EChartsOption): void {
  chart?.setOption(option, { notMerge: true, lazyUpdate: true })
}

function renderCharts(): void {
  const colors = chartColors()
  setOption(quantityChart, createBarOption(props.productSales, 'quantity', colors))
  setOption(amountChart, createBarOption([...props.productSales].sort((a, b) => b.amount - a.amount), 'amount', colors))
  setOption(shareChart, createShareOption(props.productSales, colors))
  setOption(trendChart, createTrendOption(props.dailySales, colors))
  setOption(focusTrendChart, createTrendOption(props.focusProductDailySales, colors))
  if (props.loading) {
    quantityChart?.showLoading('default', { color: colors.primary, textColor: colors.muted, maskColor: `${colors.surface}cc` })
    amountChart?.showLoading('default', { color: colors.primary, textColor: colors.muted, maskColor: `${colors.surface}cc` })
    shareChart?.showLoading('default', { color: colors.primary, textColor: colors.muted, maskColor: `${colors.surface}cc` })
    trendChart?.showLoading('default', { color: colors.primary, textColor: colors.muted, maskColor: `${colors.surface}cc` })
  } else {
    quantityChart?.hideLoading()
    amountChart?.hideLoading()
    shareChart?.hideLoading()
    trendChart?.hideLoading()
  }
}

function resizeCharts(): void {
  quantityChart?.resize()
  amountChart?.resize()
  shareChart?.resize()
  trendChart?.resize()
  focusTrendChart?.resize()
}

function initCharts(): void {
  if (quantityChartRef.value) quantityChart = echarts.init(quantityChartRef.value)
  if (amountChartRef.value) amountChart = echarts.init(amountChartRef.value)
  if (shareChartRef.value) shareChart = echarts.init(shareChartRef.value)
  if (trendChartRef.value) trendChart = echarts.init(trendChartRef.value)
  if (focusTrendChartRef.value) focusTrendChart = echarts.init(focusTrendChartRef.value)
  if (resizeObserver) {
    if (quantityChartRef.value) resizeObserver.observe(quantityChartRef.value)
    if (amountChartRef.value) resizeObserver.observe(amountChartRef.value)
    if (shareChartRef.value) resizeObserver.observe(shareChartRef.value)
    if (trendChartRef.value) resizeObserver.observe(trendChartRef.value)
    if (focusTrendChartRef.value) resizeObserver.observe(focusTrendChartRef.value)
  }
  renderCharts()
}

function disposeChart(chart: EChartsInstance | null): void {
  if (chart && !chart.isDisposed()) chart.dispose()
}

watch(() => [props.productSales, props.dailySales, props.loading, props.dark], async () => {
  await nextTick()
  renderCharts()
}, { deep: true })

onMounted(() => {
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeCharts)
  initCharts()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  disposeChart(quantityChart)
  disposeChart(amountChart)
  disposeChart(shareChart)
  disposeChart(trendChart)
  disposeChart(focusTrendChart)
  quantityChart = null
  amountChart = null
  shareChart = null
  trendChart = null
  focusTrendChart = null
})
</script>

<template>
  <section class="sales-charts" aria-label="销售数据图表">
    <div class="charts-grid">
      <el-card shadow="never" class="chart-card">
        <div class="chart-heading"><div><strong>商品销量排行</strong><span>按购买数量排序</span></div></div>
        <div ref="quantityChartRef" class="chart-canvas" />
        <div v-if="!productSales.length && !loading" class="chart-empty">暂无销量数据</div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <div class="chart-heading"><div><strong>商品销售额排行</strong><span>按商品小计汇总</span></div></div>
        <div ref="amountChartRef" class="chart-canvas" />
        <div v-if="!productSales.length && !loading" class="chart-empty">暂无销售额数据</div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <div class="chart-heading"><div><strong>销售额占比</strong><span>重点商品与其他商品构成</span></div></div>
        <div ref="shareChartRef" class="chart-canvas" />
        <div v-if="!productSales.length && !loading" class="chart-empty">暂无占比数据</div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <div class="chart-heading"><div><strong>销售趋势</strong><span>按付款日期汇总</span></div></div>
        <div ref="trendChartRef" class="chart-canvas chart-canvas--trend" />
        <div v-if="!dailySales.length && !loading" class="chart-empty">暂无趋势数据</div>
      </el-card>
      <el-card shadow="never" class="chart-card chart-card--wide">
        <div class="chart-heading">
          <div>
            <strong>{{ focusProduct || '重点商品分析' }}</strong>
            <span>{{ focusProduct ? '当前时间范围内的商品趋势' : '从上方选择商品查看单品趋势' }}</span>
          </div>
          <div v-if="focusProductSales" class="focus-summary">
            <span>销量 {{ focusProductSales.quantity }}</span>
            <span>销售额 {{ formatMoney(focusProductSales.amount) }}</span>
          </div>
        </div>
        <div ref="focusTrendChartRef" class="chart-canvas chart-canvas--trend" />
        <div v-if="!focusProduct && !loading" class="chart-empty">请选择重点商品</div>
        <div v-else-if="!focusProductDailySales.length && !loading" class="chart-empty">该商品暂无趋势数据</div>
      </el-card>
    </div>
  </section>
</template>

<style scoped>
.sales-charts { min-width: 0; margin-bottom: 16px; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.chart-card { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--vben-border); border-radius: 8px; background: var(--vben-surface); }
.chart-card--wide { grid-column: 1 / -1; }
.chart-heading { display: flex; align-items: flex-start; justify-content: space-between; min-height: 34px; }
.chart-heading strong, .chart-heading span { display: block; }
.chart-heading strong { color: var(--vben-text); font-size: 15px; line-height: 1.4; }
.chart-heading span { margin-top: 4px; color: var(--vben-muted); font-size: 12px; font-weight: 400; }
.chart-canvas { width: 100%; height: 320px; }
.chart-canvas--trend { height: 300px; }
.focus-summary { display: flex; flex-wrap: wrap; gap: 14px; color: var(--vben-muted); font-size: 12px; font-weight: 400; }
.chart-empty { position: absolute; inset: 64px 20px 20px; display: grid; place-items: center; color: var(--vben-muted); background: color-mix(in srgb, var(--vben-surface) 88%, transparent); pointer-events: none; }
@media (max-width: 900px) {
  .charts-grid { grid-template-columns: 1fr; }
  .chart-card--wide { grid-column: auto; }
}
@media (max-width: 640px) {
  .chart-canvas { height: 280px; }
  .chart-canvas--trend { height: 260px; }
}
</style>
