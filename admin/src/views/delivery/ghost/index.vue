<script setup lang="ts">
/**
 * 幽灵单巡检（体检页）。
 *
 * 依据：`docs/20269231438/幽灵单巡检-前端对接说明-2026-09-23.md`。
 *
 * ## 这个页面在做什么
 * 后端扫一批"不该存在的订单状态组合"（钱退了单没关、任务悬空、状态流水断链…），
 * 返回**计数 + 命中明细**。本批（2026-09-24）的行为性变化是计数拆成「新增 / 存量」：
 * **徽标 / 红点 / 告警只算 `newTotal` / `newCount`**，存量（上线前已记账）**永不染红**。
 *
 * ## 三条硬约束（改这个页面前先读）
 * 1. ⛔ **不提供"一键修复"按钮**：后端也没有该接口。检测阶段纯只读，只有白名单内的项
 *    后端会做**零资金风险**的收敛，前端只按 `fixed` / `autoFixable` **如实展示**三种口径。
 * 2. ⛔ **存在盲区时绝不能显示"体检通过"**：`skippedChecks` / `unknownTypes` 非空即盲区
 *    （历史事故：列改名后某项长期未巡检而无人察觉）。
 * 3. ⛔ **接口报错时严禁吞掉、严禁渲染成"0 条异常"**：后端刻意 fail-fast 不降级
 *    （降级要么把存量当新增刷屏、要么把新增当存量漏报，两种错都会让人决策错误）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getGhostCheckMetas, runGhostInspect } from '@/api/ghost-inspect'
import type {
  GhostCheckMeta,
  GhostInspectData,
  GhostInspectItem,
  GhostSampleKind,
  GhostSeverity,
} from '@/types/ghost-inspect'

const route = useRoute()

/** 巡检结果；接口报错时保持 `null`（配合 `loadError` 走错误分支，**不渲染"0 条"**）。 */
const data = ref<GhostInspectData | null>(null)
const loading = ref(false)
/** 接口错误原文；非空即"本次结果不可信"。 */
const loadError = ref('')
/** `/checks` 字典：只用于拿 `baselined`（决定要不要渲染"新增/存量"拆分 UI）。 */
const metas = ref<GhostCheckMeta[]>([])

/**
 * 深链参数 `?types=A,B`（待办铃铛约定：`/delivery/ghost?types=<CHECK_KEY>`）。
 * 传了就**只巡检这些项**，此时徽标 = 该子集各项 `newCount` 之和。
 */
const requestedTypes = computed<string[]>(() => {
  const raw = route.query.types
  const text = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
  return text.split(',').map((part) => part.trim()).filter(Boolean)
})

/** 是否处于"深链只跑指定项"模式。 */
const scoped = computed(() => requestedTypes.value.length > 0)

/**
 * 参与存量基线化的项 key 集合。
 * ⚠️ 只有 `baselined=true` 的项才渲染"新增/存量"拆分 —— 27 项里的 23 项不参与，
 * 对它们渲染拆分只会得到满屏 `新增 N / 存量 0` 噪声。
 */
const baselinedKeys = computed(() => new Set(metas.value.filter((meta) => meta.baselined).map((meta) => meta.key)))

/**
 * 是否存在盲区（未执行 / 未知 key）。
 * ⚠️ 为真时页面**不得**出现"体检通过/无异常"的结论。
 */
const hasBlindSpot = computed(() => {
  const current = data.value
  if (!current) return false
  return (
    current.skippedChecks.length > 0
    || current.unknownTypes.length > 0
    || current.executedTypes < current.checkedTypes
  )
})

/** 列表排序：`newCount` 降序 → `legacyCount` 降序（新增永远在最上面）。 */
const sortedItems = computed<GhostInspectItem[]>(() => {
  const items = [...(data.value?.items || [])]
  return items.sort((a, b) => b.newCount - a.newCount || b.legacyCount - a.legacyCount)
})

/** 严重级别 → 标签文案。 */
function severityLabel(severity: GhostSeverity): string {
  const map: Record<GhostSeverity, string> = {
    MONEY: '涉及资金',
    INCONSISTENT: '状态矛盾',
    STUCK: '卡死',
    RISK: '潜在风险',
  }
  return map[severity] || severity
}

/** 严重级别 → Element Plus tag 类型（⚠️ 只表达性质，**不表达"是否新增"**）。 */
function severityTagType(severity: GhostSeverity): 'danger' | 'warning' | 'info' {
  if (severity === 'MONEY' || severity === 'STUCK') return 'danger'
  if (severity === 'INCONSISTENT') return 'warning'
  return 'info'
}

