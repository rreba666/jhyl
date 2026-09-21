<script setup lang="ts">
/**
 * 配送任务面板：本店任务列表 + 创建任务 + 暂停/恢复/取消/改派。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  cancelMyTask,
  createMyTask,
  getMyStaff,
  getMyTasks,
  pauseMyTask,
  reassignMyTask,
  resumeMyTask,
  type DeliveryStaff,
  type DeliveryTask,
} from '@/api/shop-delivery'
import { ASSIGNMENT_TYPE_LABELS, assignmentTypeLabel, taskStatusLabel, taskStatusTagType } from '@/utils/deliveryStatus'

const props = defineProps<{ shopId: string }>()

const tasks = ref<DeliveryTask[]>([])
const loading = ref(false)

/**
 * 任务是否还能操作（未送达且未取消）。
 *
 * ⚠️ 2026-09-21 实测：**后端取消后返回的是 `CANCELLED`（双 L）**，不是 `CANCELED`。
 * 这里原先只排除 `CANCELED`，于是已取消的任务仍被判为"进行中"——操作列继续显示
 * 暂停/恢复/改派/取消（点了必然被后端拒 `13003`），"未完成数"统计也偏高。
 * 同项目 `admin/src/utils/deliveryStatus.ts` 早已注明"两种拼写都要兼容"，这里与它对齐。
 */
function isActive(row: DeliveryTask): boolean {
  const status = String(row.status ?? '')
  return status !== 'DELIVERED' && status !== 'CANCELED' && status !== 'CANCELLED'
}

/**
 * 各动作的**可点条件**（不满足就禁用，而不是让用户点了再报错）。
 * 依据后端状态机：暂停=进行中；恢复=仅「已暂停 / 异常」；取消/改派=未送达未取消。
 */
function canPause(row: DeliveryTask): boolean {
  return ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'DELIVERING', 'NEARBY'].includes(String(row.status))
}
function canResume(row: DeliveryTask): boolean {
  // 只有「已暂停」和「异常」能恢复；状态正常的任务点恢复会被后端拒绝（1001）
  return ['PAUSED', 'EXCEPTION'].includes(String(row.status))
}
function canCancel(row: DeliveryTask): boolean {
  return isActive(row)
}
function canReassign(row: DeliveryTask): boolean {
  return isActive(row)
}
/** 禁用时的悬停原因（让管理者知道为什么点不了）。 */
function disabledHint(can: boolean, reason: string): string {
  return can ? '' : reason
}

async function loadTasks(): Promise<void> {
  // 未选门店时不请求：平台账号调 my/** 会返回 1000「请指定门店」，避免刷屏报错
  if (!props.shopId) {
    tasks.value = []
    return
  }
  loading.value = true
  try {
    tasks.value = await getMyTasks(props.shopId || undefined)
  } catch (error) {
    tasks.value = []
    ElMessage.error(error instanceof Error ? error.message : '配送任务查询失败')
  } finally {
    loading.value = false
  }
}

// ===== 创建任务 =====
const createVisible = ref(false)
const creating = ref(false)
/** 本店配送员（「指定配送员」用下拉，避免手输 staffId）。 */
const staff = ref<DeliveryStaff[]>([])
const createForm = reactive<{ orderNo: string; assignmentType: string; deliveryPersonId: string }>({
  orderNo: '',
  assignmentType: 'MERCHANT_SELF',
  deliveryPersonId: '',
})

function openCreate(): void {
  createForm.orderNo = ''
  createForm.assignmentType = 'MERCHANT_SELF'
  createForm.deliveryPersonId = ''
  createVisible.value = true
  void loadStaff()
}

/** 拉取本店配送员（失败静默，可改用「发布领取」）。 */
async function loadStaff(): Promise<void> {
  if (!props.shopId) {
    staff.value = []
    return
  }
  try {
    staff.value = await getMyStaff(props.shopId || undefined)
  } catch {
    staff.value = []
  }
}

async function submitCreate(): Promise<void> {
  if (!createForm.orderNo.trim()) {
    ElMessage.warning('请输入订单号')
    return
  }
  if (createForm.assignmentType === 'ASSIGN_TO_PERSON' && !createForm.deliveryPersonId.trim()) {
    ElMessage.warning('指定配送员方式需要填写配送员 ID')
    return
  }
  creating.value = true
  try {
    const taskNo = await createMyTask(props.shopId || undefined, {
      orderNo: createForm.orderNo.trim(),
      assignmentType: createForm.assignmentType,
      deliveryPersonId: createForm.assignmentType === 'ASSIGN_TO_PERSON' ? createForm.deliveryPersonId : undefined,
    })
    ElMessage.success(taskNo ? `任务已创建：${taskNo}` : '任务已创建')
    createVisible.value = false
    await loadTasks()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建配送任务失败')
  } finally {
    creating.value = false
  }
}

// ===== 任务操作 =====
/** 暂停任务（配送中）。 */
async function doPause(row: DeliveryTask): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入暂停原因', '暂停任务', { inputPattern: /\S+/, inputErrorMessage: '请填写原因' })
    await pauseMyTask(props.shopId || undefined, row.id as number, result.value)
    ElMessage.success('任务已暂停')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '暂停失败')
  }
}

