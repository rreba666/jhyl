<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Edit, Refresh, Search, Setting, View } from '@element-plus/icons-vue'
import { getDividendRecordTestResult, getDividendSlotTestResult, getWalletTestResult } from '@/api/profit'
import { useProfitStore } from '@/stores/profit'
import { sanitizeBonusText } from '@/utils/textSafe'
import type { DividendRecordTestResult, DividendSlotTestResult, ProfitAdjustDailyDTO, ProfitAdjustPoolDTO, PromotionBinding, PromotionBindingSource, SevenDayBonusDetail, SevenDayBonusPool, UserDividendLimit, WalletTestResult } from '@/types/profit'

const store = useProfitStore()
const activeTab = ref('promotion')
const poolDetailVisible = ref(false)
const adjustPoolVisible = ref(false)
const adjustDailyVisible = ref(false)
const rebindVisible = ref(false)
const adjustPoolFormRef = ref<FormInstance>()
const adjustDailyFormRef = ref<FormInstance>()
const adjustPoolForm = reactive<ProfitAdjustPoolDTO>({ totalAmount: 0, userCount: 0 })
const adjustDailyForm = reactive<ProfitAdjustDailyDTO>({ dailyAmount: 0, dailyUserCount: 0 })
const poolFormRules: FormRules = { totalAmount: [{ required: true, message: '请输入奖池总金额', trigger: 'blur' }], userCount: [{ required: true, message: '请输入用户数', trigger: 'blur' }] }
const dailyFormRules: FormRules = { dailyAmount: [{ required: true, message: '请输入每日金额', trigger: 'blur' }], dailyUserCount: [{ required: true, message: '请输入每日用户数', trigger: 'blur' }] }
const poolId = ref('')
const dailyId = ref('')
const rebindRow = ref<PromotionBinding | null>(null)
const promoterId = ref('')
const settleForm = reactive({ startDate: '', endDate: '' })
const testInjectForm = reactive({ poolDate: '', amount: 1000 })
const testSettleForm = reactive({ startDate: '', endDate: '' })
const testPoolId = ref('')
const userToken = ref('')
const testResultLoading = ref(false)
const walletTestResult = ref<WalletTestResult | null>(null)
const dividendSlotTestResult = ref<DividendSlotTestResult | null>(null)
const dividendRecordTestResult = ref<DividendRecordTestResult | null>(null)

const relationKeyword = computed({ get: () => store.relationFilters.keyword, set: (value: string) => { store.relationFilters.keyword = value } })
const relationSource = computed<PromotionBindingSource | ''>({ get: () => store.relationFilters.source, set: (value) => { store.relationFilters.source = value } })
const selectedTestPool = computed(() => store.sevenDayPools.find((pool) => pool.id === testPoolId.value) || null)

function money(value: number): string { return `¥ ${Number(value || 0).toFixed(2)}` }
function statusType(status: string): 'success' | 'warning' | 'info' | 'danger' { return /CONFIRMED|SETTLED|SUCCESS|BOUND/i.test(status) ? 'success' : /REJECT|BLOCK|FAIL/i.test(status) ? 'danger' : /PENDING|WAIT/i.test(status) ? 'warning' : 'info' }
function statusText(status: string): string { return ({ PENDING: '待处理', CONFIRMED: '已确认', SETTLED: '已结算', BOUND: '已绑定' } as Record<string, string>)[status] || status || '未知' }
/** 贡献状态文案：后端 statusDesc 优先（统一做旧词兜底替换），否则按状态兜底映射。 */
function contributionStatusText(status: string, statusDesc = ''): string { return sanitizeBonusText(statusDesc) || ({ PENDING: '待确认（7天后自动确认）', CONFIRMING: '系统确认中', CONFIRMED: '已进入红包池', VOIDED: '订单退款，红包作废' } as Record<string, string>)[status] || status || '未知' }
function contributionStatusType(status: string): 'success' | 'warning' | 'info' | 'danger' { return status === 'CONFIRMED' ? 'success' : status === 'VOIDED' ? 'danger' : status === 'PENDING' ? 'warning' : 'info' }
function displayTime(value: string): string { return value || '未完成' }
function showError(error: unknown, fallback: string): void { ElMessage.error(sanitizeBonusText(error instanceof Error ? error.message : fallback)) }