/** 样例归属 → 标签文案；`null` 返回空串（调用方据此不渲染标签）。 */
function sampleKindLabel(kind: GhostSampleKind): string {
  if (kind === 'NEW') return '新增'
  if (kind === 'LEGACY') return '历史存量（已记账）'
  if (kind === 'NEW_AND_LEGACY') return '新增 + 存量'
  return ''
}

/** 该项是否渲染"共 N（新增 N / 存量 N）"拆分（仅基线化项）。 */
function showSplit(item: GhostInspectItem): boolean {
  return baselinedKeys.value.has(item.key)
}

/** 拉取巡检结果；深链时只跑 `types` 指定项。 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await runGhostInspect(scoped.value ? requestedTypes.value : undefined)
  } catch (error) {
    // ⚠️ 保持 data=null：错误态绝不渲染成"0 条异常"（见文件头约束 3）
    data.value = null
    loadError.value = error instanceof Error ? error.message : '幽灵单巡检执行失败'
  } finally {
    loading.value = false
  }
}

/** 拉字典；失败**不阻塞**主流程（只影响拆分 UI 与"本次跑了 x / 27 项"的展示）。 */
async function loadMetas(): Promise<void> {
  try {
    metas.value = await getGhostCheckMetas()
  } catch {
    metas.value = []
  }
}

onMounted(() => {
  void loadMetas()
  void load()
})

