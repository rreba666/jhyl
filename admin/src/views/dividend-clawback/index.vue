<script setup lang="ts">
/**
 * 红包追回失败（中控运维工作台，2026-10-09 新增）。
 *
 * 依据：`docs/26/10.09/前端对接说明-入驻申请让利比例与商家自改-2026-10-09.md` §五、
 *       `docs/26/10.09/前端总对接文档-2026-10-09.md` §五 / §八；
 *       接口权威：`api_doc.json` 的 `/api/admin/dividend-clawback/**`。
 *
 * ## 这一页解决什么
 * 退款链路要**把已发出去的红包追回**（作废）；追回失败时会落一张失败留痕表
 * （`dividend_clawback_failure`），中控待办 `DIVIDEND_CLAWBACK_MISSING`（级别 DANGER）计的就是
 * 它的**未处理条数**。这一页是那张表的运维工作台：看清失败原因 → 人工核实 → 标记已处理（写处理人/时间/备注）。
 *
 * ## 两条接口
 * | 方法 | 路径 | 说明 |
 * |---|---|---|
 * | GET | `/api/admin/dividend-clawback/list` | `status`（0 未处理 / 1 已处理 / **不传 = 全部**）、`page`、`size`（≤ 100） |
 * | POST | `/api/admin/dividend-clawback/{id}/handled` | `remark` 可选（query）；**仅 `status=0` 可改**，重复调用报参数错误 |
 *
 * ## ⚠️⚠️ 三条"不猜"的口径（本项目硬原则：不伪造数据）
 * 1. **字段名未经验证**：`list` 的出参是 `ResultListMapStringObject`（`data: array<object>`，
 *    契约里**没有字段明细**）；2026-10-09 用 dev 超管账号实测该接口返回 **`data: []`（空数组）**
 *    ⇒ 文档给的 9 个字段名**一次都没被真实行验证过**。故：多别名读取 + **原始行原样可查**
 *    （每行可展开看后端真正下发了什么，页底另有整段「原始数据」），识别不出 `id` 的行**禁止处理**。
 * 2. **没有 `total`**：`data` 就是裸数组 ⇒ 前端**算不出**总条数/总页数。
 *    翻页只能按"本页条数是否 == size"判断（见 {@link mayHaveNext}），**已标注需后端确认**。
 * 3. **「重复调用」的错误码未知**（`api_doc.json` 未登记）⇒ **不按 code 分支**：
 *    原样显示后端 `message` 并**重新拉取列表**核对真实状态，而不是自己推断"是不是已处理"。
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DIVIDEND_CLAWBACK_MAX_SIZE,
  getDividendClawbackList,
  markDividendClawbackHandled,
} from '@/api/dividendClawback'
import { useTodoStore } from '@/stores/todo'
import type { DividendClawbackRow, DividendClawbackStatus } from '@/types/dividendClawback'

const route = useRoute()
const todoStore = useTodoStore()

/** 每页条数（上限取自后端约定：`size` 最大 100）。 */
const PAGE_SIZES = [20, 50, DIVIDEND_CLAWBACK_MAX_SIZE]

/** 状态筛选：0 未处理（**默认**，与后端 `status` 默认值一致）/ 1 已处理 / `''` 全部。 */
const statusFilter = ref<DividendClawbackStatus | ''>(0)
const size = ref(20)
const page = ref(1)
const rows = ref<DividendClawbackRow[]>([])
const loading = ref(false)
/** 查询失败文案（⚠️ 与"没有记录"是两件事，见 {@link load}）。 */
const loadError = ref('')
/** 正在提交处理的行 id（禁用按钮，防连点）。 */
const actingId = ref<number | null>(null)

/**
 * 本页是否**可能**还有下一页。
 *
 * ⚠️ 后端**没有下发 total** ⇒ 唯一可用的信号是"本页返回条数是否等于 `size`"：
 * `== size` ⇒ 可能还有（但也有可能刚好满页）⇒ 允许翻；`< size` ⇒ 一定是末页。
 * ⚠️ 这是**推断**，不是后端事实：翻到空页时 {@link load} 会自动退回上一页并如实说明。
 * **需后端确认**：请后端补 `total`（或改成 `PageResult`），否则永远只能这样猜。
 */
