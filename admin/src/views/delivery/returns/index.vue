<script setup lang="ts">
/**
 * 退款返货台账（中控 · **只读**，2026-10-10 新增）。
 *
 * ## 为什么建这一页
 * 后端待办 `DELIVERY_RETURN_ACCEPT`（返货待验收，`level=DANGER`）下发的 `route` 是
 * **`/delivery/returns?returnStatus=RETURNED`**；而此前 `admin/src` 里
 * **0 处** `delivery/returns` ⇒ 铃铛点进去 = 路由不存在（待办形同虚设）。本页就是那个落点。
 *
 * 接口：`GET /api/admin/delivery/returns`
 * （operationId `PlatformDeliveryController_returns`，summary「退款返货台账（全平台/按门店，V14011）」）
 * —— `merchantId`（**不传 = 全平台**）/ `returnStatus`（**不传 = 未收口**）/ `page` / `pageSize`。
 * 契约 description 明写：本接口 `?returnStatus=RETURNED` 的条数 == 待办 `DELIVERY_RETURN_ACCEPT`。
 *
 * ## ⛔⛔ 只读：不要加"确认收货 / 人工放行"按钮
 * 契约里该 path **只有 `get`**，admin 侧**没有**验收写接口；唯一的写接口是商家侧
 * `POST /api/merchant/delivery/tasks/{taskId}/accept-return`（平台账号未绑商户，前端**不代调**）。
 * ⇒ 本页**不给任何行内动作**，也不放一个"灰着的、看起来将来会有"的按钮
 *   —— 只在页头/口径说明里**如实写明「人工放行待后端补 admin 侧写接口」**，
 *   并写明当前的唯一出路：**商家验收**，或**返货到店满 2 小时**由 `DeliveryReturnAcceptJob` 自动确认收货。
 *
 * ## ✅ 字段名：契约**有**明细（不是 `dividend-clawback` 那种空 schema）
 * `ResultPageResultDeliveryTaskEntity` → `{ total, list[], page, pageSize }`，
 * `list[]` = `DeliveryTaskEntity`（33 个字段，返货专有字段齐全）。
 * ⚠️ 但 2026-10-10 复核时 **dev `192.168.1.4:8080` 不可达** ⇒ **本期没有真实响应**，
 *    字段名**没有被真实数据验证过** ⇒ 仍保留两条降级：
 *    ① api 层「契约名优先 + 少量别名」读取；② **每行可展开看原始对象** + 页底「原始数据」整段。
 *    取不到就显示「—」；枚举不认识就显示**原值** + 标「未知」——**不猜、不归类、不给默认值**。
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getDeliveryReturns } from '@/api/deliveryReturns'
import { assignmentTypeLabel, taskStatusLabel } from '@/utils/deliveryStatus'
import { sanitizeBonusText } from '@/utils/textSafe'
import { useTodoStore } from '@/stores/todo'
import {
  DAMAGE_CLAIM_STATUS_RECORDED,
  DELIVERY_RETURNS_DEFAULT_PAGE_SIZE,
  RETURN_STATUS_VALUES,
  type DeliveryReturnRow,
  type ReturnStatus,
} from '@/types/deliveryReturns'

const route = useRoute()
const todoStore = useTodoStore()

/**
 * 返货状态中文（**逐条来自契约 description 的取值表**，不是我们自己起的名）：
 * `PENDING` 待骑手返货（默认 2 小时内）/ `RETURNED` 骑手已返货到店、**待商家验收**（2 小时内，超时自动确认）/
 * `ACCEPTED` 已验收通过（`acceptAuto=true` = 系统超时自动确认）/ `REJECTED_CLAIM` 商家拒绝收货、**已记录货损**。
 */
const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  PENDING: '待骑手返货',
  RETURNED: '已返货到店·待验收',
  ACCEPTED: '已验收通过',
  REJECTED_CLAIM: '商家拒收·已记录货损',
}

/**
 * 筛选下拉项。
 * ⚠️ **没有"全部状态"这一项**：契约里 `returnStatus` 只有那 4 个取值，**不传** = 后端默认（未收口 = `PENDING` + `RETURNED`）
 * ⇒ 想"一次看全"在契约里**不存在**这种查法，前端也不会拿空串去顶替（那是伪造一个后端没有的语义）。
 */
