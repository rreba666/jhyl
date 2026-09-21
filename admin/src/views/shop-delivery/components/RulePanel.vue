<script setup lang="ts">
/**
 * 配送规则面板（**可编辑** —— 2026-09-21 起，此前是只读视图）。
 *
 * ⚠️ **口径变更（后端 V1.22）**，旧注释已作废：
 * 旧口径是「门店配送规则只能由平台设置、后台只读」，但平台侧**当时并没有写接口**、
 * 商家端也没有「配送设置」页 —— 结果是**两端都没有入口**：新入驻门店 `delivery_rules`
 * 无记录、`enabled=0`，C 端结算页不列出该店，**同城单根本下不进来**。
 * 现在平台侧补了写接口 `POST /api/admin/delivery/my/rules`（即本面板）。
 *
 * **仍然只读的两项**（刻意不在本面板编辑，避免出现两个互相打架的入口）：
 * - **配送费**（`feeType` / `feeConfig`）：业务口径是**平台统一配置**，写入口在
 *   「同城配送管理 → 配送费配置」（`POST /api/admin/delivery/fee-config`）—— 本面板只读展示 + 直达按钮；
 * - `couponEnabled` / `subsidyEnabled`：V1 占位开关，**后端禁止传 true**（传了报 `1000`）→ **不提交**这两个字段。
 *
 * **保存语义**（`api_doc` 原文）：upsert（无则创建、有则更新）；**未传字段 = 保持不变**
 * （`null` 表示"不改"，不是"改回默认值"）；返回保存后的完整规则对象，**可直接回填、无需二次拉取**。
 * 本表单**每次都提交全部可编辑字段**（不做局部保存），这样无论后端对缺省字段怎么处理都不会误改。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { getMyRules, saveMyRules, type DeliveryRule, type RuleSaveDTO } from '@/api/shop-delivery'
import { feeTypeLabel } from '@/utils/deliveryStatus'
import { useAuthStore } from '@/stores/auth'
import { canAccess } from '@/utils/permission'
import type { AdminRole } from '@/types/auth'

const props = defineProps<{ shopId: string }>()
const router = useRouter()
const auth = useAuthStore()

/** 只有能进「同城配送管理」的角色（超管 / 客服）才给配送费设置的直达入口。 */
const canEditFee = computed(() => canAccess(auth.role as AdminRole, '/delivery'))

/** 跳「同城配送管理 → 配送费配置」（`?tab=fee` 由该页的 watch 处理）。 */
function goFeeConfig(): void {
  router.push({ path: '/delivery', query: { tab: 'fee' } })
}

const rule = ref<DeliveryRule | null>(null)
const loading = ref(false)
const saving = ref(false)

/** 表单模型：只放**可编辑**字段（配送费与两个占位开关不进表单）。 */
interface RuleForm {
  enabled: number
  maxDistanceKm: number
  minOrderAmount: number
  estimatedPrepareMinutes: number
  estimatedDeliveryMinutes: number
  pickupCodeEnabled: number
  proofTypes: string
  cancelFeePolicy: string
}

const form = ref<RuleForm>({
  enabled: 0,
  maxDistanceKm: 10,
  minOrderAmount: 0,
  estimatedPrepareMinutes: 10,
  estimatedDeliveryMinutes: 20,
  pickupCodeEnabled: 0,
  proofTypes: 'PHOTO',
  cancelFeePolicy: '',
})

/** 营业时段（`el-time-picker is-range` + `value-format="HH:mm"` → `['09:00','22:00']`）。 */
const timeRange = ref<[string, string] | null>(null)

/** 开关类字段（0/1）转文案（只读展示用）。 */
function onOff(value?: number | null): string {
  if (value == null) return '—'
  return value === 1 ? '开启' : '关闭'
}

/** 把 `HH:mm` / `H:mm` 归一成两位小时（后端存的是 `09:00` 这种）。 */
function normalizeClock(value: string): string {
  const matched = /^(\d{1,2}):(\d{2})/.exec(String(value).trim())
  return matched ? `${matched[1].padStart(2, '0')}:${matched[2]}` : String(value).trim()
}

