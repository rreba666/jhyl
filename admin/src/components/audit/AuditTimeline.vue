<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import LedgerDiffTable from './LedgerDiffTable.vue'
import { getLedgerCategories, getLedgerTimeline } from '@/api/ledger'
import {
  buildCategoryLabelMap,
  formatLedgerTime,
  isLedgerChangeRecord,
  isSkippedLedger,
  ledgerCategoryLabel,
  ledgerOperatorText,
  ledgerResultMeta,
  ledgerTargetText,
} from '@/utils/ledgerLabels'
import type { LedgerRecord } from '@/types/ledger'

/**
 * 可复用留痕时间线：按**操作目标**反查该对象的全部留痕（谁、什么时候、改了什么）。
 * 数据源：`GET /api/admin/ledger/timeline`（⚠️ 按时间**升序**返回 = 执行顺序，与 `/ledger` 的倒序相反）。
 *
 * 用法（订单/任务详情页后续可直接嵌入，本期不改那些页面）：
 * ```vue
 * <AuditTimeline target-type="ORDER" :target-id="orderNo" />
 * ```
 *
 * ⚠️ `targetType` 必须是**逻辑类型**（`ORDER` / `DELIVERY_TASK` / `PRODUCT_SKU`），不是数据库表名。
 */
const props = defineProps<{
  /** 目标类型（必填，逻辑类型）。 */
  targetType: string
  /** 目标 ID（必填；订单号 / 任务号 / SKU ID）。 */
  targetId: string | number
}>()

/** 时间线记录（后端已按升序返回）。 */
const records = ref<LedgerRecord[]>([])
const loading = ref(false)
const error = ref('')
/** 分类字典（枚举名 → 中文标签），取不到时原样回显枚举名，不阻塞时间线渲染。 */
const categoryLabels = ref<Record<string, string>>({})

/** 加载分类字典（API 层有会话级缓存，重复调用不会重复请求）。 */
async function loadCategoryLabels(): Promise<void> {
  try {
    categoryLabels.value = buildCategoryLabelMap(await getLedgerCategories())
  } catch {
    categoryLabels.value = {}
  }
}

/** 拉取时间线；单项失败（如目标无留痕）只展示空态，不打扰其它内容。 */
async function loadTimeline(): Promise<void> {
  error.value = ''
  if (!props.targetType || props.targetId === '' || props.targetId === null || props.targetId === undefined) {
    records.value = []
    return
  }
  loading.value = true
  try {
    records.value = await getLedgerTimeline(props.targetType, String(props.targetId))
  } catch (caught) {
    records.value = []
    error.value = caught instanceof Error ? caught.message : '留痕时间线查询失败'
  } finally {
    loading.value = false
  }
}

/** 结果 → 时间线节点颜色。 */
function timelineType(result?: string | null): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const tag = ledgerResultMeta(result).tag
  return tag === 'danger' ? 'danger' : tag
}

watch([() => props.targetType, () => props.targetId], () => { void loadTimeline() })

onMounted(() => {
  void loadCategoryLabels()
  void loadTimeline()
})

defineExpose({ reload: loadTimeline })
</script>

<template>
  <div v-loading="loading" class="audit-timeline">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-empty v-else-if="!loading && !records.length" description="该目标暂无留痕记录" />
    <template v-else>
      <p class="timeline-summary">共 {{ records.length }} 条 · 已按时间升序排列（即实际执行顺序）</p>
      <el-timeline>
        <el-timeline-item
          v-for="record in records"
          :key="record.rowKey"
          :timestamp="formatLedgerTime(record.createTime)"
          placement="top"
          :type="timelineType(record.result)"
        >
          <div class="timeline-card">
            <div class="timeline-head">
              <el-tag size="small" effect="plain">{{ ledgerCategoryLabel(record.category, categoryLabels) }}</el-tag>
              <span class="timeline-op">{{ record.operation }}</span>
              <el-tag size="small" :type="ledgerResultMeta(record.result).tag">{{ ledgerResultMeta(record.result).label }}</el-tag>
              <el-tag v-if="isSkippedLedger(record)" size="small" type="warning" effect="dark">本次未改成</el-tag>
            </div>
            <p class="timeline-meta">操作人：{{ ledgerOperatorText(record) }} · 目标：{{ ledgerTargetText(record) }}</p>
            <p v-if="record.detail" class="timeline-detail">{{ record.detail }}</p>
            <!-- 变更类渲染「前 → 后」；动作类（无快照）只显示 detail，不渲染空对比框 -->
            <LedgerDiffTable
              v-if="isLedgerChangeRecord(record)"
              :before-json="record.beforeJson"
              :after-json="record.afterJson"
              :result="record.result"
            />
          </div>
        </el-timeline-item>
      </el-timeline>
    </template>
  </div>
</template>

<style scoped>
.audit-timeline { min-height: 80px; }
.timeline-summary { margin: 0 0 12px; color: var(--vben-muted); font-size: 13px; }
.timeline-card { padding: 12px 14px; background: var(--vben-surface); border: 1px solid var(--vben-border); border-radius: 10px; }
.timeline-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.timeline-op { color: var(--vben-text); font-size: 13px; font-weight: 600; word-break: break-all; }
.timeline-meta { margin: 8px 0 0; color: var(--vben-muted); font-size: 12px; word-break: break-all; }
.timeline-detail { margin: 6px 0 0; color: var(--vben-text); font-size: 13px; line-height: 1.6; word-break: break-word; }
:deep(.el-timeline-item__timestamp) { color: var(--vben-muted); font-size: 12px; }
</style>
