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
 * 盲区详情里的「未执行的项 key」拼接文本。
 * ⚠️ 2026-10-03：原先写在模板里（`data.skippedChecks.map(...)`）—— 模板只做展示、推导放 script，
 * 且这是**技术详情**（收在折叠区），与商家可见文案分开。
 */
const skippedKeysText = computed(() => (data.value?.skippedChecks || []).map((s) => s.key).join('、') || '—')

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
        <p class="heading-sub">（商家视角：<strong>订单异常巡检</strong>）</p>
      </div>
      <el-button type="primary" :loading="loading" @click="load">重新巡检</el-button>
    </div>

    <!--
      ⚠️⚠️ 2026-10-03 新增：**给商家看的说明卡**。
      起因（用户实测反馈）：入驻商家在这个页面看到「幽灵单巡检」「状态流水断链」「基线口径」
      这类内部术语，**完全不知道这是什么、为什么会有、自己要做什么**。
      下面三块依次回答这三个问题；**技术细节一律下沉到折叠区**（见页面底部）。
    -->
    <el-card shadow="never" class="explain-card">
      <div class="explain-grid">
        <div class="explain-item">
          <h3 class="explain-q">这是什么？</h3>
          <p class="explain-a">
            系统自动检查<strong>你的店铺订单有没有"状态不正常"的情况</strong> ——
            比如顾客退款成功了但订单还挂着、配送任务停住了没继续、或者订单状态记录断了一截。
            <br />它的作用是<strong>提前发现问题</strong>，避免出现「钱和货对不上」。
          </p>
        </div>
        <div class="explain-item">
          <h3 class="explain-q">为什么会出现？</h3>
          <p class="explain-a">
            多数是<strong>流程走到一半被打断</strong>造成的，例如：
            <ul class="explain-ul">
              <li>顾客申请退款后，退款流程走完但订单没有跟着关闭；</li>
              <li>配送中途被取消 / 骑手长时间没更新，任务停在半路；</li>
              <li>系统在切换状态时出了一次错，导致状态记录缺了一环。</li>
            </ul>
            ⚠️ <strong>通常不是你的操作失误</strong>，也不代表顾客已经在投诉。
          </p>
        </div>
        <div class="explain-item">
          <h3 class="explain-q">你该做什么？</h3>
          <p class="explain-a">
            <ul class="explain-ul">
              <li><strong>红色「新增」为 0</strong> ⇒ 不用管，页面只是留个记录；</li>
              <li><strong>有红色「新增」</strong> ⇒ 点开该条，按上面的<strong>「建议」</strong>处理；
                涉及钱的（退款类）请<strong>联系平台客服</strong>核实，<strong>不要自己改订单</strong>；</li>
              <li>拿不准 ⇒ 把<strong>订单号</strong>发给客服，让平台协助排查。</li>
            </ul>
            ⚠️ 本页<strong>只检查、不修改</strong>，没有"一键修复"，这是有意设计的（防误操作）。
          </p>
        </div>
      </div>
      <el-collapse class="tech-collapse">
        <el-collapse-item name="tech">
          <template #title>
            <span class="tech-title">给技术同学的详情</span>
          </template>
          <p class="blind-text">
            巡检项由后端扫描「不该存在的订单状态组合」得出，返回<strong>计数 + 命中明细</strong>。
            <strong>徽标与告警只统计 `newTotal` / `newCount`</strong>，历史存量（基线化之前的记录）
            <strong>永不染红</strong>，仅展示。
          </p>
          <p class="blind-text">
            页面下方的「未执行的项 / 未知 key」属于<strong>平台侧数据问题</strong>（表结构变更后 SQL 未同步、
            key 拼错或改名 ⇒ 该项实际没被巡检），<strong>与商家经营数据无关</strong>，
            出现时请联系平台技术侧处理。
          </p>
          <p class="blind-text">
            ⚠️ 接口 fail-fast（不降级）：基线表读不到时直接报错，避免把存量当新增刷屏、
            或把新增当存量漏报。存在盲区时<strong>不得</strong>显示"体检通过"。
          </p>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <!-- 盲区 3：接口报错。⚠️ 对外用商家能懂的说法，技术原因收进折叠详情 -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="blind-alert">
      <template #title>本次巡检没有跑成功，结果不可用</template>
      <p class="blind-text">
        ⚠️ <strong>这是平台侧的问题，与你的店铺数据无关</strong> —— 不需要你做任何操作。
        页面显示"0 条异常"也不能当作"没有问题"。
      </p>
      <p class="blind-text">请<strong>联系平台</strong>处理；技术详情见上方「给技术同学的详情」。</p>
      <p class="blind-text tech-raw">原始错误：{{ loadError }}</p>
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
        <template #title>本次有 {{ data.skippedChecks.length }} 项检查没能完成，结果不完整</template>
        <p class="blind-text">
          ⚠️ <strong>平台侧问题，与你的店铺数据无关</strong>；这些项<strong>没有被检查</strong>，
          所以"没有异常"不代表这几项也没问题。请<strong>联系平台</strong>处理。
        </p>
        <p class="blind-text tech-raw">
          技术详情（表结构变更后 SQL 未同步）：<code>{{ skippedKeysText }}</code>
        </p>
      </el-alert>

      <!-- 盲区 2：unknownTypes 非空（key 拼错/已改名，没被巡检） -->
      <el-alert
        v-if="data && data.unknownTypes.length"
        type="warning"
        :closable="false"
        show-icon
        class="blind-alert"
      >
        <template #title>本次有 {{ data.unknownTypes.length }} 项检查项目无法识别，结果不完整</template>
        <p class="blind-text">
          ⚠️ <strong>平台侧配置问题，与你的店铺数据无关</strong>。请<strong>联系平台</strong>处理。
        </p>
        <p class="blind-text tech-raw">
          技术详情（key 不存在 / 已改名）：<code>{{ data.unknownTypes.join('、') }}</code>
        </p>
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
/* ⚠️ 2026-10-03：给商家看的「这是什么 / 为什么 / 你该做什么」说明卡 + 技术详情折叠区 */
.heading-sub { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.explain-card { margin-bottom: 16px; }
.explain-grid { display: flex; flex-direction: column; gap: 18px; }
.explain-q { margin: 0 0 8px; font-size: 15px; font-weight: 700; color: var(--el-text-color-primary); }
.explain-a { margin: 0; line-height: 1.8; color: var(--el-text-color-regular); }
.explain-ul { margin: 6px 0 6px; padding-left: 20px; line-height: 1.9; }
.tech-collapse { margin-top: 18px; border-top: 1px solid var(--el-border-color-lighter); }
.tech-title { color: var(--el-text-color-secondary); font-size: 13px; }
/* 技术原文（错误信息 / key 列表）用等宽小字弱化，避免抢走商家的注意力 */
.tech-raw { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; word-break: break-all; }
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
