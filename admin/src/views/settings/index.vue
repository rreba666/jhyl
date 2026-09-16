<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useSettingStore } from '@/stores/setting'
import type { DividendCapSaveDTO, ProfitRatesSaveDTO, SysConfigSaveDTO, WithdrawRulesConfig } from '@/types/setting'
import { fromDisplayFundRate, toDisplayFundRate } from '@/utils/fundRate'

const store = useSettingStore()
const dividendCapFormRef = ref<FormInstance>()
const profitRatesFormRef = ref<FormInstance>()
const withdrawRulesFormRef = ref<FormInstance>()
const dividendCapForm = reactive<DividendCapSaveDTO>({ multiplier: 1.5, remark: '' })
const profitRatesForm = reactive<ProfitRatesSaveDTO>({ promotionRate: 20, bonusPoolRate: 26, remark: '' })
type WithdrawRulesForm = Omit<WithdrawRulesConfig, 'feeRate'> & { feeRate: number }
const withdrawRulesForm = reactive<WithdrawRulesForm>({ minAmount: 0, dailyAmountLimit: 0, dailyCountLimit: 0, feeRate: 0, testUserMinAmount: 0, testUserId: null, testSkipLock: false, maxConcurrent: 0, frozenLimit: 0, remark: '' })

const dividendCapRules: FormRules = {
  multiplier: [
    { required: true, message: '请输入红包上限倍率', trigger: 'blur' },
    { type: 'number', min: 0.01, max: 100, message: '倍率范围为 0.01~100', trigger: 'change' },
  ],
}
const profitRatesRules: FormRules = {
  promotionRate: [
    { required: true, message: '请输入比例', trigger: 'blur' },
    { type: 'number', min: 0, max: 100, message: '比例范围为 0~100', trigger: 'change' },
  ],
  bonusPoolRate: [
    { required: true, message: '请输入比例', trigger: 'blur' },
    { type: 'number', min: 0, max: 100, message: '比例范围为 0~100', trigger: 'change' },
  ],
}
const withdrawRulesRules: FormRules = {
  minAmount: [{ required: true, message: '请输入普通用户最低提现金额', trigger: 'blur' }, { type: 'number', min: 0, message: '金额不能小于 0', trigger: 'change' }],
  dailyAmountLimit: [{ required: true, message: '请输入每日累计上限', trigger: 'blur' }, { type: 'number', min: 0, message: '金额不能小于 0', trigger: 'change' }],
  dailyCountLimit: [{ required: true, message: '请输入每日提现次数上限', trigger: 'blur' }, { type: 'number', min: 1, message: '次数必须大于 0', trigger: 'change' }],
  feeRate: [{ required: true, message: '请输入手续费率', trigger: 'blur' }, { type: 'number', min: 0, max: 100, message: '手续费率范围为 0%~100%', trigger: 'change' }],
  testUserMinAmount: [{ required: true, message: '请输入测试用户最低金额', trigger: 'blur' }, { type: 'number', min: 0, message: '金额不能小于 0', trigger: 'change' }],
  maxConcurrent: [{ required: true, message: '请输入最大并行提现笔数', trigger: 'blur' }, { type: 'number', min: 1, message: '并行笔数必须大于 0', trigger: 'change' }],
  frozenLimit: [{ required: true, message: '请输入冻结提现总额上限', trigger: 'blur' }, { type: 'number', min: 0, message: '金额不能小于 0', trigger: 'change' }],
}

function showError(error: unknown, fallback: string): void {
  ElMessage.error(error instanceof Error ? error.message : fallback)
}

async function loadDividendCap(): Promise<void> {
  try {
    await store.loadDividendCap()
    dividendCapForm.multiplier = store.dividendCap.multiplier
    dividendCapForm.remark = store.dividendCap.remark
  } catch (error) {
    showError(error, '红包上限倍率加载失败')
  }
}

async function loadProfitRates(): Promise<void> {
  try {
    await store.loadProfitRates()
    profitRatesForm.promotionRate = toDisplayFundRate(store.profitRates.promotionRate)
    profitRatesForm.bonusPoolRate = toDisplayFundRate(store.profitRates.bonusPoolRate)
    profitRatesForm.remark = store.profitRates.remark
  } catch (error) {
    showError(error, '商品资金比例加载失败')
  }
}

async function loadWithdrawRules(): Promise<void> {
  try {
    await store.loadWithdrawRules()
    Object.assign(withdrawRulesForm, store.withdrawRules, { feeRate: store.withdrawRules.feeRate * 100 })
  } catch (error) {
    showError(error, '提现规则加载失败')
  }
}

