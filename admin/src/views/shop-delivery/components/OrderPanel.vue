<script setup lang="ts">
/**
 * 本店同城订单面板：**商户侧完整处理流**
 * WAIT_ACCEPT 接单/拒单 → ACCEPTED 开始备货 → PREPARING 备货完成 → WAIT_ASSIGN **安排配送**（三选一）
 * → 配送中查看进度；CANCEL_REQUESTED 审核用户取消申请。
 *
 * 接口：`/api/admin/delivery/my/orders`（列表）、`/api/admin/order/{orderNo}/accept|prepare|ready|reject`（流转）、
 * `/api/admin/delivery/my/tasks`（安排配送=创建配送任务）；平台账号调流转接口必须带 `shopId`。
 */
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { resumeTask, type DeliveryOrderView } from '@/api/delivery'
import {
  acceptMyOrder,
  auditMyCancel,
  createMyTask,
  getMyOrders,
  getMyStaff,
  prepareMyOrder,
  readyMyOrder,
  rejectMyOrder,
  type DeliveryStaff,
} from '@/api/shop-delivery'
import { ASSIGNMENT_TYPE_LABELS, DELIVERY_STATUS_OPTIONS, deliveryStatusLabel, deliveryStatusTagType } from '@/utils/deliveryStatus'

const props = defineProps<{ shopId: string }>()
/** 安排配送成功后通知父级刷新「配送任务」面板。 */
const emit = defineEmits<{ dispatched: [] }>()

const orders = ref<DeliveryOrderView[]>([])
const loading = ref(false)
const acting = ref(false)
/** 「异常恢复」进行中（按钮 loading）。 */
const resuming = ref(false)
const filters = reactive<{ deliveryStatus: string }>({ deliveryStatus: '' })
/** 本店配送员（「指定配送员」用下拉，避免手输 staffId）。 */
const staff = ref<DeliveryStaff[]>([])

async function loadOrders(): Promise<void> {
  // 未选门店时不请求：平台账号调 my/** 会返回 1000「请指定门店」
  if (!props.shopId) {
    orders.value = []
    return
  }
  loading.value = true
  try {
    orders.value = await getMyOrders(props.shopId || undefined, filters.deliveryStatus || undefined)
  } catch (error) {
    orders.value = []
    ElMessage.error(error instanceof Error ? error.message : '本店同城订单查询失败')
  } finally {
    loading.value = false
  }
}

/** 拉取本店配送员（失败静默，不影响订单操作）。 */
async function loadStaff(): Promise<void> {
  try {
    staff.value = await getMyStaff(props.shopId || undefined)
  } catch {
    staff.value = []
  }
}

// ===== 订单流转（接单 → 开始备货 → 备货完成） =====

/** 执行流转动作并按状态给出中文成功提示。 */
async function flow(row: DeliveryOrderView, action: 'accept' | 'prepare' | 'ready'): Promise<void> {
  if (!row.orderNo || acting.value) return
  const successText = { accept: '已接单', prepare: '已开始备货', ready: '备货完成，可以安排配送了' }[action]
  acting.value = true
  try {
    if (action === 'accept') await acceptMyOrder(props.shopId || undefined, row.orderNo)
    else if (action === 'prepare') await prepareMyOrder(props.shopId || undefined, row.orderNo)
    else await readyMyOrder(props.shopId || undefined, row.orderNo)
    ElMessage.success(successText)
    await loadOrders()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '订单操作失败')
  } finally {
    acting.value = false
  }
}