async function load(): Promise<void> { try { await store.fetchAll() } catch (error) { showError(error, '资金数据加载失败') } }
async function loadRelations(): Promise<void> { try { await store.fetchRelations() } catch (error) { showError(error, '推广关系加载失败') } }
async function loadContributions(): Promise<void> { try { await store.fetchContributions() } catch (error) { showError(error, '红包贡献加载失败') } }
function handleTabChange(name: string | number): void { if (String(name) === 'contributions' && !store.contributions.length) void loadContributions() }
function contributionStatusChange(): void { store.contributionPage = 1; void loadContributions() }
function contributionPageChange(page: number): void { store.contributionPage = page; void loadContributions() }
function contributionSizeChange(size: number): void { store.contributionSize = size; store.contributionPage = 1; void loadContributions() }
function searchRelations(): void { store.relationPage = 1; void loadRelations() }
function relationPageChange(page: number): void { store.relationPage = page; void loadRelations() }
function relationSizeChange(size: number): void { store.relationSize = size; store.relationPage = 1; void loadRelations() }
function pendingPageChange(page: number): void { store.pendingPage = page; void load() }
function pendingSizeChange(size: number): void { store.pendingSize = size; store.pendingPage = 1; void load() }

function openRebind(row: PromotionBinding): void { rebindRow.value = row; promoterId.value = row.promoterUserId; rebindVisible.value = true }
async function rebindPromotionRelation(): Promise<void> {
  if (!rebindRow.value || !/^[1-9]\d*$/.test(promoterId.value)) { ElMessage.warning('推广员 ID 必须为正整数'); return }
  try {
    await ElMessageBox.confirm('重绑仅影响后续订单，历史账务不回滚。确认继续吗？', '确认重新绑定', { type: 'warning' })
    await store.rebindRelation(rebindRow.value.buyerUserId, promoterId.value)
    rebindVisible.value = false
    ElMessage.success('推广关系已重新绑定')
  } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '重新绑定失败') }
}
async function unbindPromotionRelation(row: PromotionBinding): Promise<void> {
  try {
    await ElMessageBox.confirm('解除绑定仅影响后续订单，历史账务不回滚。确认继续吗？', '确认解除绑定', { type: 'warning' })
    await store.unbindRelation(row.buyerUserId)
    ElMessage.success('推广关系已解除')
  } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '解除绑定失败') }
}

