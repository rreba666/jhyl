<script setup lang="ts">
/**
 * 资金日报 / 月报（P8，2026-10-03 新增）。
 *
 * 契约：`docs/26/10.03/前端对接-P8资金日报月报-2026-10-03.md`
 * - `GET /api/admin/ledger/fund-report/daily?from=&to=` 日报（不传默认最近 30 天）
 * - `GET /api/admin/ledger/fund-report/monthly?year=` 月报（`year` 不传取当前年）
 * - `GET /api/admin/ledger/fund-report/export?from=&to=` 日报 CSV（UTF-8 BOM）
 *
 * ## ⚠️ 两条不能踩的口径
 * 1. **日报由后端补齐 0 值日**（没有交易的日子也返回一行 0）⇒ 前端**不要**自己补日 / 跳过空日；
 * 2. ⚠️⚠️ **月报是后端"由日报汇总而来"**（保证与日报一致）⇒
 *    前端**绝不要**把日报在本地累加成月报（口径会漂移，两边数字对不上就没人信报表了）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  exportFundReportCsv,
  getFundReportDaily,
  getFundReportMonthly,
  type FundReportDailyVO,
  type FundReportMonthlyVO,
} from '@/api/settlement-reports'

/** 当前页签：'daily' 日报 / 'monthly' 月报。 */
const activeTab = ref<'daily' | 'monthly'>('daily')

const daily = ref<FundReportDailyVO[]>([])
const monthly = ref<FundReportMonthlyVO[]>([])
const loading = ref(false)
const exporting = ref(false)

/** 日报区间（默认最近 30 天，与后端默认口径一致）。 */
const range = ref<[string, string]>(defaultRange())
/** 月报年份（默认当前年）。 */
const year = ref<number>(new Date().getFullYear())

/** 生成默认区间：最近 30 天（含今天）。 */
function defaultRange(): [string, string] {
  const today = new Date()
  const from = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
  return [fmt(today), fmt(from)].reverse() as [string, string]
}

/** `Date` → `yyyy-MM-dd`。 */
function fmt(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** 金额展示（null / undefined 显示 "—"）。 */
function money(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

/** 数量展示。 */
function count(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  return String(Number(value) || 0)
}

/** 拉日报。 */
async function loadDaily(): Promise<void> {
  loading.value = true
  try {
    daily.value = await getFundReportDaily({ from: range.value?.[0], to: range.value?.[1] })
  } catch (error) {
    daily.value = []
    ElMessage.error(error instanceof Error ? error.message : '资金日报加载失败')
  } finally {
    loading.value = false
  }
}

/** 拉月报（⚠️ **后端汇总**，前端只展示）。 */
async function loadMonthly(): Promise<void> {
  loading.value = true
  try {
    monthly.value = await getFundReportMonthly(year.value)
  } catch (error) {
    monthly.value = []
    ElMessage.error(error instanceof Error ? error.message : '资金月报加载失败')
  } finally {
    loading.value = false
  }
}

/** 当前页签的数据加载。 */
async function reload(): Promise<void> {
  if (activeTab.value === 'daily') await loadDaily()
  else await loadMonthly()
}

/** 导出日报 CSV（⚠️ 与列表**同一区间**，否则"看到的"和"导出的"对不上）。 */
async function exportCsv(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    await exportFundReportCsv({ from: range.value?.[0], to: range.value?.[1] })
    ElMessage.success('导出 CSV 已开始下载')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '资金日报导出失败')
  } finally {
    exporting.value = false
  }
}

/** 本页合计的累加器（⚠️ 显式声明类型：`reduce` 从字面量推断会让字段变成可选 ⇒ TS18048）。 */
interface DailyTotals {
  statementCount: number
  goodsAmount: number
  commissionAmount: number
  merchantIncome: number
  inflowAmount: number
  outflowAmount: number
}

/** 日报区间内的合计（⚠️ 仅用于**本页展示**，不是后端权威口径）。 */
const dailyTotals = computed<DailyTotals>(() => daily.value.reduce<DailyTotals>(
  (acc, row) => ({
    statementCount: acc.statementCount + Number(row.statementCount || 0),
    goodsAmount: acc.goodsAmount + Number(row.goodsAmount || 0),
    commissionAmount: acc.commissionAmount + Number(row.commissionAmount || 0),
    merchantIncome: acc.merchantIncome + Number(row.merchantIncome || 0),
    inflowAmount: acc.inflowAmount + Number(row.inflowAmount || 0),
    outflowAmount: acc.outflowAmount + Number(row.outflowAmount || 0),
  }),
  { statementCount: 0, goodsAmount: 0, commissionAmount: 0, merchantIncome: 0, inflowAmount: 0, outflowAmount: 0 },
))

