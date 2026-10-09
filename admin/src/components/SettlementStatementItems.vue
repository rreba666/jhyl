<script setup lang="ts">
/**
 * 结算行级明细（**中控 · 行级展开**，只读）—— 2026-10-09 T1。
 *
 * 用它承载 `GET /api/admin/settlement/statements/{orderNo}/items` 的渲染，
 * 口径与商家端 `mini_shop/subpkg-merchant/settlement/statements.vue` 的展开区**完全对齐**：
 *
 * 1. **懒加载**：本组件只被 `el-table` 的 `type="expand"` 展开槽渲染 ⇒ 组件 `onMounted` 即
 *    "用户第一次展开这一行"；收起后组件卸载，**不会**对整页订单预取（订单列表动辄几十行，
 *    预取会把接口打爆 —— 中控这个端点还是按 `orderNo` 单查）。
 * 2. **按订单号缓存（模块级）**：已成功加载过的订单号再展开**不重复请求**；
 *    失败**不进缓存**（允许重试），但把失败文案按订单号记着，重展开时先给结论、点「重试」再请求。
 * 3. **只读**：组件里没有任何写操作（唯一按钮是失败的「重试」）。
 * 4. **作废行必须一眼可辨**：`reversedAt` 非空 ⇒ 整行灰化 + 金额删除线 + 「作废」标签 + 作废时间与原因。
 * 5. **不编数据**：契约里**没有商品名** ⇒ 只展示 `SKU {skuId}`；金额/比例缺失一律「—」，**不兜底成 0**；
 *    后端说"没有结算快照"（`code=1000`）就**原样把那句话讲出来**，不渲染成空表。
 *
 * ⛔ 不要把它改成"进页面就加载"：那会同时破坏上面第 1、2 条（契约 `settlement-statement-items` 有反向断言）。
 */
import { onMounted, ref } from 'vue'
import {
  getAdminStatementItems,
  isReversedStatementItem,
  type AdminStatementItemVO,
} from '@/api/settlement'

const props = defineProps<{
  /** 订单号（结算单的业务主键；直接取列表行上的值，不做拼接/猜测）。 */
  orderNo: string
}>()

/**
 * 已成功加载的行级明细：`orderNo → rows`（**模块级**，跨"展开/收起"存活）。
 * ⚠️ 只有**成功**的结果才进这里 ⇒ 天然的"首次展开才请求 + 之后走缓存"。
 */
const itemsByOrderNo = new Map<string, AdminStatementItemVO[]>()
/** 加载失败文案：`orderNo → 文案`（含 `1000 该订单没有结算快照`）。失败**不缓存结果**，只缓存这句话。 */
const errorByOrderNo = new Map<string, string>()

const loading = ref(false)
const rows = ref<AdminStatementItemVO[]>([])
const errorText = ref('')

/** 金额展示：缺失 ⇒ 「—」（⛔ 不兜底成 0，"抽成为 0"是一个具体结论）。 */
function amountText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(2) : '—'
}