const mayHaveNext = computed(() => rows.value.length >= size.value)

/** 是否有行的关键字段没识别出来（有就提示：以展开行 / 原始数据为准核对字段名）。 */
const hasUnrecognizedRow = computed(
  () => rows.value.some((row) => !row.idRecognized || row.status === null),
)

/** 状态文案：只认后端枚举 0/1；其它值（含未下发）显示原值，**不做归类**（归类 = 伪造结论）。 */
function statusLabel(row: DividendClawbackRow): string {
  if (row.status === 0) return '未处理'
  if (row.status === 1) return '已处理'
  return row.status === null ? '状态未下发' : `未知状态（${row.status}）`
}

/** 状态标签色。 */
function statusTagType(row: DividendClawbackRow): 'warning' | 'success' | 'info' {
  if (row.status === 0) return 'warning'
  if (row.status === 1) return 'success'
  return 'info'
}

/**
 * 该行是否**可以**标记已处理。
 * fail-closed：既要识别出 `id`（否则无从下手，猜一个 id 可能改到别的记录），
 * 又要后端明确说它是 `status=0`（`status=1` 由后端条件更新拒绝 ⇒ 重复调用会报参数错误）。
 */
function canHandle(row: DividendClawbackRow): boolean {
  return row.idRecognized && row.status === 0
}

/** 某行的原始 JSON（字段名与预期不符时的唯一真相）。 */
function rowJson(row: DividendClawbackRow): string {
  return JSON.stringify(row.raw, null, 2)
}

/** 整段原始数据（`list` 的 `raw` 合集，原样、不加工）。 */
const rawJson = computed(() => JSON.stringify(rows.value.map((row) => row.raw), null, 2))

/**
 * 深链 `?status=`：右侧铃铛的 `DIVIDEND_CLAWBACK_MISSING` 兜底深链是
 * `/dividend-clawback?status=0`（未处理）。识别不了就**保持当前选择**（默认未处理），不改写。
 */
function applyQueryStatus(): void {
  const raw = route.query.status
  const text = String(Array.isArray(raw) ? raw[0] : raw ?? '')
  if (text === '0') statusFilter.value = 0
  else if (text === '1') statusFilter.value = 1
  else if (text === 'all') statusFilter.value = ''
}

/**
 * 加载当前页。
 *
 * ⚠️ 失败**不渲染成"没有失败记录"**（那是两个相反的结论）：置 `loadError` 并清空列表。
 * ⚠️ 翻到空页（后端无 total，`size` 满页时我们并不知道自己是不是最后一页）⇒
 *    自动退回上一页并提示「没有更多记录」，避免停在一个"空白页"上让人以为数据丢了。
 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getDividendClawbackList({
      // ⚠️ 不传 = 全部（后端语义）：只在"全部"时才省略该参数，绝不用 0 顶替
      status: statusFilter.value === '' ? undefined : statusFilter.value,
      page: page.value,
      size: size.value,
    })
    if (result.length === 0 && page.value > 1) {
      ElMessage.info('没有更多记录了（后端未下发总条数，末页只能按返回条数判断）')
      page.value -= 1
      loadError.value = ''
      loading.value = false
      await load()
      return
    }
    rows.value = result
  } catch (error) {
    rows.value = []
    loadError.value = error instanceof Error ? error.message : '红包追回失败记录查询失败'
  } finally {
    loading.value = false
  }
}

/** 查询（回到第 1 页）。 */
function search(): void {
  page.value = 1
  void load()
}

/** 翻页。 */
function goPrev(): void {
  if (page.value <= 1) return
  page.value -= 1
  void load()
}

/** ⚠️ 仅在"本页满页"时才允许翻下一页（后端无 total，见 {@link mayHaveNext}）。 */
function goNext(): void {
  if (!mayHaveNext.value) return
  page.value += 1
  void load()
}

/** 改每页条数（回第 1 页）。 */
function changeSize(): void {
  page.value = 1
  void load()
}