async function settlePool(): Promise<void> {
  if (!settleForm.startDate || !settleForm.endDate) { ElMessage.warning('请选择结算日期范围'); return }
  try { await store.settle(settleForm.startDate, settleForm.endDate); ElMessage.success('奖池结算已完成') } catch (error) { showError(error, '奖池结算失败') }
}
async function injectTestPool(): Promise<void> {
  const amount = Number(testInjectForm.amount)
  if (!Number.isFinite(amount) || amount <= 0) { ElMessage.warning('注入金额必须大于 0'); return }
  try {
    await ElMessageBox.confirm(`将向 ${testInjectForm.poolDate || '今天'} 的每日奖池追加 ${money(amount)}，不会立即发放给用户。确认继续吗？`, '确认注入奖池', { type: 'warning' })
    await store.inject({ poolDate: testInjectForm.poolDate || undefined, amount })
    ElMessage.success('奖池金额已注入，请继续查看未结算奖池')
  } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '奖池注入失败') }
}
async function settleTestPool(): Promise<void> {
  if (!testSettleForm.startDate || !testSettleForm.endDate) { ElMessage.warning('请选择结算日期范围'); return }
  try {
    await store.settle(testSettleForm.startDate, testSettleForm.endDate)
    const pool = store.sevenDayPools.find((item) => item.startDate === testSettleForm.startDate && item.endDate === testSettleForm.endDate)
    testPoolId.value = pool?.id || ''
    ElMessage.success(pool ? `结算完成，已选中奖池 ${pool.id}` : '结算完成，请在下方选择新建父奖池')
  } catch (error) { showError(error, '奖池结算失败') }
}
async function confirmTestPool(): Promise<void> {
  const pool = selectedTestPool.value
  if (!pool) { ElMessage.warning('请先选择要发放的父奖池'); return }
  try {
    await ElMessageBox.confirm(`确认发放 ${pool.startDate} 至 ${pool.endDate} 的奖池 ${pool.id} 吗？此操作会增加用户待提现红包并写入红包流水。`, '确认发放红包', { type: 'warning', confirmButtonText: '确认发放', cancelButtonText: '取消' })
    await store.confirm(pool.id)
    ElMessage.success('红包已发放，请使用 C 端 Token 核验结果')
  } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '红包发放失败') }
}
async function verifyUserDividend(): Promise<void> {
  if (!userToken.value.trim()) { ElMessage.warning('请输入 C 端用户 Token'); return }
  testResultLoading.value = true
  try {
    const [wallet, slots, records] = await Promise.all([
      getWalletTestResult(userToken.value),
      getDividendSlotTestResult(userToken.value),
      getDividendRecordTestResult(userToken.value),
    ])
    walletTestResult.value = wallet
    dividendSlotTestResult.value = slots
    dividendRecordTestResult.value = records
    ElMessage.success('C 端红包结果已刷新')
  } catch (error) { showError(error, 'C 端红包结果查询失败') } finally { testResultLoading.value = false }
}
function clearUserDividendResult(): void {
  userToken.value = ''
  walletTestResult.value = null
  dividendSlotTestResult.value = null
  dividendRecordTestResult.value = null
}
async function showPoolDetails(pool: SevenDayBonusPool): Promise<void> { try { await store.fetchPoolDetails(pool.id); poolDetailVisible.value = true } catch (error) { showError(error, '奖池明细加载失败') } }
function openPoolAdjust(pool: SevenDayBonusPool): void { poolId.value = pool.id; Object.assign(adjustPoolForm, { totalAmount: pool.totalAmount, userCount: pool.settledUserCount }); adjustPoolVisible.value = true }
async function submitPoolAdjust(): Promise<void> { if (!(await adjustPoolFormRef.value?.validate().catch(() => false))) return; try { await store.adjust(poolId.value, { ...adjustPoolForm }); adjustPoolVisible.value = false; ElMessage.success('奖池已调整') } catch (error) { showError(error, '奖池调整失败') } }
function openDailyAdjust(detail: SevenDayBonusDetail): void { dailyId.value = detail.id; Object.assign(adjustDailyForm, { dailyAmount: detail.dailyAmount, dailyUserCount: detail.dailyUserCount }); adjustDailyVisible.value = true }
async function submitDailyAdjust(): Promise<void> { if (!(await adjustDailyFormRef.value?.validate().catch(() => false))) return; try { await store.adjustDetail(dailyId.value, { ...adjustDailyForm }); adjustDailyVisible.value = false; ElMessage.success('每日奖池已调整') } catch (error) { showError(error, '每日奖池调整失败') } }
async function confirmPool(pool: SevenDayBonusPool): Promise<void> { try { await ElMessageBox.confirm(`确认并发放 ${pool.startDate} 至 ${pool.endDate} 的奖池吗？`, '确认并发放', { type: 'warning' }); await store.confirm(pool.id); ElMessage.success('奖池已确认并发放') } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '确认发放失败') } }
async function resetLimit(row: UserDividendLimit): Promise<void> { try { await ElMessageBox.confirm(`确认重置用户 ${row.userId} 的购买机会吗？`, '重置购买机会', { type: 'warning' }); await store.resetLimit(row.userId); ElMessage.success('购买机会已重置') } catch (error) { if (error !== 'cancel' && error !== 'close') showError(error, '重置失败') } }