onMounted(() => void loadDaily())
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">资金报表</span>
        <el-radio-group v-model="activeTab" @change="reload">
          <el-radio-button label="daily">日报</el-radio-button>
          <el-radio-button label="monthly">月报</el-radio-button>
        </el-radio-group>
      </div>
      <div class="toolbar-right">
        <!-- 日报：区间选择；月报：年份 -->
        <el-date-picker
          v-if="activeTab === 'daily'"
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <el-input-number v-else v-model="year" :min="2020" :max="2100" controls-position="right" />
        <el-button @click="reload">查询</el-button>
        <el-button type="primary" :loading="exporting" @click="exportCsv">导出 CSV</el-button>
      </div>
    </div>

    <el-alert
      class="hint"
      type="info"
      :closable="false"
      show-icon
      title="日报按自然日汇总（后端已补齐 0 值日，未交易的日子也会有一行 0）；月报由后端按日报汇总而来，保证与日报一致 —— 因此不要在本地把日报累加成月报。报表只读。"
    />

    <!-- 日报 -->
    <template v-if="activeTab === 'daily'">
      <el-table v-loading="loading" :data="daily" border stripe :max-height="560">
        <el-table-column prop="date" label="日期" width="120" fixed />
        <el-table-column label="结算单数" width="105"><template #default="{ row }">{{ count(row.statementCount) }}</template></el-table-column>
        <el-table-column label="商品金额" width="120"><template #default="{ row }">{{ money(row.goodsAmount) }}</template></el-table-column>
        <el-table-column label="平台抽成" width="120"><template #default="{ row }">{{ money(row.commissionAmount) }}</template></el-table-column>
        <el-table-column label="商家应得" width="120"><template #default="{ row }">{{ money(row.merchantIncome) }}</template></el-table-column>
        <el-table-column label="待入账" width="95"><template #default="{ row }">{{ count(row.pendingCount) }}</template></el-table-column>
        <el-table-column label="已入账" width="95"><template #default="{ row }">{{ count(row.creditedCount) }}</template></el-table-column>
        <el-table-column label="已作废" width="95"><template #default="{ row }">{{ count(row.reversedCount) }}</template></el-table-column>
        <el-table-column label="资金流入" width="120"><template #default="{ row }">{{ money(row.inflowAmount) }}</template></el-table-column>
        <el-table-column label="资金流出" width="120"><template #default="{ row }">{{ money(row.outflowAmount) }}</template></el-table-column>
        <el-table-column label="渠道差异" width="105"><template #default="{ row }">{{ count(row.channelDiffCount) }}</template></el-table-column>
      </el-table>
      <el-empty v-if="!loading && !daily.length" description="所选区间没有日报数据" />
      <!-- ⚠️ 明确标注"本页合计（前端累加，仅供参考）"，避免被当成权威口径 -->
      <div v-if="daily.length" class="totals">
        本页合计（前端累加，仅供参考）：结算单 {{ count(dailyTotals.statementCount) }} 条；
        商品金额 {{ money(dailyTotals.goodsAmount) }}；平台抽成 {{ money(dailyTotals.commissionAmount) }}；
        商家应得 {{ money(dailyTotals.merchantIncome) }}；流入 {{ money(dailyTotals.inflowAmount) }}；
        流出 {{ money(dailyTotals.outflowAmount) }}
      </div>
    </template>

    <!-- 月报（数据来自后端汇总） -->
    <template v-else>
      <el-table v-loading="loading" :data="monthly" border stripe :max-height="560">
        <el-table-column prop="month" label="月份" width="120" fixed />
        <el-table-column label="结算单数" width="105"><template #default="{ row }">{{ count(row.statementCount) }}</template></el-table-column>
        <el-table-column label="商品金额" width="120"><template #default="{ row }">{{ money(row.goodsAmount) }}</template></el-table-column>
        <el-table-column label="平台抽成" width="120"><template #default="{ row }">{{ money(row.commissionAmount) }}</template></el-table-column>
        <el-table-column label="商家应得" width="120"><template #default="{ row }">{{ money(row.merchantIncome) }}</template></el-table-column>
        <el-table-column label="待入账" width="95"><template #default="{ row }">{{ count(row.pendingCount) }}</template></el-table-column>
        <el-table-column label="已入账" width="95"><template #default="{ row }">{{ count(row.creditedCount) }}</template></el-table-column>
        <el-table-column label="已作废" width="95"><template #default="{ row }">{{ count(row.reversedCount) }}</template></el-table-column>
        <el-table-column label="资金流入" width="120"><template #default="{ row }">{{ money(row.inflowAmount) }}</template></el-table-column>
        <el-table-column label="资金流出" width="120"><template #default="{ row }">{{ money(row.outflowAmount) }}</template></el-table-column>
        <el-table-column label="渠道差异" width="105"><template #default="{ row }">{{ count(row.channelDiffCount) }}</template></el-table-column>
      </el-table>
      <el-empty v-if="!loading && !monthly.length" description="该年没有月报数据" />
    </template>
  </section>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.toolbar-left { display: flex; align-items: center; gap: 12px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.title { font-size: 16px; font-weight: 600; }
.hint { margin-bottom: 12px; }
.totals { margin-top: 12px; padding: 10px 12px; background: #f5f7fa; border-radius: 4px; color: #606266; font-size: 13px; line-height: 1.8; }
</style>