async function saveDividendCap(): Promise<void> {
  if (!(await dividendCapFormRef.value?.validate().catch(() => false))) return
  try {
    await ElMessageBox.confirm('保存红包上限倍率后，仅影响之后新开的槽位，确认继续吗？', '保存确认', { type: 'warning' })
    await store.saveDividendCapConfig({ ...dividendCapForm })
    ElMessage.success('红包上限倍率已保存')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error, '红包上限倍率保存失败')
  }
}

async function saveProfitRates(): Promise<void> {
  if (!(await profitRatesFormRef.value?.validate().catch(() => false))) return
  try {
    await ElMessageBox.confirm('保存商品资金比例后，会同步影响所有仍在使用默认值的商品，确认继续吗？', '保存确认', { type: 'warning' })
    await store.saveProfitRatesConfig({
      promotionRate: fromDisplayFundRate(profitRatesForm.promotionRate),
      bonusPoolRate: fromDisplayFundRate(profitRatesForm.bonusPoolRate),
      remark: profitRatesForm.remark,
    })
    ElMessage.success('商品资金比例已保存')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error, '商品资金比例保存失败')
  }
}

async function saveWithdrawRules(): Promise<void> {
  if (!(await withdrawRulesFormRef.value?.validate().catch(() => false))) return
  try {
    await ElMessageBox.confirm('保存后会影响后续新提交的提现申请，确认继续吗？', '保存提现规则', { type: 'warning' })
    await store.saveWithdrawRulesConfig({ ...withdrawRulesForm, feeRate: withdrawRulesForm.feeRate / 100 })
    ElMessage.success('提现规则已保存')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error, '提现规则保存失败')
  }
}

function reload(): void {
  void loadDividendCap()
  void loadProfitRates()
  void loadWithdrawRules()
}

