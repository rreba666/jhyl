<script setup lang="ts">
/**
 * 物流签收兜底（P5，2026-10-03 新增）· ⚠️ **仅超管可见**
 *
 * 契约：`docs/26/10.2/前端对接-P5物流签收兜底-2026-10-03.md`
 * - `GET /api/admin/logistics/sign-pending?page=&pageSize=&fallbackDays=` 待签收清单
 * - `GET /api/admin/logistics/sign-pending/count` 待办角标
 * - `PUT /api/admin/logistics/sign-time` 人工修正（**强制审计**）
 *
 * ## 为什么需要这个页面
 * 物流单的资金释放锚点是**快递签收时间**（签收 + 释放天数）。快递100 有时查不到签收、
 * 或只给估算值 ⇒ 这批单的钱会**一直卡在待结算**，商家提不到 ⇒ 中控需要人工兜底。
 *
 * ⚠️ 清单**按发货时间升序**（越早发货越该先看），所以前端**不要**再按别的字段排序。
 * ⚠️ `pastFallbackDays=true`（发货已超过兜底天数）必须**显著标红**：这些单要么刚被估算、要么要人工介入。
 * ⚠️ 修正的签收时间**会成为资金释放锚点** ⇒ 填错直接影响商家何时能提现，故：
 *   - 不得填**未来时间**（前端先拦，后端还有 `code=1000`）；
 *   - 提交前二次确认（金额相关，防误点）。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getSignPendingCount,
  getSignPendingList,
  updateSignTime,
  type LogisticsSignPendingVO,
} from '@/api/logistics'

const loading = ref(false)
const list = ref<LogisticsSignPendingVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
/** 兜底天数（传给后端用于计算 `pastFallbackDays`）；留空 = 用后端默认。 */
const fallbackDays = ref<number | undefined>(undefined)

/** 待办角标数量。 */
const pendingCount = ref(0)
/** 角标轮询定时器（后端建议 5~10 分钟）。 */
let badgeTimer: ReturnType<typeof setInterval> | undefined
const BADGE_INTERVAL_MS = 5 * 60 * 1000

/** 详情抽屉。 */
const drawerVisible = ref(false)
const current = ref<LogisticsSignPendingVO | null>(null)

/** 修正签收时间的表单。 */
const signForm = reactive({ orderNo: '', signTime: '' })
const signSaving = ref(false)
/** 修正对话框是否可见（与下方 `openSignDialog` 配套，声明提前以保持数据在函数之前）。 */
const signDialogVisible = ref(false)
/** 修正对话框标题（固定文案，便于契约断言与测试定位）。 */
const signDialogTitle = '修正签收时间'

/** 该行是否已超兜底天数（要标红）。 */
function isOverdue(row: LogisticsSignPendingVO): boolean {
  return Boolean(row.pastFallbackDays)
}