/** 待办点击（铃铛）：重新套用 URL 筛选并刷新（与 orders / withdraw 等页一致）。 */
function applyTodoAndReload(): void {
  applyQueryStatus()
  search()
}

/**
 * 标记已处理。
 * - 备注在接口里**可选** ⇒ 允许留空，且**不替用户编造**默认备注；
 * - 失败一律原样提示后端 `message` + **重新拉取列表**（重复调用会报参数错误，
 *   但**具体 code 未知**，故不按 code 分支，也不据此推断"已经处理过了"）。
 */
async function markHandled(row: DividendClawbackRow): Promise<void> {
  if (!canHandle(row) || row.id === null) return
  let remark = ''
  try {
    const result = await ElMessageBox.prompt(
      `确认把这条追回失败记录标记为「已处理」？\n记录 ID：${row.id}${row.orderNo ? `，订单号：${row.orderNo}` : ''}\n` +
        '后端会把处理人、处理时间与备注一起留痕。仅「未处理」的记录可改，重复提交会被拒绝。',
      '标记已处理',
      {
        inputPlaceholder: '处理备注（可留空）',
        // ⚠️ 备注是可选参数 ⇒ 这里允许留空（不编造一句"系统处理"之类的默认备注）
        inputValidator: () => true,
        type: 'warning',
        confirmButtonText: '确认标记',
        cancelButtonText: '取消',
      },
    )
    remark = String(result.value ?? '').trim()
  } catch {
    return
  }
  actingId.value = row.id
  try {
    await markDividendClawbackHandled(row.id, remark)
    ElMessage.success('已标记为已处理')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '标记已处理失败')
    // 重新拉取：让界面回到**后端真实状态**（不据错误码推断）
    await load()
  } finally {
    actingId.value = null
  }
}

watch(() => todoStore.clickTick, () => {
  applyTodoAndReload()
})

