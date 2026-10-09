<script setup lang="ts">
/**
 * 「强制完成同城订单」弹窗 —— **两处入口共用的唯一实现**（2026-10-08 新增，2026-10-08 抽共享）。
 *
 * 调用方（都只负责"哪一行能点"，不再各写一份状态/校验/文案）：
 * 1. 平台：「同城配送管理 → 同城订单」Tab（`views/delivery/index.vue`）——**不传 `shopId`**，
 *    由本组件逐行取 `row.shopId`（平台岗不传会 `1000 请指定门店`）；
 * 2. 商户：「配送工作台 → 同城订单」面板（`views/shop-delivery/components/OrderPanel.vue`）——
 *    传本店 `shopId`（单门店，后端可按登录身份兜底）。
 *
 * ## 必须守住的约束（文档要求，改这个文件时逐条对照）
 * - **只在同城已送达单上给入口**：`deliveryStatus === 'DELIVERED'`（同级约束"同城"由数据源保证 ——
 *   两个调用方的表格分别是 `/api/admin/delivery/my/orders` 与 `/api/admin/delivery/orders`，
 *   都是**同城单**，物流单不在其中；`DeliveryOrderView` 没有 `pickupType` 字段，故不做字段级判断）。
 *   其它状态后端一律 `13003`，给了按钮就是让运营白点。
 * - **`reason` 必填**：进中央留痕 `operation=ORDER_FORCE_COMPLETE`，前端先拦（避免必然失败的请求）。
 * - **不会立刻给商家打钱**：弹窗上必须常显 `FORCE_COMPLETE_HINT`（资金仍按结算释放期入账）。
 * - **角色**：`SUPER_ADMIN` / `ADMIN` / `CUSTOMER_SERVICE` 可见，`FINANCE` 不可见 ——
 *   这一层由**路由/菜单矩阵**把关（`utils/permission.ts` 的 `ROLE_ROUTES`：`/delivery` 给
 *   超管 + 客服、`/shop-delivery` 给超管 + 商户管理员，两个 path 都**不在 FINANCE 的列表**里），
 *   所以财务根本进不到这两个页面，本组件不必再做角色判断。
 * - **平台岗必须带 `shopId`**；取不到时**如实拦下**（不猜一个门店传过去 —— 那就是伪造数据）。
 *
 * ⚠️ 接口层 `forceCompleteMyOrder(shopId, orderNo, reason, requestId?)` 的 `requestId`（幂等键）保持原样。
 */
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { DeliveryOrderView } from '@/api/delivery'
import { forceCompleteMyOrder } from '@/api/shop-delivery'
import { FORCE_COMPLETE_HINT } from '@/utils/deliveryStatus'

const props = withDefaults(
  defineProps<{
    /**
     * 本店 `shopId`（商户端单门店由调用方传；**可留空** = 不传该 query，后端按登录身份兜底）。
     * 平台页**不传**（留空）：平台账号没有"我的门店"，必须逐行取 `row.shopId`。
     */
    shopId?: string
    /** 弹窗标题（两处入口文案不同，默认沿用平台页）。 */
    title?: string
    /** 弹窗宽度（两处入口不同，默认沿用平台页）。 */
    width?: string
  }>(),
  { shopId: '', title: '强制完成同城订单', width: '580px' },
)

/** 提交结束（成功或失败）后通知调用方刷新列表 —— 失败也要刷新，状态可能已被他方推进。 */
const emit = defineEmits<{ done: [] }>()

const visible = ref(false)
/** 提交中（按钮 loading）。 */
const forcing = ref(false)
/** 弹窗表单：`reason` **必填**，进中央留痕 `ORDER_FORCE_COMPLETE`。 */
const form = reactive<{ orderNo: string; shopId: string; reason: string }>({ orderNo: '', shopId: '', reason: '' })

/**
 * 打开弹窗（调用方在 `DELIVERED` 分支里调）。
 *
 * ⚠️ **`shopId` 必须带上**：本接口虽然叫 `my/orders/**`，但**平台岗（超管/客服）不传
 *    `1000 请指定门店`** —— 平台账号没有"我的门店"这个概念。平台页逐行取 `row.shopId`
 *    （`DeliveryOrderView.shopId` = **门店 id**；筛选框选「全部门店」时是合并视图，逐行取才准确），
 *    商户页用调用方传入的本店 `shopId`。
 * ⚠️ 取不到 `shopId` 时**如实拦下**（不猜一个门店传过去 —— 那就是伪造数据）。
 */
function open(row: DeliveryOrderView): void {
  if (!row.orderNo) return
  const rowShopId = row.shopId === undefined || row.shopId === null ? '' : String(row.shopId)
  const shopId = props.shopId || rowShopId
  if (!shopId) {
    ElMessage.warning('该行没有门店信息（shopId 为空），无法强制完成；请按门店筛选后再操作')
    return
  }
  form.orderNo = row.orderNo
  form.shopId = shopId
  form.reason = ''
  visible.value = true
}

/** 提交强制完成（原因必填；成功/失败都要通知调用方刷新）。 */
async function submit(): Promise<void> {
  const reason = form.reason.trim()
  if (!reason) {
    ElMessage.warning('请填写强制完成的原因（会记入中央留痕）')
    return
  }
  forcing.value = true
  try {
    await forceCompleteMyOrder(form.shopId || undefined, form.orderNo, reason)
    ElMessage.success('已强制完成；资金仍按结算释放期入账，不是立即打款')
    visible.value = false
  } catch (error) {
    // ⚠️ 业务态（13003 状态已变化 / 1404 非同行单 / 1004 越权）原样带出后端 message，不吞成"系统繁忙"
    ElMessage.error(error instanceof Error ? error.message : '强制完成失败')
  } finally {
    forcing.value = false
    emit('done')
  }
}

defineExpose({ open })
</script>

<template>
  <el-dialog v-model="visible" :title="title" :width="width" append-to-body>
    <!-- ⚠️ 文档要求「必须让运营知道的两件事」：① 不会立刻给商家打钱；② 原因必填且留痕。
         ⛔ 不要为了版面好看把它换成 tooltip 或精简掉 —— 第 1 条防"运营以为点完钱就到账"，第 2 条防"随手点、事后无从追责"。 -->
    <el-alert type="warning" :closable="false" show-icon class="tip" :title="FORCE_COMPLETE_HINT" />
    <el-form label-width="90px" size="small">
      <el-form-item label="订单号"><el-input v-model="form.orderNo" disabled /></el-form-item>
      <!-- ⚠️ 只有平台页（未传 `shopId` prop）才显示「门店 ID」：商户端是单门店，多一行无用信息。 -->
      <el-form-item v-if="!shopId" label="门店 ID"><el-input v-model="form.shopId" disabled /></el-form-item>
      <el-form-item label="完成原因" required>
        <el-input
          v-model="form.reason"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="请写清核实依据，例如：电话核实已妥投（会记入中央留痕）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="forcing" @click="submit">确认强制完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tip { margin-bottom: 12px; }
</style>