/**
 * 拒单（必填原因，触发全额原路退款）。
 *
 * ⚠️⚠️ 2026-09-25 按《秒退与退款口径》§7 调整：后端已改为**先校验退款可行性，再改状态** ——
 * 退款不可行时（支付超 7 天退款窗 / 未支付 / 金额异常）**拒单本身被拒绝**，
 * 订单**保持 `WAIT_ACCEPT` 不变**，返回业务错误（如 `ORDER_REFUND_EXPIRED`）；
 * 状态被他方推进仍返回 `13007`。以前是"拒单成功但退款只打日志"，会留下
 * "订单已取消、货不送、**钱没退**"的坏账。
 *
 * 因此失败分支必须做到三件事：
 * ① 把后端 `message` **原样带出**（不能吞成笼统的"拒单失败"），并提示联系客服；
 * ② **失败后也要刷新订单** —— 退款不可行时订单仍是「待接单」，商家要继续处理，
 *    界面不能停在"已拒单"的假象；
 * ③ 提示**不要重试**（这类失败重试也不会成功）。
 *
 * 顺带修掉一个隐患：原来 `loadOrders()` 与提交写在同一个 `try` 里，
 * 于是"拒单已成功、只是列表刷新失败"会被 `catch` 报成"拒单失败"（误导商家重复操作）。
 * 现在把取原因 / 提交 / 刷新分成三段，各自处理错误。
 */
async function rejectOrder(row: DeliveryOrderView): Promise<void> {
  if (!row.orderNo) return

  // ① 取拒单原因：`ElMessageBox.prompt` 取消/关闭时抛出的是字符串，不是失败
  let reason = ''
  try {
    const result = await ElMessageBox.prompt('拒单将触发全额原路退款，请填写拒单原因', '拒单', {
      inputPattern: /\S+/,
      inputErrorMessage: '请填写拒单原因',
      type: 'warning',
    })
    reason = result.value
  } catch {
    return
  }

  // ② 提交拒单：只有这里才代表"拒单失败"
  try {
    await rejectMyOrder(props.shopId || undefined, row.orderNo, reason)
    ElMessage.success('已拒单并触发退款')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // 业务态（如 ORDER_REFUND_EXPIRED）用 warning + 原样 message；不用 error 以免被当成系统故障
    ElMessage.warning(message ? `该订单无法拒单：${message}，请联系客服处理` : '拒单失败，请稍后重试')
  }

  // ③ 成功/失败都要刷新（失败时订单可能仍是待接单）；刷新失败不覆盖上面的结果提示
  try {
    await loadOrders()
  } catch {
    /* 列表刷新失败无需额外提示：结果提示已经给出，商家可手动刷新 */
  }
}

// ===== 安排配送（创建配送任务，三选一） =====

const dispatchVisible = ref(false)
const dispatching = ref(false)
const dispatchForm = reactive<{ orderNo: string; assignmentType: string; deliveryPersonId: string }>({
  orderNo: '',
  assignmentType: 'MERCHANT_SELF',
  deliveryPersonId: '',
})

/** 打开安排配送弹窗（带入当前订单号，并预载配送员列表）。 */
async function openDispatch(row: DeliveryOrderView): Promise<void> {
  if (!row.orderNo) return
  dispatchForm.orderNo = row.orderNo
  dispatchForm.assignmentType = 'MERCHANT_SELF'
  dispatchForm.deliveryPersonId = ''
  dispatchVisible.value = true
  void loadStaff()
}

/** 提交安排配送：创建配送任务（商家自送 / 指定配送员 / 发布领取）。 */
async function submitDispatch(): Promise<void> {
  if (dispatchForm.assignmentType === 'ASSIGN_TO_PERSON' && !dispatchForm.deliveryPersonId) {
    ElMessage.warning('请选择配送员')
    return
  }
  dispatching.value = true
  try {
    const taskNo = await createMyTask(props.shopId || undefined, {
      orderNo: dispatchForm.orderNo,
      assignmentType: dispatchForm.assignmentType,
      deliveryPersonId: dispatchForm.assignmentType === 'ASSIGN_TO_PERSON' ? dispatchForm.deliveryPersonId : undefined,
    })
    ElMessage.success(taskNo ? `已安排配送，任务号 ${taskNo}` : '已安排配送')
    dispatchVisible.value = false
    await loadOrders()
    emit('dispatched') // 让「配送任务」面板刷新
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '安排配送失败')
  } finally {
    dispatching.value = false
  }
}