onMounted(() => {
  applyQueryStatus()
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>红包追回失败</h1>
        <p>
          退款链路要把已发出的红包追回作废，<strong>追回失败</strong>时会落一张留痕表；本页就是那张表的运维工作台：
          看清失败原因 → 人工核实 → 标记已处理（写入处理人 / 时间 / 备注）。
          仅<strong>平台管理员</strong>与<strong>财务</strong>可见（其它角色后端返回 <code>1004</code>）。
        </p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert type="info" :closable="false" show-icon class="block">
      <template #title>数据来源与口径</template>
      <p class="hint">
        数据来源：退款链路追回红包失败时落库的留痕（后端 <code>dividend_clawback_failure</code>）；
        右侧铃铛待办 <code>DIVIDEND_CLAWBACK_MISSING</code> 计的正是它的<strong>未处理条数</strong>。
        「标记已处理」只会把这条留痕置为已处理并留痕，<strong>不会</strong>重试追回、也<strong>不会</strong>改订单或资金。
      </p>
      <p class="hint">
        ⚠️ 本接口出参是 <code>Map</code>（契约里 <strong>没有字段明细</strong>），
        而 dev 实测该接口当前返回的是<strong>空数组</strong> ⇒ 文档给的字段名<strong>尚未被真实数据验证</strong>。
        每行都可<strong>展开</strong>看到后端真正下发的原始字段；字段名与下表不符时，以<strong>展开行 / 页底「原始数据」</strong>为准，
        不要照文档猜（本项目已因"照文档猜字段名"踩过事故）。
      </p>
      <p class="hint">
        ⚠️ 列表响应<strong>没有 <code>total</code></strong>（<code>data</code> 就是裸数组）⇒
        无法计算总条数与总页数：「下一页」只在<strong>本页满页</strong>时可点，翻到空页会自动退回上一页。
        这里是<strong>推断</strong>，<strong>需后端确认</strong>（建议后端补 <code>total</code>）。
      </p>
    </el-alert>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="状态">
          <el-select v-model="statusFilter" style="width: 150px" @change="search">
            <el-option label="未处理" :value="0" />
            <el-option label="已处理" :value="1" />
            <el-option label="全部" value="" />
          </el-select>
        </el-form-item>
        <el-form-item label="每页">
          <el-select v-model="size" style="width: 130px" @change="changeSize">
            <el-option v-for="option in PAGE_SIZES" :key="option" :label="`${option} 条`" :value="option" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 接口报错：不渲染成"没有失败记录" -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="block">
      <template #title>查询失败，本次结果不可用</template>
      <p class="hint">{{ loadError }}</p>
      <p class="hint">
        这不等于「没有追回失败记录」—— 请确认后端版本是否已包含
        <code>GET /api/admin/dividend-clawback/list</code>，以及当前账号是否为超管 / 财务。
      </p>
    </el-alert>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <span>
          第 <strong>{{ page }}</strong> 页 · 本页 <strong>{{ rows.length }}</strong> 条
          <span class="hint inline">（后端未下发总条数，故不显示"共 N 条"）</span>
        </span>
        <div class="toolbar-actions">
          <el-button size="small" :disabled="page <= 1 || loading" @click="goPrev">上一页</el-button>
          <el-button size="small" :disabled="!mayHaveNext || loading" @click="goNext">下一页</el-button>
        </div>
      </div>

      <p v-if="hasUnrecognizedRow" class="hint danger-text">
        有记录的<strong>关键字段没识别出来</strong>（记录 ID / 状态）—— 这类行<strong>不提供</strong>「标记已处理」
        入口，请展开该行与页底「原始数据」核对后端真实字段名（不要在页面上手填）。
      </p>

      <el-table v-loading="loading" :data="rows" border stripe>
        <!-- 原始行：字段名一旦与预期不符，这是唯一真相（不做任何加工） -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <pre class="raw-json">{{ rowJson(row) }}</pre>
          </template>
        </el-table-column>
        <el-table-column label="记录 ID" width="130">
          <template #default="{ row }">
            <template v-if="row.idRecognized">{{ row.id }}</template>
            <el-tag v-else type="danger" size="small">未识别出 ID</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="订单" min-width="200">
          <template #default="{ row }">
            <div>{{ row.orderNo || '—' }}</div>
            <small class="sub">订单 ID：{{ row.orderId ?? '—' }}</small>
          </template>
        </el-table-column>
        <el-table-column label="追回失败原因" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ row.error || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row)">{{ statusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理人" min-width="140">
          <template #default="{ row }">{{ row.handleBy || '—' }}</template>
        </el-table-column>
        <el-table-column label="处理时间" min-width="170">
          <template #default="{ row }">{{ row.handleTime || '—' }}</template>
        </el-table-column>
        <el-table-column label="处理备注" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column label="产生时间" min-width="170">
          <template #default="{ row }">{{ row.createTime || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canHandle(row)"
              size="small"
              type="primary"
              :loading="actingId === row.id"
              @click="markHandled(row)"
            >
              标记已处理
            </el-button>
            <span v-else-if="row.status === 1" class="cell-muted">已处理</span>
            <span v-else class="cell-muted">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="loadError ? '本次结果不可用（见上方错误提示）' : '暂无红包追回失败记录'" />
        </template>
      </el-table>
    </el-card>

    <!-- 原始数据：字段名与预期不符时的唯一真相（不做任何加工） -->
    <el-card shadow="never" class="block">
      <el-collapse>
        <el-collapse-item name="raw" title="原始数据（GET /api/admin/dividend-clawback/list 本页原样返回）">
          <p class="hint">
            本接口出参是 <code>Map&lt;String,Object&gt;</code>（api_doc 里 <strong>schema 为空</strong>），
            字段名没有契约 ⇒ 前端按多别名读取，并把原始对象原样展示在这里。
            若某列显示「—」或「未识别出 ID」，请以本区为准与后端核对字段名（不要在页面上手填）。
          </p>
          <pre class="raw-json">{{ rawJson }}</pre>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; }
.filter-card { margin-bottom: 16px; }
.hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.hint.inline { margin: 0; }
.danger-text { color: var(--el-color-danger); }
.sub { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.cell-muted { color: var(--el-text-color-secondary); }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.toolbar-actions { display: flex; gap: 8px; }
.raw-json {
  max-height: 320px;
  margin: 0;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
}
</style>
