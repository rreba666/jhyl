<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import LedgerDiffTable from './LedgerDiffTable.vue'
import { getLedgerByRequest, getLedgerCategories, getLedgerTimeline } from '@/api/ledger'
import {
  buildCategoryLabelMap,
  formatLedgerTime,
  isLedgerChangeRecord,
  isLedgerOperationKnown,
  isSkippedLedger,
  ledgerCategoryLabel,
  ledgerOperationLabel,
  ledgerOperationTooltip,
  ledgerOperatorText,
  ledgerResultMeta,
  ledgerTargetText,
} from '@/utils/ledgerLabels'
import type { LedgerRecord } from '@/types/ledger'

/**
 * 可复用留痕时间线（两种"串联"口径，同一套渲染）：
 * 1. **按目标**：`GET /api/admin/ledger/timeline`（props `targetType` + `targetId`）——
 *    回答"这个订单/任务/SKU 一共经历了什么"；
 * 2. **按请求链路**：`GET /api/admin/ledger/by-request/{requestId}`（props `requestId`）——
 *    回答"我点了一次按钮，这一次请求到底改了哪几条数据"。
 * 两者后端都**按时间升序**返回（= 执行顺序，与 `/ledger` 的倒序相反）。
 *
 * 用法：
 * ```vue
 * <AuditTimeline target-type="ORDER" :target-id="orderNo" />
 * <AuditTimeline request-id="ORD11851213561858" />
 * ```
 *
 * ⚠️ `targetType` 必须是**逻辑类型**（`ORDER` / `DELIVERY_TASK` / `PRODUCT_SKU`），不是数据库表名。
 * ⚠️ 请求链路可能**查询为空**：历史行与定时任务行没有 `requestId`（实测覆盖率仅 14.2%），不是错误。
 */
const props = defineProps<{
  /** 目标类型（按目标查时间线时必填，逻辑类型）。 */
  targetType?: string
  /** 目标 ID（按目标查时间线时必填；订单号 / 任务号 / SKU ID）。 */
  targetId?: string | number
  /** 请求链路 ID；**传入时优先走 `/by-request`**（一次请求的多条留痕）。 */
  requestId?: string
}>()

/** 加载完成事件：把条数抛给调用方（弹窗标题要写"同一次请求共 N 条"）。 */
const emit = defineEmits<{ loaded: [count: number] }>()

/** 时间线记录（后端已按升序返回）。 */
const records = ref<LedgerRecord[]>([])
const loading = ref(false)
const error = ref('')
/** 分类字典（枚举名 → 中文标签），取不到时原样回显枚举名，不阻塞时间线渲染。 */
const categoryLabels = ref<Record<string, string>>({})

/** 是否走"按请求链路"口径（`requestId` 优先）。 */
const byRequest = computed(() => Boolean(String(props.requestId ?? '').trim()))

/** 空态文案（两种口径的原因不同，别让用户以为"数据丢了"）。 */
const emptyText = computed(() =>
  byRequest.value ? '该请求链路暂无留痕记录（历史行与定时任务行没有 requestId）' : '该目标暂无留痕记录',
)

/** 顶部摘要：请求链路口径要写明"同一次请求共 N 条"。 */
const summaryText = computed(() =>
  byRequest.value
    ? `同一次请求共 ${records.value.length} 条 · 已按时间升序排列（即实际执行顺序）`
    : `共 ${records.value.length} 条 · 已按时间升序排列（即实际执行顺序）`,
)

/** 加载分类字典（API 层有会话级缓存，重复调用不会重复请求）。 */
async function loadCategoryLabels(): Promise<void> {
  try {
    categoryLabels.value = buildCategoryLabelMap(await getLedgerCategories())
  } catch {
    categoryLabels.value = {}
  }
}

/** 按请求链路加载（同一次 HTTP 请求产生的多条留痕）。 */
async function loadByRequest(requestId: string): Promise<void> {
  loading.value = true
  try {
    const list = await getLedgerByRequest(requestId)
    // 文档保证升序；这里仍按 createTime 做一次稳定兜底排序（`yyyy-MM-ddTHH:mm:ss` 可直接字符串比较）
    records.value = [...list].sort((a, b) => String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')))
    emit('loaded', records.value.length)
  } catch (caught) {
    // ⚠️ 失败时不 emit 条数：让调用方标题保持中性，由错误提示说明原因
    records.value = []
    error.value = caught instanceof Error ? caught.message : '按请求链路查询留痕失败'
  } finally {
    loading.value = false
  }
}

/** 按目标加载（该对象的全部留痕）；单项失败（如目标无留痕）只展示空态，不打扰其它内容。 */
async function loadTimeline(): Promise<void> {
  const requestId = String(props.requestId ?? '').trim()
  if (requestId) {
    error.value = ''
    await loadByRequest(requestId)
    return
  }
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

watch([() => props.targetType, () => props.targetId, () => props.requestId], () => { void loadTimeline() })

onMounted(() => {
  void loadCategoryLabels()
  void loadTimeline()
})

defineExpose({ reload: loadTimeline })
</script>

<template>
  <div v-loading="loading" class="audit-timeline">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />
    <el-empty v-else-if="!loading && !records.length" :description="emptyText" />
    <template v-else>
      <p class="timeline-summary">{{ summaryText }}</p>
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
              <!-- 操作码中文化：未知码原样回显 + tooltip 提示"后端未收录"（列内省略显示，全称靠 tooltip） -->
              <el-tooltip placement="top" :content="ledgerOperationTooltip(record.operation)" :show-after="200">
                <span class="timeline-op" :class="{ 'timeline-op-unknown': !isLedgerOperationKnown(record.operation) }">
                  {{ ledgerOperationLabel(record.operation) }}
                </span>
              </el-tooltip>
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
/* 未收录中文名的操作码：灰色提示"这是未翻译的后端自由字符串" */
.timeline-op-unknown { color: var(--el-text-color-secondary); font-weight: 500; }
.timeline-meta { margin: 8px 0 0; color: var(--vben-muted); font-size: 12px; word-break: break-all; }
.timeline-detail { margin: 6px 0 0; color: var(--vben-text); font-size: 13px; line-height: 1.6; word-break: break-word; }
:deep(.el-timeline-item__timestamp) { color: var(--vben-muted); font-size: 12px; }
</style>