/** 让利比例展示：缺失 ⇒ 「—」。 */
function rateText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num}%` : '—'
}

/**
 * 时间展示：后端给的是 ISO 串，转成 `YYYY-MM-DD HH:mm:ss`；**转不动就原样显示**
 * （宁可显示原始串，也不假装"没有时间"）。
 */
function timeText(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
}

/** 作废说明（时间 + 原因；原因可能为空）。 */
function reversedText(row: AdminStatementItemVO): string {
  const reason = String(row.reversedReason ?? '').trim()
  const time = timeText(row.reversedAt)
  return reason ? `作废时间：${time}；作废原因：${reason}` : `作废时间：${time}`
}

function isReversed(row: AdminStatementItemVO): boolean {
  return isReversedStatementItem(row)
}

/** 拉取（仅在"没有缓存"或用户点「重试」时调用）。 */
async function load(): Promise<void> {
  const cached = itemsByOrderNo.get(props.orderNo)
  if (cached) {
    rows.value = cached
    errorText.value = ''
    return
  }
  loading.value = true
  errorText.value = errorByOrderNo.get(props.orderNo) || ''
  try {
    const data = await getAdminStatementItems(props.orderNo)
    itemsByOrderNo.set(props.orderNo, data)
    errorByOrderNo.delete(props.orderNo)
    rows.value = data
    errorText.value = ''
  } catch (error) {
    // ⚠️ 后端"没有结算快照"是**正常业务状态**（订单未完成/未过释放期）：
    //    它的 message 已经说清了原因，直接用；本组件不再编一句更"好看"的话。
    const message = error instanceof Error ? error.message : '结算行级明细查询失败'
    errorByOrderNo.set(props.orderNo, message)
    rows.value = []
    errorText.value = message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

/** 重试（失败不进缓存 ⇒ 这里会真的重新请求）。 */
function retry(): void {
  void load()
}
</script>

<template>
  <div class="statement-items">
    <div v-if="loading" class="items-state">明细加载中…</div>
    <template v-else-if="errorText">
      <!-- 失败/无快照：把后端原话讲出来（不渲染成空表，也不假装"这单没有明细"） -->
      <div class="items-state items-error">{{ errorText }}</div>
      <el-button size="small" link type="primary" @click="retry">重试</el-button>
    </template>
    <template v-else-if="rows.length">
      <div
        v-for="row in rows"
        :key="String(row.orderItemId)"
        class="item-row"
        :class="{ 'is-reversed': isReversed(row) }"
      >
        <div class="item-head">
          <span class="item-sku">SKU {{ row.skuId === null || row.skuId === undefined ? '—' : row.skuId }}</span>
          <!-- 作废行必须显式标注（灰 + 删除线），否则运营会把它当有效抽成 -->
          <el-tag v-if="isReversed(row)" size="small" type="info">作废</el-tag>
        </div>
        <div class="item-line"><span class="item-label">让利比例</span><span class="item-value">{{ rateText(row.commissionRate) }}</span></div>
        <div class="item-line"><span class="item-label">商品金额（含分摊优惠）</span><span class="item-value">¥ {{ amountText(row.goodsAmount) }}</span></div>
        <div class="item-line"><span class="item-label">平台抽成</span><span class="item-value">-¥ {{ amountText(row.commissionAmount) }}</span></div>
        <div v-if="isReversed(row)" class="item-void-reason">{{ reversedText(row) }}</div>
      </div>
      <!-- 口径说明：运营一定会自己加，先把"为什么加起来对得上"讲清楚（与商家端同文案） -->
      <div class="items-note">· 行商品金额 = 订单级商品额按行分摊（整单优惠已按比例摊入）</div>
      <div class="items-note">· 各行抽成相加 = 订单级平台抽成（后端硬校验）</div>
    </template>
    <div v-else class="items-state">该订单暂无行级明细</div>
  </div>
</template>

<style scoped>
.statement-items { padding: 4px 8px 8px; }
.items-state { padding: 8px 0; color: var(--el-text-color-secondary); font-size: 13px; }
.items-error { color: var(--el-color-danger); }
.item-row { margin-top: 8px; padding: 10px 12px; border-radius: 6px; background: var(--el-fill-color-light); }
/* ⚠️ 作废行：灰 + 删除线（整单退款时整批置作废，不能把它当有效抽成） */
.item-row.is-reversed { opacity: .6; }
.item-row.is-reversed .item-value { text-decoration: line-through; }
.item-head { display: flex; align-items: center; justify-content: space-between; }
.item-sku { color: var(--el-text-color-regular); font-size: 13px; }
.item-line { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.item-label { color: var(--el-text-color-secondary); font-size: 13px; }
.item-value { color: var(--el-text-color-primary); font-size: 13px; }
.item-void-reason { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.items-note { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
</style>
