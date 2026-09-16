<script setup lang="ts">
/**
 * 配送规则面板（只读）：配送费与规则由平台统一设置，商家端不可修改。
 */
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getMyRules, type DeliveryRule } from '@/api/shop-delivery'
import { feeTypeLabel } from '@/utils/deliveryStatus'

const props = defineProps<{ shopId: string }>()

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
      title="配送规则与配送费由平台统一设置，商家端只读；如需调整请联系平台运营。"
      type="info"
      :closable="false"
      show-icon
      class="tip"
    />
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
.tip { margin-bottom: 16px; }
</style>
