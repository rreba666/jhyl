<script setup lang="ts">
import { computed } from 'vue'
import { buildLedgerDiff, LEDGER_SKIPPED_HINT } from '@/utils/ledgerLabels'

/**
 * 留痕「前 → 后」快照对比表。
 * 变更类事件（有 `beforeJson`/`afterJson`）渲染本组件；动作类（两者为 null）**不要渲染空对比框**，
 * 由调用方直接显示 `detail`。
 *
 * ⚠️ `result='SKIPPED'` 行的变更前值不可信（条件 UPDATE 未命中，前值取自 WHERE 条件）——
 * 这里对该行显著标注，并给变更前列加删除线视觉提示。
 */
const props = defineProps<{
  /** 变更前快照（JSON 字符串，可能为 null）。 */
  beforeJson?: string | null
  /** 变更后快照（JSON 字符串，可能为 null）。 */
  afterJson?: string | null
  /** 留痕结果，用于判定是否标注"前值不可信"。 */
  result?: string | null
}>()

/** 对比行（含状态码/金额的翻译，见 `utils/ledgerLabels.ts`）。 */
const rows = computed(() => buildLedgerDiff(props.beforeJson, props.afterJson))
/** 本行前值是否不可信。 */
const skipped = computed(() => props.result === 'SKIPPED')
/** 有原始快照但解析不出（脏 JSON）时，回退展示后端原文而不是静默丢数据。 */
const hasRawSnapshot = computed(() => Boolean(props.beforeJson || props.afterJson))
</script>

<template>
  <div v-if="rows.length" class="ledger-diff">
    <el-alert
      v-if="skipped"
      type="warning"
      :closable="false"
      show-icon
      :title="`本行 result=SKIPPED：${LEDGER_SKIPPED_HINT}`"
      description="条件更新未命中时，「变更前」取自 SQL 的 WHERE 条件，可能断言一个数据库里从未存在过的状态，追责展示时不要采信。"
    />
    <el-table :data="rows" size="small" border :show-header="true">
      <el-table-column prop="label" label="字段" width="150" />
      <el-table-column label="变更前" min-width="140">
        <template #default="{ row }">
          <span :class="{ 'diff-unreliable': skipped }">{{ row.before }}</span>
        </template>
      </el-table-column>
      <el-table-column label="" width="44" align="center">
        <template #default>→</template>
      </el-table-column>
      <el-table-column label="变更后" min-width="140">
        <template #default="{ row }">{{ row.after }}</template>
      </el-table-column>
    </el-table>
  </div>
  <div v-else-if="hasRawSnapshot" class="ledger-diff">
    <el-alert type="warning" :closable="false" show-icon title="前后快照不是可解析的 JSON，以下为后端原文" />
    <pre class="diff-raw">变更前：{{ beforeJson || '—' }}
变更后：{{ afterJson || '—' }}</pre>
  </div>
</template>

<style scoped>
.ledger-diff { margin-top: 10px; }
.ledger-diff .el-alert { margin-bottom: 8px; }
.diff-unreliable { color: var(--el-text-color-secondary); text-decoration: line-through; }
.diff-raw { margin: 8px 0 0; padding: 10px 12px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: var(--vben-bg); border: 1px solid var(--vben-border); border-radius: 8px; }
</style>