onMounted(() => { void load(); void loadRelations() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading"><div><h1>推广资金管理</h1><p>推广金、奖池结算、用户红包额度与推广绑定关系。</p></div><el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></div>
    <el-tabs v-model="activeTab" class="profit-tabs" @tab-change="handleTabChange">
      <el-tab-pane label="待推广金" name="promotion">
        <el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>待推广金</strong><span class="toolbar-count">共 {{ store.pendingTotal }} 条</span></div></div>
          <el-table :data="store.pendingPromotion" v-loading="store.loading" border stripe><el-table-column prop="id" label="记录 ID" width="110" /><el-table-column prop="orderNo" label="订单号" min-width="180" /><el-table-column prop="promoterUserId" label="推广用户" width="120" /><el-table-column prop="buyerUserId" label="购买用户" width="120" /><el-table-column label="金额" width="120"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column><el-table-column prop="createdAt" label="创建时间" min-width="180" /></el-table>
          <div class="table-pagination"><span>共 {{ store.pendingTotal }} 条</span><el-pagination background layout="total, sizes, prev, pager, next" :current-page="store.pendingPage" :page-size="store.pendingSize" :total="store.pendingTotal" @current-change="pendingPageChange" @size-change="pendingSizeChange" /></div>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="推广关系" name="relations">
        <el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>推广关系</strong><span class="toolbar-count">共 {{ store.relationTotal }} 条</span></div><div class="toolbar-actions"><el-input v-model="relationKeyword" placeholder="买家或推广员关键词" clearable class="relationKeyword" @keyup.enter="searchRelations" /><el-select v-model="relationSource" clearable placeholder="来源" class="relationSource"><el-option label="扫码绑定" value="SCAN" /><el-option label="手动绑定" value="MANUAL" /><el-option label="未知来源" value="UNKNOWN" /></el-select><el-button type="primary" :icon="Search" @click="searchRelations">搜索</el-button></div></div>
          <el-table :data="store.relations" v-loading="store.relationLoading" border stripe><el-table-column prop="buyerUserId" label="买家 ID" width="110" /><el-table-column prop="buyerName" label="买家" min-width="130" /><el-table-column prop="promoterUserId" label="推广员 ID" width="120" /><el-table-column prop="promoterName" label="推广员" min-width="130" /><el-table-column prop="bindTime" label="绑定时间" min-width="170" /><el-table-column prop="sourceDesc" label="来源" width="110" /><el-table-column label="状态" width="95"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ sanitizeBonusText(row.statusDesc) || statusText(row.status) }}</el-tag></template></el-table-column><el-table-column label="操作" width="190" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button size="small" type="primary" :loading="store.relationActionLoading" @click="openRebind(row)"><el-icon><Edit /></el-icon>重新绑定</el-button><el-button size="small" type="danger" :loading="store.relationActionLoading" @click="unbindPromotionRelation(row)"><el-icon><Delete /></el-icon>解除绑定</el-button></div></template></el-table-column></el-table>
          <div class="table-pagination"><span>共 {{ store.relationTotal }} 条</span><el-pagination background layout="total, sizes, prev, pager, next" :current-page="store.relationPage" :page-size="store.relationSize" :total="store.relationTotal" @current-change="relationPageChange" @size-change="relationSizeChange" /></div>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="红包贡献" name="contributions">
        <el-alert title="红包贡献记录只读，不能人工确认" description="PENDING 记录表示已记录红包金额，等待系统自动确认；订单退款后会标记为作废。" type="info" :closable="false" show-icon class="contribution-alert" />
        <el-card shadow="never" class="content-card">
          <div class="toolbar"><div><strong>红包贡献记录</strong><span class="toolbar-count">共 {{ store.contributionTotal }} 条</span></div><div class="toolbar-actions"><el-select v-model="store.contributionStatus" clearable placeholder="全部状态" class="contribution-status" @change="contributionStatusChange"><el-option label="待确认" value="PENDING" /><el-option label="系统确认中" value="CONFIRMING" /><el-option label="已进入红包池" value="CONFIRMED" /><el-option label="订单退款，红包作废" value="VOIDED" /></el-select><el-button :loading="store.contributionLoading" @click="loadContributions"><el-icon><Refresh /></el-icon>刷新</el-button></div></div>
          <el-table :data="store.contributions" v-loading="store.contributionLoading" border stripe empty-text="暂无红包贡献记录"><el-table-column prop="orderNo" label="订单号" min-width="190" /><el-table-column label="用户" min-width="150"><template #default="{ row }"><div>{{ row.userName || '未命名用户' }}</div><small class="muted-text">ID：{{ row.userId || '—' }}</small></template></el-table-column><el-table-column label="贡献金额" width="130"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column><el-table-column prop="paidAt" label="支付时间" min-width="170" /><el-table-column label="预计成熟时间" min-width="170"><template #default="{ row }">{{ displayTime(row.matureAt) }}</template></el-table-column><el-table-column label="状态" min-width="170"><template #default="{ row }"><el-tag :type="contributionStatusType(row.status)">{{ contributionStatusText(row.status, row.statusDesc) }}</el-tag></template></el-table-column><el-table-column label="确认时间" min-width="170"><template #default="{ row }">{{ displayTime(row.confirmedAt) }}</template></el-table-column><el-table-column prop="poolId" label="奖池 ID" width="110" /></el-table>
          <div class="table-pagination"><span>共 {{ store.contributionTotal }} 条</span><el-pagination background layout="total, sizes, prev, pager, next" :current-page="store.contributionPage" :page-size="store.contributionSize" :total="store.contributionTotal" @current-change="contributionPageChange" @size-change="contributionSizeChange" /></div>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="红包测试" name="test">
        <el-alert title="测试流程：先确认用户有有效订单和活跃红包槽位，再注入奖池、结算、选择父奖池并确认发放。结算不会直接给用户加钱。" type="info" :closable="false" show-icon class="test-alert" />
        <div class="test-step-grid">
          <el-card shadow="never" class="content-card test-step-card">
            <div class="test-step-heading"><div><span class="step-index">1</span><strong>准备资格</strong></div><el-button size="small" :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新资格</el-button></div>
            <p class="test-help">用户必须有有效订单和未锁死的红包槽位。当前购买机会列表共 {{ store.dividendLimits.length }} 条。</p>
            <el-table :data="store.dividendLimits.slice(0, 5)" v-loading="store.loading" border stripe size="small"><el-table-column prop="userId" label="用户 ID" width="100" /><el-table-column prop="availablePurchase" label="可用机会" /><el-table-column prop="totalPurchases" label="累计购买" /></el-table>
          </el-card>
          <el-card shadow="never" class="content-card test-step-card">
            <div class="test-step-heading"><div><span class="step-index">2</span><strong>注入奖池金额</strong></div></div>
            <p class="test-help">只累加指定日期的每日奖池，不会立即发放。注入后可在未结算奖池中确认金额。</p>
            <div class="test-form-row"><el-date-picker v-model="testInjectForm.poolDate" type="date" value-format="YYYY-MM-DD" placeholder="注入日期（默认今天）" /><el-input-number v-model="testInjectForm.amount" :min="0.01" :precision="2" controls-position="right" /><el-button type="primary" :loading="store.actionLoading" @click="injectTestPool">注入奖池金额</el-button></div>
            <el-table :data="store.unsettledDaily" v-loading="store.loading" border stripe size="small" class="test-table"><el-table-column prop="poolDate" label="日期" /><el-table-column label="每日金额"><template #default="{ row }">{{ money(row.dailyAmount) }}</template></el-table-column><el-table-column prop="dailyUserCount" label="用户数" /></el-table>
          </el-card>
          <el-card shadow="never" class="content-card test-step-card">
            <div class="test-step-heading"><div><span class="step-index">3</span><strong>结算每日奖池</strong></div></div>
            <p class="test-help">按日期范围创建父奖池。此步骤只结算，不会增加用户钱包。</p>
            <div class="test-form-row"><el-date-picker v-model="testSettleForm.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" /><el-date-picker v-model="testSettleForm.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" /><el-button type="primary" :loading="store.actionLoading" @click="settleTestPool">结算每日奖池</el-button></div>
          </el-card>
          <el-card shadow="never" class="content-card test-step-card">
            <div class="test-step-heading"><div><span class="step-index">4</span><strong>选择并发放父奖池</strong></div></div>
            <p class="test-help">先选择已结算的父奖池，可先查看每日明细，再执行不可逆的正式发放。</p>
            <div class="test-form-row"><el-select v-model="testPoolId" placeholder="选择父奖池" class="test-pool-select"><el-option v-for="pool in store.sevenDayPools" :key="pool.id" :label="`${pool.id}：${pool.startDate} 至 ${pool.endDate}，${money(pool.totalAmount)}`" :value="pool.id" /></el-select><el-button :disabled="!selectedTestPool" @click="selectedTestPool && showPoolDetails(selectedTestPool)"><el-icon><View /></el-icon>查看明细</el-button><el-button type="danger" :loading="store.actionLoading" :disabled="!selectedTestPool" @click="confirmTestPool">确认发放</el-button></div>
            <el-descriptions v-if="selectedTestPool" :column="3" border size="small" class="test-summary"><el-descriptions-item label="奖池 ID">{{ selectedTestPool.id }}</el-descriptions-item><el-descriptions-item label="总金额">{{ money(selectedTestPool.totalAmount) }}</el-descriptions-item><el-descriptions-item label="结算人数">{{ selectedTestPool.settledUserCount }}</el-descriptions-item></el-descriptions>
          </el-card>
          <el-card shadow="never" class="content-card test-step-card test-result-card">
            <div class="test-step-heading"><div><span class="step-index">5</span><strong>C 端核验红包结果</strong></div><el-button text @click="clearUserDividendResult">清空</el-button></div>
            <p class="test-help">粘贴对应用户的 C 端 Token，仅用于本次查询，不会保存，也不会影响当前管理员登录。</p>
            <div class="test-form-row test-token-row"><el-input v-model="userToken" type="textarea" :rows="2" clearable placeholder="请输入 C 端用户 Token" /><el-button type="primary" :loading="testResultLoading" @click="verifyUserDividend">查询结果</el-button></div>
            <div v-if="walletTestResult || dividendSlotTestResult || dividendRecordTestResult" class="test-result-grid">
              <el-descriptions v-if="walletTestResult" title="钱包信息" :column="4" border size="small"><el-descriptions-item label="余额">{{ money(walletTestResult.balance) }}</el-descriptions-item><el-descriptions-item label="待提现推广金">{{ money(walletTestResult.pendingPromotion) }}</el-descriptions-item><el-descriptions-item label="待提现红包">{{ money(walletTestResult.pendingBonus) }}</el-descriptions-item><el-descriptions-item label="累计收入">{{ money(walletTestResult.totalIncome) }}</el-descriptions-item></el-descriptions>
              <el-descriptions v-if="dividendSlotTestResult" title="红包槽位" :column="3" border size="small"><el-descriptions-item label="可用购买机会">{{ dividendSlotTestResult.availablePurchase }}</el-descriptions-item><el-descriptions-item label="累计购买">{{ dividendSlotTestResult.totalPurchases }}</el-descriptions-item><el-descriptions-item label="槽位数量">{{ dividendSlotTestResult.slots.length }}</el-descriptions-item></el-descriptions>
              <el-table v-if="dividendSlotTestResult" :data="dividendSlotTestResult.slots" border stripe size="small"><el-table-column prop="id" label="槽位 ID" width="90" /><el-table-column prop="productName" label="商品" min-width="160" /><el-table-column label="红包累计"><template #default="{ row }">{{ money(row.totalReceived) }}</template></el-table-column><el-table-column label="上限"><template #default="{ row }">{{ money(row.capAmount) }}</template></el-table-column><el-table-column prop="locked" label="锁死" width="80"><template #default="{ row }">{{ row.locked ? '是' : '否' }}</template></el-table-column></el-table>
              <el-table v-if="dividendRecordTestResult" :data="dividendRecordTestResult.list" border stripe size="small"><el-table-column prop="id" label="流水 ID" width="100" /><el-table-column prop="productName" label="红包来源" min-width="180" /><el-table-column label="金额" width="130"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column><el-table-column prop="createTime" label="到账时间" min-width="170" /></el-table>
            </div>
          </el-card>
        </div>
      </el-tab-pane>
      <el-tab-pane label="7 天奖池" name="pools">
        <el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>7 天奖池</strong><span class="toolbar-count">按周期管理奖池</span></div><div class="toolbar-actions"><el-date-picker v-model="settleForm.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" /><el-date-picker v-model="settleForm.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" /><el-button type="primary" :loading="store.actionLoading" @click="settlePool">结算周期</el-button></div></div>
          <el-table :data="store.sevenDayPools" v-loading="store.loading" border stripe><el-table-column prop="id" label="奖池 ID" width="110" /><el-table-column label="周期" min-width="200"><template #default="{ row }">{{ row.startDate }} 至 {{ row.endDate }}</template></el-table-column><el-table-column label="总金额" width="140"><template #default="{ row }">{{ money(row.totalAmount) }}</template></el-table-column><el-table-column prop="settledUserCount" label="已结算人数" width="120" /><el-table-column prop="settleTime" label="结算时间" min-width="180" /><el-table-column label="操作" width="250" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button size="small" @click="showPoolDetails(row)"><el-icon><View /></el-icon>明细</el-button><el-button size="small" @click="openPoolAdjust(row)"><el-icon><Setting /></el-icon>调整</el-button><el-button size="small" type="primary" @click="confirmPool(row)">确认并发放</el-button></div></template></el-table-column></el-table>
        </el-card>
        <el-card shadow="never" class="content-card"><div class="toolbar"><strong>未结算每日奖池</strong></div><el-table :data="store.unsettledDaily" v-loading="store.loading" border stripe><el-table-column prop="id" label="明细 ID" width="110" /><el-table-column prop="poolDate" label="日期" width="160" /><el-table-column label="每日金额" width="140"><template #default="{ row }">{{ money(row.dailyAmount) }}</template></el-table-column><el-table-column prop="dailyUserCount" label="用户数" width="120" /><el-table-column label="操作" width="110"><template #default="{ row }"><el-button size="small" @click="openDailyAdjust(row)"><el-icon><Setting /></el-icon>调整</el-button></template></el-table-column></el-table></el-card>
      </el-tab-pane>
      <el-tab-pane label="用户购买机会" name="limits"><el-card shadow="never" class="content-card"><div class="toolbar"><div><strong>用户购买机会</strong><span class="toolbar-count">共 {{ store.dividendLimits.length }} 条</span></div></div><el-table :data="store.dividendLimits" v-loading="store.loading" border stripe><el-table-column prop="userId" label="用户 ID" width="120" /><el-table-column prop="availablePurchase" label="可用购买机会" width="140" /><el-table-column prop="totalPurchases" label="累计购买" width="120" /><el-table-column prop="createTime" label="创建时间" min-width="170" /><el-table-column prop="updateTime" label="更新时间" min-width="170" /><el-table-column label="操作" width="110"><template #default="{ row }"><el-button size="small" type="warning" @click="resetLimit(row)">重置</el-button></template></el-table-column></el-table></el-card></el-tab-pane>
    </el-tabs>
    <el-dialog v-model="rebindVisible" title="重新绑定推广员" width="460px"><p v-if="rebindRow" class="dialog-context">买家：{{ rebindRow.buyerName || rebindRow.buyerUserId }}</p><el-input v-model="promoterId" placeholder="请输入推广员 ID" inputmode="numeric" /><template #footer><el-button @click="rebindVisible = false">取消</el-button><el-button type="primary" :loading="store.relationActionLoading" @click="rebindPromotionRelation">重新绑定</el-button></template></el-dialog>
    <el-dialog v-model="poolDetailVisible" title="每日奖池明细" width="760px"><el-table :data="store.poolDetails" border><el-table-column prop="poolDate" label="日期" /><el-table-column label="每日金额"><template #default="{ row }">{{ money(row.dailyAmount) }}</template></el-table-column><el-table-column prop="dailyUserCount" label="用户数" /><el-table-column prop="updateTime" label="更新时间" /></el-table></el-dialog>
    <el-dialog v-model="adjustPoolVisible" title="调整 7 天奖池" width="460px"><el-form ref="adjustPoolFormRef" :model="adjustPoolForm" :rules="poolFormRules" label-width="100px"><el-form-item label="总金额" prop="totalAmount"><el-input-number v-model="adjustPoolForm.totalAmount" :min="0" :precision="2" /></el-form-item><el-form-item label="用户数" prop="userCount"><el-input-number v-model="adjustPoolForm.userCount" :min="0" /></el-form-item></el-form><template #footer><el-button @click="adjustPoolVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitPoolAdjust">保存</el-button></template></el-dialog>
    <el-dialog v-model="adjustDailyVisible" title="调整每日奖池" width="460px"><el-form ref="adjustDailyFormRef" :model="adjustDailyForm" :rules="dailyFormRules" label-width="110px"><el-form-item label="每日金额" prop="dailyAmount"><el-input-number v-model="adjustDailyForm.dailyAmount" :min="0" :precision="2" /></el-form-item><el-form-item label="每日用户数" prop="dailyUserCount"><el-input-number v-model="adjustDailyForm.dailyUserCount" :min="0" /></el-form-item></el-form><template #footer><el-button @click="adjustDailyVisible = false">取消</el-button><el-button type="primary" :loading="store.actionLoading" @click="submitDailyAdjust">保存</el-button></template></el-dialog>
  </section>