// 深链参数变化（例如从另一个待办再点进来）时重跑
watch(requestedTypes, () => {
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>幽灵单巡检</h1>
        <p>
          扫描「不该存在的订单状态组合」（钱没退单没关、任务悬空、状态流水断链…）。
          <strong>徽标与告警只算「新增」</strong>，历史存量仅记账、不告警。
        </p>
      </div>
      <el-button type="primary" :loading="loading" @click="load">重新巡检</el-button>
    </div>

    <!-- 盲区 3：接口报错。后端 fail-fast ⇒ 必须显式告知，不可吞掉 -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="blind-alert">
      <template #title>基线数据不可用，本次结果不可信</template>
      <p class="blind-text">{{ loadError }}</p>
      <p class="blind-text">
        常见原因是基线表 <code>inspect_baseline</code> 读不到（迁移 <code>V19007</code> 没跑 / 表被删）。
        请后端确认迁移 <code>V19007</code> 是否已执行。
      </p>
    </el-alert>

    <template v-else>
      <!-- 盲区 1：skippedChecks 非空（等价 executedTypes &lt; checkedTypes） -->
      <el-alert
        v-if="data && data.skippedChecks.length"
        type="warning"
        :closable="false"
        show-icon
        class="blind-alert"
      >
        <template #title>本轮有 {{ data.skippedChecks.length }} 项未执行，体检不完整</template>
        <p class="blind-text">
          多为表结构变更后 SQL 未同步。这些项<strong>没有被检查</strong>，不代表它们没有命中。
        </p>
        <ul class="blind-list">
          <li v-for="skipped in data.skippedChecks" :key="skipped.key">
            <code>{{ skipped.key }}</code> {{ skipped.label }} —— {{ skipped.error }}
          </li>
        </ul>
      </el-alert>

      <!-- 盲区 2：unknownTypes 非空（key 拼错/已改名，没被巡检） -->
      <el-alert
        v-if="data && data.unknownTypes.length"
        type="warning"
        :closable="false"
        show-icon
        class="blind-alert"
      >
        <template #title>
          有 {{ data.unknownTypes.length }} 个 key 不存在（拼错或已改名），没有被巡检
        </template>
        <p class="blind-text"><code>{{ data.unknownTypes.join('、') }}</code></p>
      </el-alert>

      <!-- 统计概览 -->
      <el-card v-if="data" shadow="never" class="summary-card">
        <div class="summary-row">
          <div class="summary-item">
            <span class="summary-label">新增命中（徽标口径）</span>
            <span class="summary-value" :class="{ danger: data.newTotal > 0 }">{{ data.newTotal }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">命中总数（含存量，仅展示）</span>
            <span class="summary-value muted">{{ data.total }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">本次巡检范围</span>
            <span class="summary-value">
              {{ data.checkedTypes }} / {{ data.allChecks }}
              <el-tag v-if="scoped" size="small" type="info" effect="plain">深链指定项</el-tag>
            </span>
          </div>
          <div class="summary-item">
            <span class="summary-label">实际执行成功</span>
            <span class="summary-value" :class="{ warning: data.executedTypes < data.checkedTypes }">
              {{ data.executedTypes }}
            </span>
          </div>
          <div v-if="data.fixedTotal > 0" class="summary-item">
            <span class="summary-label">本轮已自动收敛</span>
            <span class="summary-value">{{ data.fixedTotal }}</span>
          </div>
        </div>
        <p v-if="scoped" class="summary-hint">
          正在只巡检指定的 {{ requestedTypes.length }} 项：
          <code>{{ requestedTypes.join('、') }}</code>
        </p>
      </el-card>

      <!-- 命中列表 -->
      <div v-if="data" class="check-list">
        <el-card
          v-for="item in sortedItems"
          :key="item.key"
          shadow="never"
          :class="['check-card', item.newCount > 0 ? 'is-new' : 'is-legacy']"
        >
          <div class="check-head">
            <div class="check-title">
              <el-tag :type="severityTagType(item.severity)" size="small" effect="plain">
                {{ severityLabel(item.severity) }}
              </el-tag>
              <strong>{{ item.label }}</strong>
            </div>
            <div class="check-count">
              <span class="count-main" :class="{ danger: item.newCount > 0 }">新增 {{ item.newCount }}</span>
              <span v-if="showSplit(item)" class="count-sub">
                共 {{ item.count }}（新增 {{ item.newCount }} / 存量 {{ item.legacyCount }}）
              </span>
              <span v-else class="count-sub">共 {{ item.count }}</span>
            </div>
          </div>

          <div class="check-tags">
            <!-- 纯存量：灰色/中性，可折叠；绝不染红 -->
            <el-tag v-if="item.newCount === 0 && item.count > 0" type="info" size="small">
              历史存量，已记账，未新增
            </el-tag>
            <el-tag v-if="sampleKindLabel(item.sampleKind)" type="info" size="small" effect="plain">
              {{ sampleKindLabel(item.sampleKind) }}
            </el-tag>
          </div>

          <p v-if="item.suggestion" class="suggestion">建议：{{ item.suggestion }}</p>

          <!-- 自动修复口径：如实展示三态；⛔ 不提供"一键修复"按钮（后端也没有该接口） -->
          <p v-if="item.fixed > 0" class="fix-note">
            本轮已自动修复 {{ item.fixed }} 条<template v-if="item.fixNote">：{{ item.fixNote }}</template>
          </p>
          <p v-else-if="item.autoFixable" class="fix-note">
            {{ item.fixNote || '本轮无需修复（条件不满足）' }}
          </p>
          <p v-else class="fix-note muted">只报不改，需人工处置</p>

          <div v-if="item.samples.length" class="samples">
            <p class="samples-title">定位样例（最多 5 条，新增优先；纯文本请勿解析）</p>
            <pre v-for="(sample, index) in item.samples" :key="index" class="sample-line">{{ sample }}</pre>
          </div>
        </el-card>

        <!-- 空态：⚠️ 有盲区时不能说"体检通过" -->
        <el-empty
          v-if="!sortedItems.length"
          :description="hasBlindSpot
            ? '本轮未命中，但存在未执行的项（见上方黄色告警），体检不完整'
            : '未命中任何巡检项'"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.blind-alert { margin-bottom: 16px; }
.blind-text { margin: 6px 0 0; line-height: 1.7; }
.blind-list { margin: 8px 0 0; padding-left: 20px; line-height: 1.8; }
.summary-card { margin-bottom: 16px; }
.summary-row { display: flex; flex-wrap: wrap; gap: 32px; }
.summary-item { display: flex; flex-direction: column; gap: 6px; }
.summary-label { color: var(--el-text-color-secondary); font-size: 13px; }
.summary-value { font-size: 22px; font-weight: 700; }
.summary-value.muted { color: var(--el-text-color-secondary); font-weight: 500; }
.summary-value.danger { color: var(--el-color-danger); }
.summary-value.warning { color: var(--el-color-warning); }
.summary-hint { margin: 14px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.check-list { display: flex; flex-direction: column; gap: 14px; }
/* 新增 = 真回归 ⇒ 左侧红条；纯存量 = 中性灰条（不告警） */
.check-card { border-left: 4px solid var(--el-border-color); }
.check-card.is-new { border-left-color: var(--el-color-danger); }
.check-card.is-legacy { border-left-color: var(--el-border-color); }
.check-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.check-title { display: flex; align-items: flex-start; gap: 8px; line-height: 1.6; }
.check-count { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.count-main { font-size: 18px; font-weight: 700; color: var(--el-text-color-secondary); }
.count-main.danger { color: var(--el-color-danger); }
.count-sub { color: var(--el-text-color-secondary); font-size: 12px; }
.check-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.suggestion { margin: 10px 0 0; line-height: 1.7; }
.fix-note { margin: 8px 0 0; color: var(--el-color-success); font-size: 13px; }
.fix-note.muted { color: var(--el-text-color-secondary); }
.samples { margin-top: 12px; padding: 10px 12px; background: var(--el-fill-color-light); border-radius: 6px; }
.samples-title { margin: 0 0 6px; color: var(--el-text-color-secondary); font-size: 12px; }
.sample-line { margin: 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
</style>