const RETURN_STATUS_OPTIONS: Array<{ value: ReturnStatus | ''; label: string }> = [
  { value: '', label: '未收口（不传 = 后端默认：返货中 + 待验收）' },
  ...RETURN_STATUS_VALUES.map((value) => ({ value, label: RETURN_STATUS_LABELS[value] })),
]

/** 返货配送费责任方（契约 description 给出的 4 个值；**只记录、不参与任何计费**）。 */
const RETURN_FEE_BEARER_LABELS: Record<string, string> = {
  MERCHANT: '商家原因',
  USER: '用户原因',
  RIDER: '骑手原因',
  UNKNOWN: '待判定',
}

/** 每页条数候选（契约只声明了 `default: 20`，**没有**声明上限 ⇒ 这里只是给几个常用值，不声称是上限）。 */
const PAGE_SIZE_OPTIONS = [20, 50, 100]

/** 返货状态筛选；`''` = **不传**（后端默认：未收口）。 */
const statusFilter = ref<ReturnStatus | ''>('')
/**
 * 门店/商户 ID 输入框原文（**空 = 不传 = 全平台**；绝不兜底成某个 id）。
 * ⚠️ **ID 空间待后端确认**：2026-10-10 探针显示后端按**门店 id** 过滤（见模板里的口径说明）
 * ⇒ 前端只原样透传 `?merchantId=`，**不做门店↔品牌换算、也不自动填充**。
 */
const merchantIdText = ref('')
const pageSize = ref(DELIVERY_RETURNS_DEFAULT_PAGE_SIZE)
const page = ref(1)
const rows = ref<DeliveryReturnRow[]>([])
/** 后端下发的总条数；**没给时 `null`**（不编 0）。 */
const total = ref<number | null>(null)
const loading = ref(false)
/** 查询失败文案（⚠️ 与"没有记录"是两件事，见 {@link load}）。 */
const loadError = ref('')
/** 深链里 `returnStatus` 不认识时的提示（不认识就**不猜**，退回默认并说明）。 */
const queryWarning = ref('')

/** 后端是否下发了真实 `total`（决定"下一页"用哪种判据，并在页面上如实标注）。 */
const totalKnown = computed(() => total.value !== null)

/**
 * 本页是否**可能**还有下一页。
 * - `total` 有值（契约如此，但本期未验证）⇒ 按 `page * pageSize < total` 判定；
 * - `total` 缺失 ⇒ 退回"本页是否满页"的推断（**需后端确认**，页面上已写明这是推断）。
 */
const mayHaveNext = computed(() => {
  if (total.value !== null) return page.value * pageSize.value < total.value
  return rows.value.length >= pageSize.value
})

/** 是否有行的关键字段（任务 ID）没识别出来（有就提示以展开行 / 原始数据为准）。 */
const hasUnrecognizedRow = computed(() => rows.value.some((row) => !row.idRecognized))

/** 后端文本统一过一遍术语归一化（本项目口径：展示层不出现旧业务词，见 CLAUDE.md §七）。 */
function text(value: string | null | undefined): string {
  const cleaned = sanitizeBonusText(value ?? '')
  return cleaned === '' ? '—' : cleaned
}

/** 返货状态标签：只认契约登记的 4 个值，其它值**原样显示**（不归类）。 */
function returnStatusLabel(row: DeliveryReturnRow): string {
  const key = row.returnStatus
  if (key === null) return '未下发'
  return (RETURN_STATUS_LABELS as Record<string, string | undefined>)[key] ?? `未知状态（${key}）`
}

/** 返货状态标签配色：`RETURNED` 是**此刻卡在商家**的那一档（后端待办即按它计数）⇒ 红色。 */
function returnStatusTagType(row: DeliveryReturnRow): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  if (row.returnStatus === 'RETURNED') return 'danger'
  if (row.returnStatus === 'REJECTED_CLAIM') return 'warning'
  if (row.returnStatus === 'ACCEPTED') return 'success'
  if (row.returnStatus === 'PENDING') return 'info'
  return 'info'
}

/** 是否系统超时自动验收：**只做布尔原义呈现**（`null` = 后端没给/值不认识 ⇒ 「—」），不据此推断验收经过。 */
function acceptAutoLabel(row: DeliveryReturnRow): string {
  if (row.acceptAuto === true) return '是（系统自动）'
  if (row.acceptAuto === false) return '否'
  return '—'
}