onMounted(reload)
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>业务设置</h1><p>管理本品牌的推广/红包比例、提现规则。各商户独立配置，仅影响本品牌。</p></div>
      <el-button :icon="Refresh" :loading="store.dividendCapLoading || store.profitRatesLoading || store.withdrawRulesLoading" @click="reload">刷新</el-button>
    </div>

    <div class="settings-grid">
      <section class="content-card setting-section">
        <div class="setting-heading"><div><h2>红包上限倍率</h2><p>设置新槽位使用的红包额度倍率。</p></div></div>
        <el-alert title="仅影响之后新开的槽位" type="warning" :closable="false" show-icon />
        <el-form ref="dividendCapFormRef" :model="dividendCapForm" :rules="dividendCapRules" label-width="90px" @submit.prevent="saveDividendCap">
          <el-form-item label="倍率" prop="multiplier"><el-input-number v-model="dividendCapForm.multiplier" :min="0.01" :max="100" :precision="2" :step="0.01" controls-position="right" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="dividendCapForm.remark" placeholder="可选" clearable /></el-form-item>
          <el-form-item><el-button type="primary" :loading="store.dividendCapSaving" @click="saveDividendCap">保存倍率</el-button></el-form-item>
        </el-form>
      </section>

      <section class="content-card setting-section fund-rate-section">
        <div class="setting-heading"><div><h2>商品资金默认比例</h2><p>商品未单独设置金额时，按最低 SKU 价格计算默认资金。</p></div></div>
        <el-alert title="影响所有默认值商品" description="前端按百分比输入，保存时自动换算为后端小数。商品未手动填写金额时会读取这里的默认比例，保存后会同步影响所有仍在使用默认值的商品。" type="info" :closable="false" show-icon />
        <el-form ref="profitRatesFormRef" class="profit-rates-form" :model="profitRatesForm" :rules="profitRatesRules" label-width="110px" @submit.prevent="saveProfitRates">
          <el-form-item label="推广资金比例" prop="promotionRate">
            <div class="rate-control">
              <el-input-number v-model="profitRatesForm.promotionRate" :min="0" :max="100" :precision="2" :step="0.1" controls-position="right" class="rate-input" />
              <span class="rate-suffix">%</span>
            </div>
          </el-form-item>
          <el-form-item label="红包奖池比例" prop="bonusPoolRate">
            <div class="rate-control">
              <el-input-number v-model="profitRatesForm.bonusPoolRate" :min="0" :max="100" :precision="2" :step="0.1" controls-position="right" class="rate-input" />
              <span class="rate-suffix">%</span>
            </div>
          </el-form-item>
          <el-form-item label="备注" class="remark-item">
            <el-input v-model="profitRatesForm.remark" class="rate-remark-input" placeholder="可选" clearable maxlength="40" show-word-limit />
          </el-form-item>
          <el-form-item class="form-item-full">
            <el-button type="primary" :loading="store.profitRatesSaving" @click="saveProfitRates">保存商品资金比例</el-button>
          </el-form-item>
        </el-form>
      </section>

      <section class="content-card setting-section withdraw-rules-section">
        <div class="setting-heading"><div><h2>提现规则</h2><p>控制后续提现申请的金额、次数、并行和手续费规则。</p></div></div>
        <el-alert title="规则只影响后续新提交的提现申请；提现审核通过不代表用户已经到账。" type="warning" :closable="false" show-icon />
        <el-form ref="withdrawRulesFormRef" class="withdraw-rules-form" :model="withdrawRulesForm" :rules="withdrawRulesRules" label-width="150px" @submit.prevent="saveWithdrawRules">
          <el-form-item label="普通用户最低提现" prop="minAmount"><el-input-number v-model="withdrawRulesForm.minAmount" :min="0" :precision="2" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="测试用户最低提现" prop="testUserMinAmount"><el-input-number v-model="withdrawRulesForm.testUserMinAmount" :min="0" :precision="2" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="每日累计上限" prop="dailyAmountLimit"><el-input-number v-model="withdrawRulesForm.dailyAmountLimit" :min="0" :precision="2" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="每日次数上限" prop="dailyCountLimit"><el-input-number v-model="withdrawRulesForm.dailyCountLimit" :min="1" :precision="0" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="最大并行笔数" prop="maxConcurrent"><el-input-number v-model="withdrawRulesForm.maxConcurrent" :min="1" :precision="0" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="冻结总额上限" prop="frozenLimit"><el-input-number v-model="withdrawRulesForm.frozenLimit" :min="0" :precision="2" controls-position="right" class="rule-number" /></el-form-item>
          <el-form-item label="手续费率" prop="feeRate"><div class="rate-control"><el-input-number v-model="withdrawRulesForm.feeRate" :min="0" :max="100" :precision="2" :step="0.1" controls-position="right" class="rule-number" /><span class="rate-suffix">%</span></div></el-form-item>
          <el-form-item label="测试用户 ID"><el-input-number v-model="withdrawRulesForm.testUserId" :min="1" :precision="0" controls-position="right" class="rule-number" placeholder="可选" /></el-form-item>
          <el-form-item label="测试用户跳过提现锁"><el-switch v-model="withdrawRulesForm.testSkipLock" active-text="开启" inactive-text="关闭" /></el-form-item>
          <el-form-item label="备注" class="rule-remark-item"><el-input v-model="withdrawRulesForm.remark" placeholder="可选" clearable maxlength="100" show-word-limit /></el-form-item>
          <el-form-item class="form-item-full"><el-button type="primary" :loading="store.withdrawRulesSaving" @click="saveWithdrawRules">保存提现规则</el-button></el-form-item>
        </el-form>
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.setting-section { margin-bottom: 0; padding: 20px; }
.setting-heading { margin-bottom: 20px; }
.setting-heading h2 { margin: 0 0 6px; color: var(--vben-text); font-size: 17px; }
.setting-heading p { margin: 0; color: var(--vben-muted); font-size: 13px; }
.setting-section :deep(.el-alert) { margin-bottom: 20px; }
.fund-rate-section { grid-column: 1 / -1; }
.withdraw-rules-section { grid-column: 1 / -1; }
.profit-rates-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  align-items: start;
}
.profit-rates-form :deep(.el-form-item) { min-width: 0; }
.profit-rates-form :deep(.el-form-item__content) { min-width: 0; }
.rate-control {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.rate-input { width: 150px; }
.rate-remark-input { width: min(100%, 280px); }
.remark-item { grid-column: 1 / -1; }
.form-item-full { grid-column: 1 / -1; }
.rate-suffix { color: var(--vben-muted); min-width: 18px; }
.withdraw-rules-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  align-items: start;
}
.withdraw-rules-form :deep(.el-form-item) { min-width: 0; }
.withdraw-rules-form :deep(.el-form-item__content) { min-width: 0; }
.rule-number { width: 180px; }
.rule-remark-item { grid-column: 1 / -1; }
@media (max-width: 760px) {
  .settings-grid,
  .profit-rates-form,
  .withdraw-rules-form { grid-template-columns: 1fr; }
  .remark-item,
  .rule-remark-item,
  .form-item-full { grid-column: auto; }
  .rate-input,
  .rate-remark-input,
  .rule-number { width: 100%; max-width: none; }
}
</style>
