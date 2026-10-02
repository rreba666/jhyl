<script setup lang="ts">
/**
 * 渠道账单对账（P7，2026-10-03 新增）。
 *
 * 契约：`docs/26/10.03/前端对接-P7微信渠道账单对账-2026-10-03.md`
 * - `POST /api/admin/ledger/channel-reconcile` 手动触发（`billDate` + 可选 `billBody`）
 * - `GET  /api/admin/ledger/channel-anomalies?billDate=` 差异明细（最多 500 条，新记录在前）
 *
 * ## ⚠️ 三条必须守住的口径
 * 1. ⚠️⚠️ **「渠道无账单」是正常情况**（后端 `code=1000`）—— 例如当天微信还没出账、或该日无交易。
 *    ⇒ 必须按**中性信息**展示（蓝色 / 灰色提示），**绝不能**弹红色错误或当成故障。
 * 2. ⚠️ **只报不改**：对账差异**只落异常台账 + 告警**，系统**不会**修改任何本地数据
 *    ⇒ 界面必须写清楚，避免运营以为"点一下就把账平了"。
 * 3. ⚠️ **按 `diffType` 码匹配**，不要按后端文案匹配（四类：
 *    `CHANNEL_ONLY` 渠道有本地无 / `LOCAL_ONLY` 本地有渠道无 /
 *    `AMOUNT_MISMATCH` 金额不一致 / `STATUS_MISMATCH` 状态不一致）。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CHANNEL_DIFF_LABELS,
  channelDiffLabel,
  getChannelAnomalies,
  reconcileChannelBill,
  type ChannelAnomalyVO,
} from '@/api/settlement-reports'

/** 账单日期（`yyyy-MM-dd`）；默认今天。 */
const billDate = ref(formatDate(new Date()))
const list = ref<ChannelAnomalyVO[]>([])
const loading = ref(false)
const reconciling = ref(false)
/** ⚠️ 「该日渠道无账单」——**正常情况**，用中性提示展示（不是错误）。 */
const billAbsent = ref(false)
/** 差异类型筛选（空 = 全部）。 */
const diffFilter = ref('')

/** `Date` → `yyyy-MM-dd`（后端参数口径）。 */
function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** 查询差异明细。 */
async function loadAnomalies(): Promise<void> {
  if (!billDate.value) {
    ElMessage.warning('请选择账单日期')
    return
  }
  loading.value = true
  try {
    const result = await getChannelAnomalies(billDate.value)
    list.value = result.list
    billAbsent.value = result.billAbsent
  } catch (error) {
    billAbsent.value = false
    list.value = []
    ElMessage.error(error instanceof Error ? error.message : '渠道差异查询失败')
  } finally {
    loading.value = false
  }
}

/** 手动触发对账（⚠️ 幂等：同一账单重复提交不会产生重复台账行；但**不会**修正本地数据）。 */
async function triggerReconcile(): Promise<void> {
  if (!billDate.value) {
    ElMessage.warning('请选择账单日期')
    return
  }
  reconciling.value = true
  try {
    await reconcileChannelBill({ billDate: billDate.value })
    ElMessage.success('对账已完成，差异已落异常台账（系统不会修改本地数据）')
    await loadAnomalies()
  } catch (error) {
    // ⚠️ 这里的失败是**真错误**（无账单走的是另一条路径，见 getChannelAnomalies）
    ElMessage.error(error instanceof Error ? error.message : '渠道对账失败')
  } finally {
    reconciling.value = false
  }
}

/** 按当前筛选展示的行。 */
function visibleRows(): ChannelAnomalyVO[] {
  if (!diffFilter.value) return list.value
  return list.value.filter((row) => String(row.diffType || '') === diffFilter.value)
}

/** 金额展示（null 显示 "—"，不要显示 0.00 —— 那是"没有这一侧"而不是 0 元）。 */
function money(value?: number | null): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

onMounted(() => void loadAnomalies())
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">渠道账单对账</span>
        <el-date-picker v-model="billDate" type="date" value-format="YYYY-MM-DD" placeholder="账单日期" />
        <el-button type="primary" :loading="reconciling" @click="triggerReconcile">重新对账</el-button>
        <el-button @click="loadAnomalies">查询差异</el-button>
      </div>
      <el-select v-model="diffFilter" class="diff-select" placeholder="全部差异类型" clearable>
        <el-option v-for="(label, code) in CHANNEL_DIFF_LABELS" :key="code" :label="label" :value="code" />
      </el-select>
    </div>

    <el-alert
      class="hint"
      type="warning"
      :closable="false"
      show-icon
      title="只报不改：对账差异只落异常台账并告警，系统不会修改任何本地数据。差异需要人工核查后按流程处理。"
    />

    <!-- ⚠️ 「渠道无账单」= 正常情况（例如当天微信还没出账 / 该日无交易）⇒ 中性提示，不要用 error -->
    <el-alert
      v-if="billAbsent"
      class="hint"
      type="info"
      :closable="false"
      show-icon
      title="该日渠道无账单（属正常情况）"
      description="渠道账单通常 T+1 才生成；若当日无交易也可能没有账单。这不代表对账失败，可稍后再查。"
    />

    <el-table v-loading="loading" :data="visibleRows()" border stripe>
      <el-table-column label="差异类型" width="140">
        <template #default="{ row }">
          <!-- ⚠️ 按 diffType 码匹配（用映射表），不依赖后端文案 -->
          <el-tag :type="row.diffType === 'AMOUNT_MISMATCH' ? 'danger' : 'warning'" size="small">
            {{ channelDiffLabel(row.diffType) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="orderNo" label="本地订单号" min-width="180">
        <template #default="{ row }">{{ row.orderNo || '—' }}</template>
      </el-table-column>
      <el-table-column prop="channelTradeNo" label="渠道流水号" min-width="200">
        <template #default="{ row }">{{ row.channelTradeNo || '—' }}</template>
      </el-table-column>
      <el-table-column label="本地金额" width="120">
        <template #default="{ row }">{{ money(row.localAmount) }}</template>
      </el-table-column>
      <el-table-column label="渠道金额" width="120">
        <template #default="{ row }">{{ money(row.channelAmount) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">{{ row.status || '—' }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="180">
        <template #default="{ row }">{{ row.remark || '—' }}</template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !visibleRows().length && !billAbsent" description="该账单日没有渠道差异" />

    <p class="footnote">
      差异类型说明：CHANNEL_ONLY 渠道有本地无（可能漏记支付）；LOCAL_ONLY 本地有渠道无（可能多记）；
      AMOUNT_MISMATCH 金额不一致；STATUS_MISMATCH 状态不一致。接口最多返回 500 条，新记录在前。
    </p>
  </section>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.toolbar-left { display: flex; align-items: center; gap: 8px; }
.title { font-size: 16px; font-weight: 600; margin-right: 8px; }
.diff-select { width: 180px; }
.hint { margin-bottom: 12px; }
.footnote { margin-top: 12px; color: #909399; font-size: 12px; line-height: 1.7; }
</style>