/** 货损判定状态：契约只登记了 `RECORDED`（已记录货损），其它值原样回显。 */
function damageClaimLabel(row: DeliveryReturnRow): string {
  const key = row.damageClaimStatus
  if (key === null) return '—'
  if (key === DAMAGE_CLAIM_STATUS_RECORDED) return '已记录货损'
  return key
}

/** 返货运费责任方：只认契约给的 4 个值，其它值原样回显。 */
function feeBearerLabel(row: DeliveryReturnRow): string {
  const key = row.returnFeeBearer
  if (key === null) return '—'
  return RETURN_FEE_BEARER_LABELS[key] ?? key
}

/** 某行的原始 JSON（字段名与预期不符时的唯一真相）。 */
function rowJson(row: DeliveryReturnRow): string {
  return JSON.stringify(row.raw, null, 2)
}

/** 整段原始数据（本页 `list` 的原始对象合集，原样、不加工）。 */
const rawJson = computed(() => JSON.stringify(rows.value.map((row) => row.raw), null, 2))

/**
 * 把 `merchantId` 输入框解析成数字。
 * 空 ⇒ `null`（= 不传 = 全平台）；非法 ⇒ `undefined`（调用方据此**拦下查询并提示**，不静默丢掉）。
 */
function parseMerchantId(): number | null | undefined {
  const raw = merchantIdText.value.trim()
  if (raw === '') return null
  if (!/^\d+$/.test(raw)) return undefined
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * 套用 URL 深链（待办 `DELIVERY_RETURN_ACCEPT` 的 route 是 `/delivery/returns?returnStatus=RETURNED`）。
 * - `returnStatus` **只认契约登记的 4 个值**：命中即选中；
 * - 不认识的值 ⇒ **保持默认（未收口）并给出可见提示**（不猜它的含义，也不悄悄查全部）；
 * - 空 / 缺省 ⇒ 回到"未收口"（后端默认语义）；
 * - `merchantId` 只认正整数（非法/空 ⇒ 不传 = 全平台，并在输入框里保持原样以便核对）。
 */
function applyQueryFilters(): void {
  const rawStatus = route.query.returnStatus
  const statusText = String(Array.isArray(rawStatus) ? rawStatus[0] : rawStatus ?? '').trim()
  if (statusText === '') {
    statusFilter.value = ''
    queryWarning.value = ''
  } else if ((RETURN_STATUS_VALUES as readonly string[]).includes(statusText)) {
    statusFilter.value = statusText as ReturnStatus
    queryWarning.value = ''
  } else {
    statusFilter.value = ''
    queryWarning.value =
      `链接里的 returnStatus=${statusText} 不在契约登记的四档里（PENDING / RETURNED / ACCEPTED / REJECTED_CLAIM），` +
      '已按「未收口」查询；不认识的值不猜测其含义，请在展开行 / 原始数据里核对后端真实取值。'
  }
  const rawMerchant = route.query.merchantId
  const merchantText = String(Array.isArray(rawMerchant) ? rawMerchant[0] : rawMerchant ?? '').trim()
  merchantIdText.value = /^\d+$/.test(merchantText) ? merchantText : ''
}

/**
 * 加载当前页。
 *
 * ⚠️ 失败**不渲染成"没有返货记录"**（那是两个相反的结论）：置 `loadError` 并清空列表。
 * ⚠️ 翻到空页（`total` 缺失时我们并不知道自己是不是最后一页）⇒ 自动退回上一页并提示。
 */
async function load(): Promise<void> {
  const merchantId = parseMerchantId()
  if (merchantId === undefined) {
    loadError.value = ''
    rows.value = []
    total.value = null
    ElMessage.warning('门店/商户 ID 只能是正整数（留空 = 不传 = 全平台）')
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const result = await getDeliveryReturns({
      // ⚠️ 空 = **不传**（后端语义：merchantId 不传 = 全平台；returnStatus 不传 = 未收口）
      merchantId: merchantId === null ? undefined : merchantId,
      returnStatus: statusFilter.value === '' ? undefined : statusFilter.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    if (result.rows.length === 0 && page.value > 1) {
      ElMessage.info('没有更多记录了')
      page.value -= 1
      loading.value = false
      await load()
      return
    }
    rows.value = result.rows
    total.value = result.total
  } catch (error) {
    rows.value = []
    total.value = null
    loadError.value = error instanceof Error ? error.message : '退款返货台账查询失败'
  } finally {
    loading.value = false
  }
}

/** 查询（回到第 1 页）。 */
function search(): void {
  page.value = 1
  void load()
}

/** 重置筛选（回默认：未收口 + 全平台 + 第 1 页）。 */
function reset(): void {
  statusFilter.value = ''
  merchantIdText.value = ''
  queryWarning.value = ''
  search()
}

/** 翻页。 */
function goPrev(): void {
  if (page.value <= 1) return
  page.value -= 1
  void load()
}

/** ⚠️ 仅在"可能还有下一页"时才允许（判据见 {@link mayHaveNext}）。 */
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

/**
 * 待办点击（铃铛）：重新套用 URL 筛选并刷新。
 * - **重复点同一条待办**（路由完全一致 ⇒ vue-router 不重新导航）由 `clickTick` 兜住（见 stores/todo.ts）；
 * - **同页换筛选**（`/delivery/returns?returnStatus=PENDING` → `?returnStatus=RETURNED`，路径不变）由 `route.query` 监听兜住
 *   —— 组件实例会复用，`onMounted` 不会重跑，所以这两个监听缺一不可。
 */
function applyTodoAndReload(): void {
  applyQueryFilters()
  search()
}

watch(() => todoStore.clickTick, () => {
  applyTodoAndReload()
})

watch(() => route.query, () => {
  applyTodoAndReload()
})

onMounted(() => {
  applyQueryFilters()
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>退款返货台账<el-tag type="info" size="small" class="readonly-tag">只读</el-tag></h1>
        <p>
          订单退款后「钱退了、货要回店」的收尾台账：谁在返货、货到店没有、商家验收了没有、有没有货损。
          与商家端「返货列表」是<strong>同一份数据、同一口径</strong>，差别只在数据范围：
          本页 <code>merchantId</code> <strong>不传 = 全平台</strong>（平台岗跨店排查用）。
          右侧铃铛待办 <code>DELIVERY_RETURN_ACCEPT</code>（返货待验收）的深链就是本页的
          <code>?returnStatus=RETURNED</code>，两处条数应一致。
        </p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert type="warning" :closable="false" show-icon class="block">
      <template #title>本页只读：中控没有「确认收货 / 人工放行」入口</template>
      <p class="hint">
        契约里 <code>GET /api/admin/delivery/returns</code> <strong>只有 GET</strong>，
        admin 侧<strong>没有</strong>验收写接口；唯一的验收接口是商家侧
        <code>POST /api/merchant/delivery/tasks/{taskId}/accept-return</code>
        （平台账号未绑商户，前端<strong>不代为调用</strong>）。
        ⇒ <strong>人工放行（平台手动确认收货）待后端补 admin 侧写接口</strong>，本页因此<strong>不提供任何行内动作</strong>。
      </p>
      <p class="hint">
        当前 <code>RETURNED</code>（已返货到店·待验收）只有两条出路：
        ① <strong>商家验收</strong>（商家端 / 中控「配送-返货」确认收货 —— 后者<strong>接口尚未提供</strong>）；
        ② 返货到店满 <strong>2 小时</strong>由 <code>DeliveryReturnAcceptJob</code> <strong>自动确认收货</strong>
        （此时 <code>acceptAuto</code> 为真）。同城退货的退款闸门要等验收通过（或自动验收）后才放行。
      </p>
      <p class="hint">
        另两条与本项目口径有关的边界：返货<strong>不自动计费</strong>
        （<code>returnFeeBearer</code> 只记录责任方，没有骑手返货运价、不产生任何扣款）；
        货损<strong>不自动赔付</strong>（只落 <code>damageClaimStatus=RECORDED</code>，赔付须人工判定后走线下/售后流程）。
      </p>
    </el-alert>

    <el-alert type="info" :closable="false" show-icon class="block">
      <template #title>字段名来源与降级说明</template>
      <p class="hint">
        本接口的响应 schema <strong>有字段明细</strong>（<code>PageResultDeliveryTaskEntity</code> →
        <code>DeliveryTaskEntity</code>，含 <code>returnStatus / returnedAt / acceptDeadline / acceptResult /
        acceptAuto / acceptRemark / acceptTime / damageClaimStatus / returnFeeBearer</code> 等）。
        但 <strong>2026-10-10 复核时 dev 后端 <code>192.168.1.4:8080</code> 不可达</strong>
        （TCP 8080 连不上、<code>/v3/api-docs</code> 超时）⇒ <strong>本期没有拿到真实响应，字段名未经真实数据验证</strong>。
      </p>
      <p class="hint">
        因此：api 层按「契约名优先 + 少量别名」读取；<strong>每行都可展开</strong>看到后端真正下发的原始对象，
        页底另有整段「原始数据」。任何列显示「—」或「未知」时，<strong>以展开行 / 原始数据为准</strong>与后端核对，
        不要照文档猜（本项目已因"照文档猜字段名"栽过一次 P0）。
      </p>
    </el-alert>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="返货状态">
          <el-select v-model="statusFilter" style="width: 300px" @change="search">
            <el-option
              v-for="option in RETURN_STATUS_OPTIONS"
              :key="option.value || 'default'"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="门店/商户 ID">
          <el-input
            v-model="merchantIdText"
            style="width: 160px"
            placeholder="留空 = 全平台"
            @keyup.enter="search"
          />
        </el-form-item>
        <el-form-item label="每页">
          <el-select v-model="pageSize" style="width: 110px" @change="changeSize">
            <el-option v-for="option in PAGE_SIZE_OPTIONS" :key="option" :label="`${option} 条`" :value="option" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
      <p class="hint">
        「未收口」= 不传 <code>returnStatus</code>（后端默认只返回 <code>PENDING</code> + <code>RETURNED</code>，且
        <code>RETURNED</code> 优先）。契约里<strong>没有"全部状态"这个取值</strong>，故本页也不提供。
        门店/商户 ID 留空 = 不传 = 全平台；商户管理员（ADMIN）的数据范围由后端按绑定商户强制过滤
        （<strong>前端不代传 merchantId、也不自行判定这个 ID 属于哪个空间</strong>）。
      </p>
      <p class="hint">
        ⚠️ <strong><code>merchantId</code> 的 ID 空间待后端确认</strong>（前端<strong>不下定论</strong>）：
        2026-10-10 探针显示本参数实际按<strong>门店 id</strong> 过滤 —— dev 上唯一一条记录的
        <code>merchantId</code> 是 <code>90108</code>，该值出现在门店列表 <code>/api/admin/shop/all</code> 里、
        <strong>不在</strong>平台 11 个品牌 ID 之中，而门店 <code>90108</code> 自身的 <code>merchantId</code> 是
        <code>913</code>；传 <code>?merchantId=90108</code> 命中该行，传 <code>?merchantId=913</code> 命中 0 行。
        ⇒ 本页只把输入值<strong>原样</strong>作为 <code>?merchantId=</code> 传下去，
        <strong>不自动填充、不做门店↔品牌换算</strong>；以契约为准，等后端确认后再改文案与校验。
      </p>
    </el-card>

    <el-alert v-if="queryWarning" type="warning" :closable="false" show-icon class="block">
      <template #title>深链参数未识别</template>
      <p class="hint">{{ queryWarning }}</p>
    </el-alert>

    <!-- 接口报错：不渲染成"没有返货记录" -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="block">
      <template #title>查询失败，本次结果不可用</template>
      <p class="hint">{{ loadError }}</p>
      <p class="hint">
        这不等于「没有返货记录」—— 请确认后端已上线
        <code>GET /api/admin/delivery/returns</code>，且当前账号对该接口有权限
        （超管 / 客服 / 商户管理员；商户管理员的数据范围由后端过滤）。接口尚未上线时后端会返回 404/405。
      </p>
    </el-alert>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <span>
          第 <strong>{{ page }}</strong> 页 · 本页 <strong>{{ rows.length }}</strong> 条
          <template v-if="totalKnown">
            · 共 <strong>{{ total }}</strong> 条<small class="sub inline">（后端下发 total）</small>
          </template>
          <span v-else class="hint inline">（后端未下发总条数，故不显示"共 N 条"，翻页按"本页是否满页"判断 —— 需后端确认）</span>
        </span>
        <div class="toolbar-actions">
          <el-button size="small" :disabled="page <= 1 || loading" @click="goPrev">上一页</el-button>
          <el-button size="small" :disabled="!mayHaveNext || loading" @click="goNext">下一页</el-button>
        </div>
      </div>

      <p v-if="hasUnrecognizedRow" class="hint danger-text">
        有记录的<strong>任务 ID 没识别出来</strong> —— 请展开该行与页底「原始数据」核对后端真实字段名
        （不要在页面上手填，也不要按文档猜）。
      </p>

      <el-table v-loading="loading" :data="rows" border stripe>
        <!-- 原始行：字段名一旦与预期不符，这是唯一真相（不做任何加工） -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <pre class="raw-json">{{ rowJson(row) }}</pre>
          </template>
        </el-table-column>
        <el-table-column label="任务" min-width="170">
          <template #default="{ row }">
            <div>{{ text(row.taskNo) }}</div>
            <small class="sub">任务 ID：{{ row.id ?? '—' }}</small>
          </template>
        </el-table-column>
        <el-table-column label="订单号" min-width="180">
          <template #default="{ row }">{{ text(row.orderNo) }}</template>
        </el-table-column>
        <el-table-column label="返货状态" width="160">
          <template #default="{ row }">
            <el-tag :type="returnStatusTagType(row)">{{ returnStatusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="返货到店时刻" min-width="170">
          <template #default="{ row }">
            <div>{{ text(row.returnedAt) }}</div>
            <small class="sub">返货时限：{{ text(row.returnDeadline) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="验收" min-width="180">
          <template #default="{ row }">
            <div>结果：{{ text(row.acceptResult) }}</div>
            <small class="sub">
              时刻：{{ text(row.acceptTime) }} · 超时自动验收：{{ acceptAutoLabel(row) }}
            </small>
          </template>
        </el-table-column>
        <el-table-column label="验收时限" min-width="160">
          <template #default="{ row }">{{ text(row.acceptDeadline) }}</template>
        </el-table-column>
        <el-table-column label="验收备注" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ text(row.acceptRemark) }}</template>
        </el-table-column>
        <el-table-column label="货损 / 运费责任" min-width="170">
          <template #default="{ row }">
            <div>货损：{{ damageClaimLabel(row) }}</div>
            <small class="sub">返货运费责任方：{{ feeBearerLabel(row) }}（只记录、不计费）</small>
          </template>
        </el-table-column>
        <el-table-column label="任务状态 / 指派" min-width="160">
          <template #default="{ row }">
            <div>{{ taskStatusLabel(row.status) }}</div>
            <small class="sub">{{ assignmentTypeLabel(row.assignmentType) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="门店/商户 · 骑手" min-width="150">
          <template #default="{ row }">
            <div>门店/商户 ID：{{ row.merchantId ?? '—' }}</div>
            <small class="sub">骑手 ID：{{ row.deliveryPersonId ?? '—' }}</small>
          </template>
        </el-table-column>
        <el-table-column label="收货人" min-width="150">
          <template #default="{ row }">
            <div>{{ text(row.receiverName) }}</div>
            <small class="sub">{{ text(row.receiverPhone) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="收货地址" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ text(row.deliveryAddress) }}</template>
        </el-table-column>
        <el-table-column label="返货要求时刻" min-width="170">
          <template #default="{ row }">{{ text(row.returnRequiredAt) }}</template>
        </el-table-column>
        <el-table-column label="任务创建 / 更新" min-width="180">
          <template #default="{ row }">
            <div>{{ text(row.createTime) }}</div>
            <small class="sub">{{ text(row.updateTime) }}</small>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="loadError ? '本次结果不可用（见上方错误提示）' : '暂无返货记录'" />
        </template>
      </el-table>
    </el-card>

    <!-- 原始数据：字段名与预期不符时的唯一真相（不做任何加工） -->
    <el-card shadow="never" class="block">
      <el-collapse>
        <el-collapse-item name="raw" title="原始数据（GET /api/admin/delivery/returns 本页原样返回）">
          <p class="hint">
            本接口的响应字段虽然在契约里有明细，但<strong>本期未拿到真实响应</strong>（dev 不可达）
            ⇒ 前端按「契约名优先 + 别名」读取，并把原始对象原样展示在这里。
            若某列显示「—」或「未知」，请以本区为准与后端核对字段名（不要在页面上手填）。
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
.readonly-tag { margin-left: 8px; vertical-align: middle; }
.hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.hint.inline { margin: 0; }
.danger-text { color: var(--el-color-danger); }
.sub { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.sub.inline { display: inline; }
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