</template>

<style scoped>
.profit-tabs { min-width: 0; }
.profit-tabs :deep(.el-tabs__content) { overflow: visible; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.relationKeyword { width: 220px; }
.relationSource { width: 140px; }
.contribution-status { width: 170px; }
.table-pagination { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-top: 16px; }
.dialog-context { color: var(--el-text-color-secondary); margin: 0 0 12px; }
.test-alert { margin-bottom: 16px; }
.test-step-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.test-step-card { min-width: 0; }
.test-step-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.test-step-heading > div { display: flex; align-items: center; gap: 9px; }
.step-index { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; color: #fff; background: var(--el-color-primary); font-size: 13px; font-weight: 700; }
.test-help { min-height: 40px; margin: 0 0 12px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 20px; }
.test-form-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.test-form-row :deep(.el-input-number) { width: 150px; }
.test-pool-select { min-width: 260px; flex: 1; }
.test-table { margin-top: 8px; }
.test-summary { margin-top: 10px; }
.test-result-card { grid-column: 1 / -1; }
.test-token-row :deep(.el-textarea) { min-width: 0; flex: 1; }
.test-token-row :deep(.el-textarea__inner) { min-height: 52px; }
.test-result-grid { display: grid; gap: 12px; }
.test-result-grid :deep(.el-descriptions__title) { margin-top: 4px; font-size: 14px; }
.contribution-alert { margin-bottom: 16px; }
.muted-text { color: var(--el-text-color-secondary); font-size: 12px; }
@media (max-width: 900px) { .toolbar-actions, .table-pagination { align-items: stretch; flex-direction: column; } .relationKeyword, .relationSource, .contribution-status { width: 100%; } }
@media (max-width: 1100px) { .test-step-grid { grid-template-columns: 1fr; } .test-result-card { grid-column: auto; } }
</style>
