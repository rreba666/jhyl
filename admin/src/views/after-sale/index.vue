<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useAfterSaleStore } from '@/stores/after-sale'
import { useTodoStore } from '@/stores/todo'
import type { AdminAfterSale } from '@/types/after-sale'
import { AFTER_SALE_STATUS, AFTER_SALE_TYPE, MERCHANT_VERIFY_STATUS } from '@/types/after-sale'
import { Box, CircleCheck, CircleClose, Refresh } from '@element-plus/icons-vue'

const store = useAfterSaleStore()
const route = useRoute()
const todoStore = useTodoStore()

/** 状态筛选选项（undefined=全部）。 */
const statusOptions: Array<{ label: string; value: number | undefined }> = [
  { label: '全部', value: undefined },
  { label: '待审核', value: 0 },
  { label: '已驳回', value: 1 },
  { label: '退款中', value: 2 },
  { label: '已退款', value: 3 },
  { label: '待寄回', value: 4 },
  { label: '待收货', value: 5 },
]

/** 类型筛选选项（undefined=全部）。 */
const typeOptions: Array<{ label: string; value: number | undefined }> = [
  { label: '全部类型', value: undefined },
  { label: '仅退款', value: 1 },
  { label: '退货退款', value: 2 },
]

// 状态/类型筛选值统一存在 store 里（模板直接绑 `store.statusFilter` / `store.typeFilter`），
// 页面内不再保留同名本地 ref —— 曾经留过一对恒为 undefined 的 ref，导致单选高亮与实际筛选脱钩。
const reasonVisible = ref(false)
const reasonTitle = ref('')
const reasonValue = ref('')
const reasonAction = ref<((reason: string) => Promise<void>) | null>(null)

function money(value: number): string { return `¥ ${Number(value || 0).toFixed(2)}` }
function statusType(status: number): 'warning' | 'danger' | 'success' | 'info' {
  if (status === 1) return 'danger'
  if (status === 3) return 'success'
  if (status === 4) return 'info'
  return 'warning'
}

/** 打开原因输入弹窗（审核驳回 / 质检不通过共用）。 */
function openReason(title: string, action: (reason: string) => Promise<void>): void {
  reasonTitle.value = title
  reasonValue.value = ''
  reasonAction.value = action
  reasonVisible.value = true
}

async function submitReason(): Promise<void> {
  if (!reasonAction.value) return
  try {
    await reasonAction.value(reasonValue.value.trim())
    reasonVisible.value = false
    ElMessage.success('操作成功')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

/** 审核通过：仅退款直接退款，退货退款进入待寄回。 */
async function approve(row: AdminAfterSale): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认通过售后单「${row.afterSaleNo}」吗？`, '审核通过', { type: 'warning' })
    await store.approve(row.id)
    ElMessage.success('已通过审核')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '审核失败')
  }
}

/** 审核驳回。 */
function reject(row: AdminAfterSale): void {
  openReason('审核驳回', (reason) => store.reject(row.id, reason))
}

/** 收货质检通过（仅退货退款待收货状态）。 */
async function receivePass(row: AdminAfterSale): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认售后单「${row.afterSaleNo}」质检通过并回补库存、触发退款吗？`, '质检通过', { type: 'warning' })
    await store.receive(row.id, 'PASS')
    ElMessage.success('质检通过')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '质检失败')
  }
}

/** 收货质检不通过。 */
function receiveFail(row: AdminAfterSale): void {
  openReason('质检不通过', (reason) => store.receive(row.id, 'FAIL', reason))
}

// ===== 门店核实（中控转门店核实 → 门店/商户管理员回填意见 → 中控终审）=====
const verifyVisible = ref(false)
const verifyOpinion = ref('')
const verifyRow = ref<AdminAfterSale | null>(null)

/** 门店核实状态标签颜色。 */
function shopVerifyTagType(status?: number): 'info' | 'warning' | 'success' {
  if (status === 1) return 'warning'
  if (status === 2) return 'success'
  return 'info'
}

/** 打开「回填门店核实意见」弹窗（仅待门店核实时可提交）。 */
function openVerify(row: AdminAfterSale): void {
  verifyRow.value = row
  verifyOpinion.value = row.merchantVerifyOpinion || ''
  verifyVisible.value = true
}