/** 审核用户取消申请。 */
async function audit(row: DeliveryOrderView, approve: boolean): Promise<void> {
  if (!row.orderNo) return
  try {
    const result = await ElMessageBox.prompt(
      approve ? '同意取消将按订单快照的取消政策扣费后退款，请输入备注（可选）' : '驳回后恢复取消申请前的履约状态，请输入驳回原因',
      approve ? '同意取消' : '驳回取消',
      { inputPattern: approve ? /.*/ : /\S+/, inputErrorMessage: '请填写驳回原因', type: 'warning' },
    )
    await auditMyCancel(props.shopId || undefined, row.orderNo, approve, result.value || undefined)
    ElMessage.success(approve ? '已同意取消并退款' : '已驳回取消申请')
    await loadOrders()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '取消申请审核失败')
  }
}

/**
 * 「配送异常」订单恢复（`EXCEPTION → 异常前状态`）。
 * 2026-09-17 后端已在订单视图返回 `taskId`，直接用平台端 resume（不再按 orderNo 反查任务）。
 */
async function resumeException(row: DeliveryOrderView): Promise<void> {
  const taskId = row.taskId
  if (!taskId) {
    ElMessage.warning('该订单没有关联的配送任务，无法恢复')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把订单 ${row.orderNo || ''} 的配送任务从「配送异常」恢复到异常前的节点，骑手可继续履约。确认恢复吗？`,
      '异常恢复',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  resuming.value = true
  try {
    await resumeTask(taskId)
    ElMessage.success('已恢复配送（任务回到异常前的节点）')
    await loadOrders()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '异常恢复失败')
  } finally {
    resuming.value = false
  }
}

watch(() => props.shopId, () => { void loadOrders() })
onMounted(() => { void loadOrders() })

defineExpose({ loadOrders })
</script>

<template>
  <el-card shadow="never" class="content-card">
    <el-alert
      title="同城订单处理顺序：接单 → 开始备货 → 备货完成 → 安排配送（商家自送 / 指定配送员 / 发布领取）。只有「备货完成」的订单才能安排配送。"
      type="info"
      :closable="false"
      show-icon
      class="tip"
    />
    <el-form inline @submit.prevent="loadOrders">
      <el-form-item label="配送状态">
        <el-select v-model="filters.deliveryStatus" clearable placeholder="全部" style="width: 180px">
          <el-option v-for="item in DELIVERY_STATUS_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="loadOrders">查询</el-button>
        <el-button :loading="loading" @click="loadOrders">刷新</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="orders" border size="small" max-height="560">
      <el-table-column prop="orderNo" label="订单号" min-width="170" />
      <el-table-column label="配送状态" width="140">
        <template #default="{ row }">
          <el-tag :type="deliveryStatusTagType(row.deliveryStatus)" effect="light">{{ deliveryStatusLabel(row.deliveryStatus) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="receiverName" label="收货人" width="110" />
      <el-table-column prop="receiverPhone" label="电话" width="130" />
      <el-table-column prop="receiverAddress" label="收货地址" min-width="220" />
      <el-table-column label="商品额" width="100"><template #default="{ row }">¥ {{ Number(row.goodsAmount || 0).toFixed(2) }}</template></el-table-column>
      <el-table-column label="配送费" width="100"><template #default="{ row }">¥ {{ Number(row.deliveryFee || 0).toFixed(2) }}</template></el-table-column>
      <el-table-column label="实付" width="100"><template #default="{ row }">¥ {{ Number(row.payAmount || 0).toFixed(2) }}</template></el-table-column>
      <el-table-column prop="createTime" label="下单时间" min-width="170" />
      <!-- 操作：按配送状态给下一步动作，避免商家不知道点哪里 -->
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <div class="operator-actions">
            <!-- 待接单：接单 / 拒单 -->
            <template v-if="row.deliveryStatus === 'WAIT_ACCEPT'">
              <el-button size="small" type="primary" :loading="acting" @click="flow(row, 'accept')">接单</el-button>
              <el-button size="small" type="danger" plain @click="rejectOrder(row)">拒单</el-button>
            </template>
            <!-- 已接单：开始备货 -->
            <template v-else-if="row.deliveryStatus === 'ACCEPTED'">
              <el-button size="small" type="primary" :loading="acting" @click="flow(row, 'prepare')">开始备货</el-button>
            </template>
            <!-- 备货中：备货完成（→ 待安排配送） -->
            <template v-else-if="row.deliveryStatus === 'PREPARING'">
              <el-button size="small" type="primary" :loading="acting" @click="flow(row, 'ready')">备货完成</el-button>
            </template>
            <!-- 待安排配送：安排配送（商家自送 / 指定配送员 / 发布领取） -->
            <template v-else-if="row.deliveryStatus === 'WAIT_ASSIGN'">
              <el-button size="small" type="success" @click="openDispatch(row)">安排配送</el-button>
            </template>
            <!-- 取消申请：同意 / 驳回 -->
            <template v-else-if="row.deliveryStatus === 'CANCEL_REQUESTED'">
              <el-button size="small" type="danger" plain @click="audit(row, true)">同意取消</el-button>
              <el-button size="small" @click="audit(row, false)">驳回</el-button>
            </template>
            <!-- 配送异常：骑手上报后任务卡在 EXCEPTION，恢复后回到异常前的节点继续履约 -->
            <template v-else-if="row.deliveryStatus === 'EXCEPTION'">
              <el-button size="small" type="warning" plain :loading="resuming" @click="resumeException(row)">异常恢复</el-button>
            </template>
            <span v-else class="muted">无需操作</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 安排配送（= 创建配送任务，三选一） -->
    <el-dialog v-model="dispatchVisible" title="安排配送" width="520px" append-to-body>
      <el-alert
        title="订单需已「备货完成」。选择配送方式后立即生成配送任务：商家自送=本店自己送；指定配送员=派给某位骑手（需其配送员开关已打开）；发布领取=进入抢单池，骑手可自行抢单。"
        type="info"
        :closable="false"
        show-icon
        class="tip"
      />
      <el-form label-width="110px" size="small">
        <el-form-item label="订单号"><el-input v-model="dispatchForm.orderNo" disabled /></el-form-item>
        <el-form-item label="配送方式">
          <el-radio-group v-model="dispatchForm.assignmentType">
            <el-radio-button value="MERCHANT_SELF">{{ ASSIGNMENT_TYPE_LABELS.MERCHANT_SELF }}</el-radio-button>
            <el-radio-button value="ASSIGN_TO_PERSON">{{ ASSIGNMENT_TYPE_LABELS.ASSIGN_TO_PERSON }}</el-radio-button>
            <el-radio-button value="PUBLISH_CLAIM">发布领取</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="dispatchForm.assignmentType === 'ASSIGN_TO_PERSON'" label="配送员">
          <el-select v-model="dispatchForm.deliveryPersonId" filterable placeholder="请选择本店配送员" style="width: 100%">
            <el-option
              v-for="person in staff"
              :key="person.id"
              :label="`${person.name || '未命名'}（${person.id}）${person.phone ? ' · ' + person.phone : ''}`"
              :value="String(person.id)"
            />
          </el-select>
          <span v-if="!staff.length" class="muted">本店暂无配送员：请到「配送员与业绩」页打开某位店员的配送员开关，或改用「发布领取」。</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="dispatching" @click="submitDispatch">确认安排</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.operator-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 4px 8px; }
.muted { color: var(--vben-muted); font-size: 13px; }
.tip { margin-bottom: 12px; }
</style>
