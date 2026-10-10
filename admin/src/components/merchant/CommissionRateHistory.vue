<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMerchantCommissionRateHistory } from '@/api/merchant'
import type { MerchantCommissionRateLog } from '@/types/merchant'

/**
 * 商户「让利比例变更历史」（`GET /api/admin/merchants/{id}/commission-rate-history`）。
 *
 * 契约要点（2026-10-10 复核 `api_doc.json`）：
 * - **按时间倒序**返回该商户的让利比例变更记录（结构化 before/after + 方向 + 操作人）；
 * - 唯一参数 `limit`：**可选、默认 20、最大 200**；
 * - ⚠️ **接口没有分页**（契约里没有 `page` / `pageSize` / `total`）⇒ 一次最多只能拿到 `limit` 条，
 *   超出部分**无法翻页取得** —— 所以本组件默认直接按**上限 200** 拉，并且
 *   **在条数达到上限时明确写出"可能还有更早的记录未显示"**，绝不暗示列表是完整的。
 *
 * ⚠️⚠️ 两条硬约束（本项目有过"按文档措辞猜字段"的 P0 事故）：
 * 1. `direction` / `operatorType` 契约里**没有枚举**（只是 `string`）⇒ **原样展示**，
 *    **不映射任何中文标签**（猜错的枚举比裸字符串危险）；缺失显示「未提供」。
 * 2. `beforeRate` 契约里**没有可空性说明**（文档示例「未设置 → 6.00%」暗示"变更前"可能缺失）
 *    ⇒ 缺失 / `null` / `undefined` 一律显示「未设置」，**绝不兜底成 `0`**（那会编造"变更前 0%"）。
 *
 * 用法（**务必用 `v-if` 挂在弹窗上** ⇒ 弹窗打开才创建组件、才发请求；列表渲染阶段不发请求）：
 * ```vue
 * <CommissionRateHistory v-if="dialogVisible && target" :merchant-id="target.id" />
 * ```
 */
const props = defineProps<{
  /** 商户 ID（后端 long，走 path 参数）。 */
  merchantId: string | number
}>()

/** 契约允许的单次上限（`limit` 最大 200）。 */
const MAX_LIMIT = 200
/** 可选的单次条数。⚠️ 这是"一次拉多少条"，**不是翻页** —— 接口没有分页。 */
const LIMIT_OPTIONS = [20, 50, 100, MAX_LIMIT]

/** 原样展示字段的 tooltip：把"这里为什么是英文/裸串"讲清楚，避免运营以为是页面没翻译。 */
const RAW_VALUE_HINT = '该字段在接口契约里没有枚举定义，此处原样展示后端返回的字符串'

const records = ref<MerchantCommissionRateLog[]>([])
const loading = ref(false)
const error = ref('')
/** 单次拉取条数；默认取契约上限，尽量一次拿全（接口无分页）。 */
const limit = ref<number>(MAX_LIMIT)

/** 是否是一个"真的有值"的比例。⚠️ `''` / `null` / `undefined` / 非有限数一律视为缺失。 */
function hasRate(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  return Number.isFinite(Number(value))
}

/**
 * 比例文案：有值 → `N%`；缺失 → 「未设置」。
 * ⚠️ **禁止**在这里写 `?? 0` / `|| 0` / `Number(value) || 0` —— 缺失就是缺失，不是 0%。
 */
function rateText(value: unknown): string {
  return hasRate(value) ? `${Number(value)}%` : '未设置'
}

/**
 * 原样字段文案（`direction` / `operatorType` / `operatorName` 共用）。
 * ⚠️ 契约无枚举 ⇒ **不做任何映射**，有值原样返回（含英文原值），无值返回「未提供」。
 */
function rawText(value?: string | null): string {
  const text = String(value ?? '').trim()
  return text || '未提供'
}

/**
 * 时间展示：后端为 `yyyy-MM-ddTHH:mm:ss`（ISO 本地时间、**无时区后缀**）。
 * 与 `formatLedgerTime` 同策略：只做字符串规范化、**不经过 `new Date()`**，避免浏览器时区导致时间漂移。
 */
function formatTime(value?: string | null): string {
  if (!value) return '未提供'
  return String(value).replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19)
}

/**
 * 条数摘要 —— **必须诚实地说明"是否可能被截断"**（接口无分页）：
 * 达到 `limit` 上限时写明可能还有更早的记录，否则说明本次已在单次上限内取全。
 */