/** 拉清单（清空后按当前分页）。 */
async function loadList(): Promise<void> {
  loading.value = true
  try {
    const result = await getSignPendingList({ page: page.value, pageSize: pageSize.value, fallbackDays: fallbackDays.value })
    list.value = Array.isArray(result.list) ? result.list : []
    total.value = Number(result.total || 0)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '待签收清单加载失败')
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 拉角标数量（失败**静默**：角标不该因为一次网络抖动就弹错误）。 */
async function loadBadge(): Promise<void> {
  try {
    pendingCount.value = await getSignPendingCount()
  } catch {
    // 角标是辅助信息，失败不打扰用户
  }
}

/** 打开详情抽屉。 */
function openDetail(row: LogisticsSignPendingVO): void {
  current.value = row
  drawerVisible.value = true
}

/** 打开修正对话框（预填订单号）。 */
function openSignDialog(row: LogisticsSignPendingVO): void {
  const orderNo = String(row.orderNo || '')
  if (!orderNo) {
    ElMessage.warning('该行缺少订单号，无法修正')
    return
  }
  signForm.orderNo = orderNo
  signForm.signTime = ''
  signDialogVisible.value = true
}

/** 本地时间 → `yyyy-MM-ddTHH:mm:ss`（后端要求该格式）。 */
function toBackendTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

/** 提交修正。⚠️ 不得未来时间 + 二次确认（会决定商家何时能提现）。 */
async function submitSignTime(): Promise<void> {
  if (!signForm.signTime) {
    ElMessage.warning('请选择签收时间')
    return
  }
  const picked = new Date(signForm.signTime)
  if (Number.isNaN(picked.getTime())) {
    ElMessage.warning('签收时间格式不正确')
    return
  }
  if (picked.getTime() > Date.now()) {
    ElMessage.warning('签收时间不能晚于当前时间')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把订单 ${signForm.orderNo} 的签收时间写为 ${signForm.signTime}。该时间会成为**资金释放期的锚点**（签收 + 释放天数），直接影响商家何时能提现，且会留下审计记录。`,
      signDialogTitle,
      { type: 'warning', confirmButtonText: '确认修正', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  signSaving.value = true
  try {
    await updateSignTime(signForm.orderNo, toBackendTime(picked))
    ElMessage.success('签收时间已修正')
    signDialogVisible.value = false
    await Promise.all([loadList(), loadBadge()])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '签收时间修正失败')
  } finally {
    signSaving.value = false
  }
}

/** 时间展示（只做字符串规范化，不用 new Date 以免时区漂移）。 */
function formatTime(value?: string | null): string {
  if (!value) return '—'
  return String(value).replace('T', ' ').slice(0, 19)
}

const overdueCount = computed(() => list.value.filter(isOverdue).length)

onMounted(() => {
  void loadList()
  void loadBadge()
  badgeTimer = setInterval(() => void loadBadge(), BADGE_INTERVAL_MS)
})

onUnmounted(() => {
  if (badgeTimer) clearInterval(badgeTimer)
})
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <span class="title">物流签收兜底</span>
        <el-tag v-if="pendingCount > 0" class="badge" type="danger" size="small">待处理 {{ pendingCount }}</el-tag>
        <el-tag v-else class="badge" type="success" size="small">暂无待处理</el-tag>
      </div>
      <div class="toolbar-actions">
        <el-input-number v-model="fallbackDays" :min="1" :max="60" placeholder="兜底天数" controls-position="right" />
        <el-button @click="page = 1; void loadList()">刷新</el-button>
      </div>
    </div>

    <el-alert
      class="hint"
      type="info"
      :closable="false"
      show-icon
      title="清单口径：已发货及之后（2/3/4）、有运单号、尚无签收时间的物流单，按发货时间升序。签收时间是物流单资金释放期的锚点（签收 + 释放天数），缺失或估算会导致商家迟迟提不到钱。"
    />
    <el-alert
      v-if="overdueCount > 0"
      class="hint"
      type="warning"
      :closable="false"
      show-icon
      :title="`本页有 ${overdueCount} 单发货已超过兜底天数，需要优先人工介入`"
    />

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="orderNo" label="订单号" min-width="180" />
      <el-table-column label="发货时间" min-width="165">
        <template #default="{ row }">{{ formatTime(row.shipTime) }}</template>
      </el-table-column>
      <el-table-column label="快递" min-width="110">
        <template #default="{ row }">{{ row.expressCompany || '—' }}</template>
      </el-table-column>
      <el-table-column label="运单号" min-width="165">
        <template #default="{ row }">{{ row.expressNo || '—' }}</template>
      </el-table-column>
      <el-table-column label="签收时间" min-width="150">
        <template #default="{ row }">
          <!-- ⚠️ signTime 为空 = 还没查到签收（本清单的核心特征） -->
          <span v-if="row.signTime">{{ formatTime(row.signTime) }}</span>
          <el-tag v-else type="info" size="small">尚无签收</el-tag>
          <!-- ⚠️ signTimeEstimated 目前恒为 false，但后端明确"留字段是为了前端少改一次" ⇒ 按可能出现处理 -->
          <el-tag v-if="row.signTimeEstimated" class="cell-tag" type="warning" size="small">估算值</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="兜底" width="130">
        <template #default="{ row }">
          <el-tag v-if="isOverdue(row)" type="danger" size="small">已超兜底天数</el-tag>
          <span v-else class="cell-muted">未超期</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button size="small" type="primary" @click="openSignDialog(row)">修正签收时间</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !list.length" description="暂无待签收的物流单" />

    <div v-if="total > 0" class="pagination">
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="page = $event; void loadList()"
        @size-change="pageSize = $event; page = 1; void loadList()"
      />
    </div>

    <!-- 详情抽屉（含原始字段，便于排查） -->
    <el-drawer v-model="drawerVisible" title="物流单详情" size="420px">
      <el-descriptions v-if="current" :column="1" border>
        <el-descriptions-item label="订单号">{{ current.orderNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="发货时间">{{ formatTime(current.shipTime) }}</el-descriptions-item>
        <el-descriptions-item label="签收时间">
          {{ current.signTime ? formatTime(current.signTime) : '尚无签收' }}
        </el-descriptions-item>
        <el-descriptions-item label="签收时间为估算值">{{ current.signTimeEstimated ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="已超兜底天数">{{ current.pastFallbackDays ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item label="快递">{{ current.expressCompany || '—' }}</el-descriptions-item>
        <el-descriptions-item label="运单号">{{ current.expressNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="履约门店">{{ current.fulfillShopId == null ? '—' : current.fulfillShopId }}</el-descriptions-item>
        <el-descriptions-item label="收货人">{{ current.receiverName || '—' }}</el-descriptions-item>
        <el-descriptions-item label="商品">{{ current.goodsSummary || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>

    <!-- 修正签收时间 -->
    <el-dialog v-model="signDialogVisible" :title="signDialogTitle" width="460px">
      <el-form label-width="96px">
        <el-form-item label="订单号">
          <el-input v-model="signForm.orderNo" disabled />
        </el-form-item>
        <el-form-item label="签收时间">
          <el-date-picker v-model="signForm.signTime" type="datetime" placeholder="选择真实签收时间" :disabled-date="(d: Date) => d.getTime() > Date.now()" />
        </el-form-item>
      </el-form>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="该时间会成为物流单资金释放期的锚点（签收 + 释放天数），填错会影响商家何时能提现。不得晚于当前时间；写入后本单签收时间视为真实值并留下审计记录。"
      />
      <template #footer>
        <el-button @click="signDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="signSaving" @click="submitSignTime">确认修正</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page { padding: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.title { font-size: 16px; font-weight: 600; }
.badge { margin-left: 8px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.hint { margin-bottom: 12px; }
.cell-muted { color: #909399; }
.cell-tag { margin-left: 6px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