/** 提交门店核实意见（必填，最长 500 字）。 */
async function submitVerify(): Promise<void> {
  const opinion = verifyOpinion.value.trim()
  if (!opinion) {
    ElMessage.warning('请填写门店核实意见')
    return
  }
  if (opinion.length > 500) {
    ElMessage.warning('核实意见最长 500 字')
    return
  }
  if (!verifyRow.value) return
  try {
    await store.verifyShop(verifyRow.value.id, opinion)
    verifyVisible.value = false
    ElMessage.success('门店核实意见已提交')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败')
  }
}

/** 中控转门店核实（merchant_verify_status 0→1）。 */
async function requestShopVerify(row: AdminAfterSale): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认将售后单「${row.afterSaleNo}」转门店核实？转单后由门店/商户管理员回填核实意见。`, '转门店核实', { type: 'warning' })
    await store.requestShopVerifyAction(row.id)
    ElMessage.success('已转门店核实')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '转门店核实失败')
  }
}

async function load(): Promise<void> {
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '售后单加载失败') }
}

function handleStatusChange(value: number | undefined): void { store.statusFilter = value; store.page = 1; void load() }
function handleTypeChange(value: number | undefined): void { store.typeFilter = value; store.page = 1; void load() }
function pageChange(value: number): void { store.page = value; void load() }
function sizeChange(value: number): void { store.size = value; store.page = 1; void load() }

/** 按 URL query 初始化状态筛选（待办铃铛跳 `/after-sale?status=0`）。 */
function applyQuery(): void {
  const status = route.query.status
  if (typeof status === 'string' && status !== '' && !Number.isNaN(Number(status))) {
    store.statusFilter = Number(status)
    store.page = 1
  }
}

/** 重新套用 URL 筛选并刷新（待办铃铛信号；200ms 去重避免与路由变化重复请求）。 */
let lastTodoApply = 0
function applyTodoAndReload(): void {
  const now = Date.now()
  if (now - lastTodoApply < 200) return
  lastTodoApply = now
  applyQuery()
  void load()
}

// 同一模块内点不同待办/重复点同一待办都要有反应：query 变化 + 铃铛点击信号 双保险
watch(() => route.query.status, () => { applyTodoAndReload() })
watch(() => todoStore.clickTick, () => { applyTodoAndReload() })

onMounted(() => {
  applyQuery()
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>售后管理</h1><p>审核用户售后申请：仅退款审核通过即退款，退货退款需寄回后收货质检。</p></div>
      <el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <div class="filter-row">
        <span class="filter-label">状态</span>
        <!-- ⚠️ 绑 store 的筛选值，不要绑本地 ref：el-radio-group 没有内部状态，选中态完全由 modelValue 决定，
             原先绑的是从未被写入的 `statusFilter`（恒 undefined）→ 高亮永远停在「全部」，与真实筛选脱钩（2026-09-17 修） -->
        <el-radio-group :model-value="store.statusFilter" @change="handleStatusChange">
          <el-radio-button v-for="opt in statusOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="filter-row">
        <span class="filter-label">类型</span>
        <el-radio-group :model-value="store.typeFilter" @change="handleTypeChange">
          <el-radio-button v-for="opt in typeOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</el-radio-button>
        </el-radio-group>
      </div>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>售后单</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div></div>
      <DataTable :data="store.list" :loading="store.loading" :total="store.total" :page="store.page" :page-size="store.size" empty-text="暂无售后单" @page-change="pageChange" @size-change="sizeChange">
        <el-table-column prop="afterSaleNo" label="售后单号" min-width="200" />
        <el-table-column prop="orderNo" label="订单号" min-width="190" />
        <el-table-column label="用户" width="150"><template #default="{ row }"><div>{{ row.userNickname || '--' }}</div><div class="cell-sub">{{ row.userPhone || '' }}</div></template></el-table-column>
        <el-table-column label="类型" width="100"><template #default="{ row }">{{ AFTER_SALE_TYPE[row.type] || row.typeDesc || '--' }}</template></el-table-column>
        <el-table-column label="退款金额" width="120"><template #default="{ row }">{{ money(row.refundAmount) }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ row.statusDesc || AFTER_SALE_STATUS[row.status] || '--' }}</el-tag></template></el-table-column>
        <el-table-column prop="reason" label="申请原因" min-width="160" show-overflow-tooltip />
        <el-table-column label="门店核实" width="220">
          <template #default="{ row }">
            <el-tag :type="shopVerifyTagType(row.merchantVerifyStatus)" size="small">{{ MERCHANT_VERIFY_STATUS[Number(row.merchantVerifyStatus ?? 0)] || '未转核实' }}</el-tag>
            <div v-if="row.merchantVerifyOpinion" class="cell-sub verify-opinion">{{ row.merchantVerifyOpinion }}</div>
            <div v-if="row.merchantVerifyTime" class="cell-sub">{{ row.merchantVerifyTime }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="申请时间" min-width="170" />
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <div class="operator-actions">
              <!-- 待门店核实：优先展示回填入口 -->
              <el-button v-if="row.merchantVerifyStatus === 1" size="small" type="warning" :loading="store.actionLoading" @click="openVerify(row)">回填核实意见</el-button>
              <template v-if="row.status === 0">
                <!-- ⚠️ 待门店核实（merchantVerifyStatus=1）时不给终审按钮：
                     「转门店核实」只改 merchant_verify_status、status 仍是 0，后端 approve 也只校验"待审核"，
                     不拦的话中控能在门店回填前直接通过/驳回，绕过「转核实 → 门店意见 → 中控终审」（2026-09-17 修） -->
                <template v-if="row.merchantVerifyStatus !== 1">
                  <el-button size="small" type="success" :loading="store.actionLoading" @click="approve(row)"><el-icon><CircleCheck /></el-icon>通过</el-button>
                  <el-button size="small" type="danger" @click="reject(row)"><el-icon><CircleClose /></el-icon>驳回</el-button>
                </template>
                <el-button v-if="row.merchantVerifyStatus !== 1" size="small" @click="requestShopVerify(row)">转门店核实</el-button>
              </template>
              <!-- ⚠️ 收货质检只适用于「退货退款」(type=2)：api_doc 的 `/receive` 明确"仅退货退款调用"（违者 8701），
                   原来只看 status===5，脏数据(type=1 且 status=5)会让按钮出现并调用语义不符的接口（2026-09-17 修） -->
              <template v-else-if="row.status === 5 && row.type === 2">
                <el-button size="small" type="success" :loading="store.actionLoading" @click="receivePass(row)"><el-icon><Box /></el-icon>质检通过</el-button>
                <el-button size="small" type="danger" @click="receiveFail(row)">质检不通过</el-button>
              </template>
              <span v-else-if="row.merchantVerifyStatus !== 1" class="cell-muted">—</span>
            </div>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-dialog v-model="reasonVisible" :title="reasonTitle" width="460px" append-to-body>
      <el-input v-model="reasonValue" type="textarea" :rows="4" placeholder="请输入原因（可为空）" />
      <template #footer><el-button @click="reasonVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitReason">确定</el-button></template>
    </el-dialog>

    <!-- 门店核实意见回填（仅 merchantVerifyStatus=1 待门店核实时） -->
    <el-dialog v-model="verifyVisible" title="回填门店核实意见" width="560px" append-to-body>
      <el-alert
        title="门店核实意见将作为中控终审的参考依据，提交后不可修改；请如实描述商品状态与建议。"
        type="info"
        :closable="false"
        show-icon
        class="verify-tip"
      />
      <el-descriptions :column="1" size="small" border class="verify-desc">
        <el-descriptions-item label="售后单号">{{ verifyRow?.afterSaleNo }}</el-descriptions-item>
        <el-descriptions-item label="订单号">{{ verifyRow?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="用户申请原因">{{ verifyRow?.reason || '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-input
        v-model="verifyOpinion"
        type="textarea"
        :rows="5"
        maxlength="500"
        show-word-limit
        placeholder="如：门店核实：商品已拆封，外包装完好，建议折价退款"
      />
      <template #footer><el-button @click="verifyVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitVerify">提交核实意见</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.filter-row { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.filter-row:last-child { margin-bottom: 0; }
.filter-label { flex-shrink: 0; width: 44px; color: #606266; font-size: 14px; }
.operator-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.cell-sub { margin-top: 2px; color: #909399; font-size: 12px; }
.cell-muted { color: #c0c4cc; }
.verify-opinion { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.verify-tip { margin-bottom: 14px; }
.verify-desc { margin-bottom: 14px; }
</style>