/** 恢复任务（异常/暂停后）。 */
async function doResume(row: DeliveryTask): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复任务 ${row.taskNo || row.id}？`, '恢复任务', { type: 'warning' })
    await resumeMyTask(props.shopId || undefined, row.id as number)
    ElMessage.success('任务已恢复')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

/** 取消任务（必填原因）。 */
async function doCancel(row: DeliveryTask): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入取消原因', '取消任务', { inputPattern: /\S+/, inputErrorMessage: '请填写取消原因' })
    await ElMessageBox.confirm('取消后不可恢复，确认继续？', '二次确认', { type: 'warning' })
    await cancelMyTask(props.shopId || undefined, row.id as number, result.value)
    ElMessage.success('任务已取消')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '取消失败')
  }
}

/** 改派骑手。 */
async function doReassign(row: DeliveryTask): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入新骑手的店员 ID', '改派骑手', {
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入数字 ID',
      inputValue: row.deliveryPersonId ? String(row.deliveryPersonId) : '',
    })
    await reassignMyTask(props.shopId || undefined, row.id as number, result.value)
    ElMessage.success('已改派')
    await loadTasks()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '改派失败')
  }
}

/** 任务数量（父级 Tab 徽标用）。 */
const activeCount = computed(() => tasks.value.filter((item) => isActive(item)).length)

watch(() => props.shopId, () => { void loadTasks() })
onMounted(() => { void loadTasks() })

defineExpose({ loadTasks, activeCount })
</script>

<template>
  <el-card shadow="never" class="content-card">
    <div class="toolbar">
      <div><strong>配送任务</strong><span class="muted">共 {{ tasks.length }} 条（未完成 {{ activeCount }}）</span></div>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">创建配送任务</el-button>
        <el-button :loading="loading" @click="loadTasks">刷新</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="tasks" border size="small" max-height="560">
      <el-table-column prop="taskNo" label="任务号" min-width="160" />
      <el-table-column prop="orderNo" label="订单号" min-width="160" />
      <el-table-column label="状态" width="140"><template #default="{ row }"><el-tag :type="taskStatusTagType(row.status)" size="small">{{ taskStatusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="deliveryPersonId" label="骑手ID" width="100" />
      <el-table-column label="指派方式" width="150">
        <template #default="{ row }">{{ assignmentTypeLabel(row.assignmentType) }}</template>
      </el-table-column>
      <el-table-column prop="receiverName" label="收货人" width="110" />
      <el-table-column prop="deliveryAddress" label="收货地址" min-width="200" />
      <el-table-column label="距离/预计" width="140">
        <template #default="{ row }">{{ row.distanceKm != null ? `${Number(row.distanceKm).toFixed(1)}km` : '—' }} / {{ row.estimatedMinutes != null ? `${row.estimatedMinutes}分` : '—' }}</template>
      </el-table-column>
      <el-table-column prop="exceptionRemark" label="异常说明" min-width="150" />
      <el-table-column prop="createTime" label="创建时间" min-width="160" />
      <el-table-column label="操作" width="270" fixed="right">
        <template #default="{ row }">
          <div class="operator-actions">
            <template v-if="isActive(row)">
              <!-- 按状态禁用：不满足条件时点不了，并用 title 说明原因（避免"点了才报错"） -->
              <el-button size="small" :disabled="!canPause(row)" :title="disabledHint(canPause(row), '只有「已派单 / 已接单 / 已取货 / 配送中 / 已到附近」的任务可以暂停')" @click="doPause(row)">暂停</el-button>
              <el-button size="small" type="success" plain :disabled="!canResume(row)" :title="disabledHint(canResume(row), '只有「已暂停 / 配送异常」的任务可以恢复')" @click="doResume(row)">恢复</el-button>
              <el-button size="small" :disabled="!canReassign(row)" @click="doReassign(row)">改派</el-button>
              <el-button size="small" type="danger" plain :disabled="!canCancel(row)" @click="doCancel(row)">取消</el-button>
            </template>
            <span v-else class="muted">已结束</span>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <!-- 创建任务 -->
  <el-dialog v-model="createVisible" title="创建配送任务（安排配送）" width="520px" append-to-body>
    <el-alert title="仅「备货完成」的订单可创建配送任务；同一订单重复创建按幂等处理。一般直接从「同城订单」页的「安排配送」按钮进来更省事。" type="info" :closable="false" show-icon class="tip" />
    <el-form label-width="120px" size="small">
      <el-form-item label="订单号"><el-input v-model="createForm.orderNo" placeholder="请输入订单号" /></el-form-item>
      <el-form-item label="指派方式">
        <el-radio-group v-model="createForm.assignmentType">
          <el-radio-button value="MERCHANT_SELF">{{ ASSIGNMENT_TYPE_LABELS.MERCHANT_SELF }}</el-radio-button>
          <el-radio-button value="ASSIGN_TO_PERSON">{{ ASSIGNMENT_TYPE_LABELS.ASSIGN_TO_PERSON }}</el-radio-button>
          <el-radio-button value="PUBLISH_CLAIM">发布领取</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="createForm.assignmentType === 'ASSIGN_TO_PERSON'" label="配送员">
        <el-select v-model="createForm.deliveryPersonId" filterable placeholder="请选择本店配送员" style="width: 100%">
          <el-option
            v-for="person in staff"
            :key="person.id"
            :label="`${person.name || '未命名'}（${person.id}）${person.phone ? ' · ' + person.phone : ''}`"
            :value="String(person.id)"
          />
        </el-select>
        <span v-if="!staff.length" class="muted">本店暂无配送员，可先用「发布领取」。</span>
      </el-form-item>
    </el-form>
    <template #footer><el-button @click="createVisible = false">取消</el-button><el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button></template>
  </el-dialog>
</template>

<style scoped>
.content-card { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.operator-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 4px 8px; }
.muted { color: var(--vben-muted); font-size: 13px; margin-left: 8px; }
.tip { margin-bottom: 12px; }
</style>