/**
 * 解析后端下发的 `businessHours`，兼容两种形态：
 * - **JSON 串**（后端实际存的就是这个，注意 `{"end": "22:00", "start": "09:00"}` 里带空格）：
 *   `{"start":"09:00","end":"22:00"}`；
 * - **字符串简写**：`09:00-22:00`（契约说这种写法后端也接受）。
 * 解析不出来时返回 `null`，提示用户重填（而不是静默清空后覆盖掉线上的值）。
 */
function parseBusinessHours(raw?: string | null): [string, string] | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as { start?: string; end?: string }
      if (obj.start && obj.end) return [normalizeClock(obj.start), normalizeClock(obj.end)]
    } catch {
      // 落到下面的简写分支
    }
  }
  const matched = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(text)
  if (matched) return [normalizeClock(matched[1]), normalizeClock(matched[2])]
  return null
}

/** 用接口返回的规则对象回填表单（保存成功后也走它，契约保证返回的是完整对象）。 */
function fillForm(data: DeliveryRule | null): void {
  rule.value = data
  if (!data) {
    timeRange.value = null
    return
  }
  form.value = {
    enabled: Number(data.enabled) === 1 ? 1 : 0,
    maxDistanceKm: Number(data.maxDistanceKm ?? 10),
    minOrderAmount: Number(data.minOrderAmount ?? 0),
    estimatedPrepareMinutes: Number(data.estimatedPrepareMinutes ?? 10),
    estimatedDeliveryMinutes: Number(data.estimatedDeliveryMinutes ?? 20),
    pickupCodeEnabled: Number(data.pickupCodeEnabled) === 1 ? 1 : 0,
    proofTypes: String(data.proofTypes ?? 'PHOTO'),
    cancelFeePolicy: String(data.cancelFeePolicy ?? ''),
  }
  timeRange.value = parseBusinessHours(data.businessHours)
  // 解析不出来时明确告知（否则用户一保存就会把线上的营业时段覆盖成空）
  if (String(data.businessHours ?? '').trim() && !timeRange.value) {
    ElMessage.warning(`营业时段格式无法识别（原值：${data.businessHours}），请重新选择后再保存`)
  }
}

async function loadRule(): Promise<void> {
  // 未选门店时不请求（平台账号调 my/** 会返回 1000「请指定门店」；商户管理员可省略）
  if (!props.shopId) {
    rule.value = null
    return
  }
  loading.value = true
  try {
    fillForm(await getMyRules(props.shopId || undefined))
  } catch (error) {
    rule.value = null
    ElMessage.error(error instanceof Error ? error.message : '配送规则查询失败')
  } finally {
    loading.value = false
  }
}

/** `cancelFeePolicy` 若不是合法 JSON 就不要提交（后端存的是 JSON 列，脏字符串会留下隐患）。 */
function isJsonTextValid(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  if (!props.shopId) {
    ElMessage.warning('请先选择门店')
    return
  }
  if (timeRange.value && (!timeRange.value[0] || !timeRange.value[1])) {
    ElMessage.warning('营业时段需要同时选择开始与结束时间')
    return
  }
  if (!isJsonTextValid(form.value.cancelFeePolicy)) {
    ElMessage.warning('「取消扣费政策」需要是合法 JSON（留空表示不设置）')
    return
  }

  const payload: RuleSaveDTO = {
    enabled: form.value.enabled,
    maxDistanceKm: form.value.maxDistanceKm,
    minOrderAmount: form.value.minOrderAmount,
    estimatedPrepareMinutes: form.value.estimatedPrepareMinutes,
    estimatedDeliveryMinutes: form.value.estimatedDeliveryMinutes,
    pickupCodeEnabled: form.value.pickupCodeEnabled,
    proofTypes: form.value.proofTypes.trim(),
    // 营业时段按契约推荐写法交 **JSON 串**；整个清空时交空串（表示"不设置时段"）
    businessHours: timeRange.value ? JSON.stringify({ start: timeRange.value[0], end: timeRange.value[1] }) : '',
    // 留空交空串（而不是不传）——"不传"的语义是"保持不变"，会把旧值留在库里
    cancelFeePolicy: form.value.cancelFeePolicy.trim(),
    // ⚠️ 刻意不提交 couponEnabled / subsidyEnabled：V1 占位开关，后端禁止传 true（会报 1000）
  }

  saving.value = true
  try {
    const saved = await saveMyRules(props.shopId, payload)
    fillForm(saved)
    ElMessage.success(form.value.enabled === 1 ? '已保存：该店现在可以被用户端选为同城配送门店' : '已保存：该店已关闭同城配送')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配送规则保存失败')
  } finally {
    saving.value = false
  }
}