const summaryText = computed(() =>
  records.value.length >= limit.value
    ? `共 ${records.value.length} 条 · 接口无分页，本次已按单次上限 ${limit.value} 条拉取，可能还有更早的记录未显示`
    : `共 ${records.value.length} 条 · 接口无分页；条数少于单次上限 ${limit.value} 条，本次应为该商户的全部变更记录`,
)

/** 拉取历史（后端已按时间倒序，前端不再重排，避免与后端口径不一致）。 */
async function load(): Promise<void> {
  const id = String(props.merchantId ?? '').trim()
  if (!id) {
    records.value = []
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    records.value = await getMerchantCommissionRateHistory(id, limit.value)
  } catch (caught) {
    // 失败时清空列表：宁可显示错误，也不留上一次商户的数据在这里冒充本次结果
    records.value = []
    error.value = caught instanceof Error ? caught.message : '让利比例变更历史查询失败'
  } finally {
    loading.value = false
  }
}

// immediate ⇒ 组件一被创建（= 弹窗打开）就拉一次；`merchantId` 变化（换商户）或改单次条数时重拉。
watch([() => props.merchantId, limit], () => { void load() }, { immediate: true })
</script>

<template>
  <div v-loading="loading" class="rate-history">
    <div class="rate-history-head">
      <strong class="rate-history-title">让利比例变更历史</strong>
      <div class="rate-history-actions">
        <el-select v-model="limit" size="small" class="rate-history-limit">
          <el-option v-for="option in LIMIT_OPTIONS" :key="option" :label="`单次 ${option} 条`" :value="option" />
        </el-select>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- 错误态：把后端文案原样抛出（不吞错、不降级成"暂无数据"） -->
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" />

    <template v-else>
      <p v-if="records.length" class="rate-history-summary">{{ summaryText }}</p>
      <el-empty
        v-if="!loading && !records.length"
        :image-size="60"
        description="暂无让利比例变更记录"
      />
      <el-timeline v-else>
        <el-timeline-item
          v-for="(log, index) in records"
          :key="log.id || index"
          placement="top"
          :timestamp="formatTime(log.createTime)"
        >
          <div class="rate-log">
            <!-- 结构化 before → after：两个值各自独立判缺失（「未设置」≠ 0%） -->
            <p class="rate-log-rates">
              <span class="rate-log-rate">{{ rateText(log.beforeRate) }}</span>
              <span class="rate-log-arrow">→</span>
              <span class="rate-log-rate rate-log-rate-after">{{ rateText(log.afterRate) }}</span>
            </p>
            <p class="rate-log-meta">
              <span class="rate-log-key">方向：</span>
              <el-tooltip placement="top" :content="RAW_VALUE_HINT" :show-after="200">
                <span class="rate-log-raw">{{ rawText(log.direction) }}</span>
              </el-tooltip>
              <span class="rate-log-sep">·</span>
              <span class="rate-log-key">操作人类型：</span>
              <el-tooltip placement="top" :content="RAW_VALUE_HINT" :show-after="200">
                <span class="rate-log-raw">{{ rawText(log.operatorType) }}</span>
              </el-tooltip>
              <span class="rate-log-sep">·</span>
              <span class="rate-log-key">操作人：</span>
              <span>{{ rawText(log.operatorName) }}</span>
            </p>
          </div>
        </el-timeline-item>
      </el-timeline>
    </template>
  </div>
</template>

<style scoped>
.rate-history { min-height: 60px; }
.rate-history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.rate-history-title { color: var(--vben-text); font-size: 14px; }
.rate-history-actions { display: flex; align-items: center; gap: 8px; }
.rate-history-limit { width: 120px; }
.rate-history-summary { margin: 0 0 12px; color: var(--vben-muted); font-size: 12px; line-height: 1.6; }
.rate-log { padding: 10px 12px; background: var(--vben-surface); border: 1px solid var(--vben-border); border-radius: 10px; }
.rate-log-rates { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; color: var(--vben-text); }
.rate-log-rate-after { color: var(--el-color-primary); }
.rate-log-arrow { color: var(--vben-muted); font-weight: 400; }
.rate-log-meta { margin: 6px 0 0; color: var(--vben-muted); font-size: 12px; word-break: break-all; }
.rate-log-sep { margin: 0 6px; }
/* 无枚举的裸字段：浅色显示，提示"这是后端自由字符串，未做中文映射" */
.rate-log-raw { color: var(--el-text-color-secondary); font-family: inherit; }
:deep(.el-timeline-item__timestamp) { color: var(--vben-muted); font-size: 12px; }
:deep(.el-timeline) { padding-left: 2px; }
</style>
