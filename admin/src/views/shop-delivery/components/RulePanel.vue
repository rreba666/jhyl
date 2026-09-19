<script setup lang="ts">
/**
 * 配送规则面板（只读）。
 *
 * ⚠️ 口径（2026-09-19 按后端 `V1.21` 校正，原来的提示文案是错的）：
 * - **配送费**（`feeType` / `feeConfig`）**只能由平台设置**，商家改不了 → 写入口在
 *   「同城配送管理 → 配送费配置」（`POST /api/admin/delivery/fee-config`），本面板回显的是**平台当前生效值**；
 * - **其余规则**（范围 / 起送额 / 营业时段 / 时效 / 取消扣费 / 凭证 / 收货码）后端口径是「**商家可配**」
 *   （`POST /api/merchant/delivery/rules`），但那是 **C 端商家身份**的接口；
 *   后台侧 `GET /api/admin/delivery/my/rules` **只有只读**，所以这里也改不了
 *   —— 要在后台代商家改，需要后端补 admin 侧写接口。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { getMyRules, type DeliveryRule } from '@/api/shop-delivery'
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

/** 开关类字段（0/1）转文案。 */
function onOff(value?: number | null): string {
  if (value == null) return '—'
  return value === 1 ? '开启' : '关闭'
}

async function loadRule(): Promise<void> {
  // 未选门店时不请求（平台账号调 my/** 会返回 1000「请指定门店」）
  if (!props.shopId) {
    rule.value = null
    return
  }
  loading.value = true
  try {
    rule.value = await getMyRules(props.shopId || undefined)
  } catch (error) {
    rule.value = null
    ElMessage.error(error instanceof Error ? error.message : '配送规则查询失败')
  } finally {
    loading.value = false
  }
}

watch(() => props.shopId, () => { void loadRule() })
onMounted(() => { void loadRule() })

defineExpose({ loadRule })
</script>

<template>
  <el-card shadow="never" class="content-card" v-loading="loading">
    <el-alert
      title="配送费由平台统一设置（商家不可改）；其余规则后端目前只提供商家侧写入接口，本面板为只读视图。"
      type="info"
      :closable="false"
      show-icon
      class="tip"
    />
    <div v-if="canEditFee" class="tip-actions">
      <el-button size="small" type="primary" plain @click="goFeeConfig">去「配送费配置」修改配送费</el-button>
    </div>
    <el-descriptions v-if="rule" :column="2" border>
      <el-descriptions-item label="配送启用">{{ onOff(rule.enabled) }}</el-descriptions-item>
      <el-descriptions-item label="最远配送距离">{{ rule.maxDistanceKm != null ? `${rule.maxDistanceKm} km` : '—' }}</el-descriptions-item>
      <el-descriptions-item label="起送金额">{{ rule.minOrderAmount != null ? `¥ ${Number(rule.minOrderAmount).toFixed(2)}` : '—' }}</el-descriptions-item>
      <el-descriptions-item label="计费方式">{{ feeTypeLabel(rule.feeType) }}</el-descriptions-item>
      <el-descriptions-item label="运费配置(feeConfig)" :span="2">{{ rule.feeConfig || '—' }}</el-descriptions-item>
      <el-descriptions-item label="营业时间">{{ rule.businessHours || '—' }}</el-descriptions-item>
      <el-descriptions-item label="取消扣费政策">{{ rule.cancelFeePolicy || '—' }}</el-descriptions-item>
      <el-descriptions-item label="预计备货时长">{{ rule.estimatedPrepareMinutes != null ? `${rule.estimatedPrepareMinutes} 分钟` : '—' }}</el-descriptions-item>
      <el-descriptions-item label="预计配送时长">{{ rule.estimatedDeliveryMinutes != null ? `${rule.estimatedDeliveryMinutes} 分钟` : '—' }}</el-descriptions-item>
      <el-descriptions-item label="收货码">{{ onOff(rule.pickupCodeEnabled) }}</el-descriptions-item>
      <el-descriptions-item label="凭证类型">{{ rule.proofTypes || '—' }}</el-descriptions-item>
      <el-descriptions-item label="优惠券">{{ onOff(rule.couponEnabled) }}</el-descriptions-item>
      <el-descriptions-item label="补贴">{{ onOff(rule.subsidyEnabled) }}</el-descriptions-item>
    </el-descriptions>
    <el-empty v-else-if="!loading" description="暂无配送规则配置" />
  </el-card>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.tip { margin-bottom: 12px; }
.tip-actions { margin-bottom: 16px; }
</style>