watch(() => props.shopId, () => { void loadRule() })
onMounted(() => { void loadRule() })

defineExpose({ loadRule })
</script>

<template>
  <el-card shadow="never" class="content-card" v-loading="loading">
    <el-alert v-if="!shopId" title="请先在上方选择门店（平台账号查/改门店规则必须指定门店）。" type="warning" :closable="false" show-icon class="tip" />
    <template v-else>
      <el-alert
        title="这里改的是「本店同城配送规则」。启用后该店才会出现在用户端同城配送的可选门店里 —— 新入驻门店默认是关闭的。"
        type="info"
        :closable="false"
        show-icon
        class="tip"
      />

      <el-form v-if="rule || !loading" label-width="150px" class="rule-form">
        <el-divider content-position="left">同城配送开关</el-divider>
        <el-form-item label="开放同城配送">
          <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" active-text="开启" inactive-text="关闭" />
          <span class="form-hint">开启后，该店会出现在用户端结算页的「同城配送 · 发货门店」列表里</span>
        </el-form-item>

        <el-divider content-position="left">配送范围与门槛</el-divider>
        <el-form-item label="最远配送距离">
          <el-input-number v-model="form.maxDistanceKm" :min="0.1" :max="100" :step="1" :precision="1" />
          <span class="form-hint">公里；用户收货地址超出该距离则不可下单</span>
        </el-form-item>
        <el-form-item label="起送金额">
          <el-input-number v-model="form.minOrderAmount" :min="0" :max="100000" :precision="2" :step="10" />
          <span class="form-hint">元；未达起送额的订单不允许提交</span>
        </el-form-item>
        <el-form-item label="营业时段">
          <el-time-picker
            v-model="timeRange"
            is-range
            format="HH:mm"
            value-format="HH:mm"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            clearable
          />
          <span class="form-hint">留空表示不限制时段</span>
        </el-form-item>

        <el-divider content-position="left">履约时效</el-divider>
        <el-form-item label="预计备货时长">
          <el-input-number v-model="form.estimatedPrepareMinutes" :min="0" :max="600" :step="5" />
          <span class="form-hint">分钟</span>
        </el-form-item>
        <el-form-item label="预计配送时长">
          <el-input-number v-model="form.estimatedDeliveryMinutes" :min="0" :max="600" :step="5" />
          <span class="form-hint">分钟</span>
        </el-form-item>

        <el-divider content-position="left">收货码与凭证</el-divider>
        <el-form-item label="收货码">
          <el-switch v-model="form.pickupCodeEnabled" :active-value="1" :inactive-value="0" active-text="开启" inactive-text="关闭" />
          <span class="form-hint">开启后：用户下单拿到收货码，骑手送达前**必须核销**该码</span>
        </el-form-item>
        <el-form-item label="送达凭证类型">
          <el-input v-model="form.proofTypes" placeholder="如 PHOTO（多个用逗号分隔）" style="width: 260px" />
          <span class="form-hint">骑手送达时需上传的凭证类型</span>
        </el-form-item>
        <el-form-item label="取消扣费政策">
          <el-input v-model="form.cancelFeePolicy" type="textarea" :rows="2" placeholder="JSON 串，留空表示不设置" />
        </el-form-item>

        <el-divider content-position="left">以下由平台统一设置（本面板只读）</el-divider>
        <el-form-item label="计费方式">{{ feeTypeLabel(rule?.feeType) }}</el-form-item>
        <el-form-item label="运费配置(feeConfig)">{{ rule?.feeConfig || '—' }}</el-form-item>
        <el-form-item label="优惠券">{{ onOff(rule?.couponEnabled) }}<span class="form-hint">V1 占位开关，暂不支持开启</span></el-form-item>
        <el-form-item label="平台补贴">{{ onOff(rule?.subsidyEnabled) }}<span class="form-hint">V1 占位开关，暂不支持开启</span></el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
          <el-button :disabled="saving" @click="loadRule">重置</el-button>
          <el-button v-if="canEditFee" plain @click="goFeeConfig">去「配送费配置」修改配送费</el-button>
        </el-form-item>
      </el-form>
    </template>
  </el-card>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.tip { margin-bottom: 12px; }
.rule-form { max-width: 760px; }
.form-hint { margin-left: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
