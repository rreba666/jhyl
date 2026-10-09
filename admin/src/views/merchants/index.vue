<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { getMerchants, toggleMerchantStatus, updateMerchant } from '@/api/merchant'
import { useTodoStore } from '@/stores/todo'
import type { MerchantFilters, MerchantVO } from '@/types/merchant'
import { Edit, Refresh, Search, Shop, Warning } from '@element-plus/icons-vue'
const route = useRoute()
const todoStore = useTodoStore()
const list = ref<MerchantVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const filters = reactive<MerchantFilters>({ keyword: '', status: '' })

const statusText: Record<number, string> = { 0: '待审核', 1: '启用', 2: '禁用' }
const statusType: Record<number, 'warning' | 'success' | 'info'> = { 0: 'warning', 1: 'success', 2: 'info' }

/**
 * 「设置让利比例」弹窗（2026-09-30 新增）。
 *
 * 后端已部署：`MerchantVO.commissionRate` 可读、`MerchantUpdateDTO.commissionRate` 可写；
 * 区间 **3~20**（⚠️ 不是 5~20，越界返回 `13018`），**不传 = 不修改**。
 * 该比例是**商户级**、对商户下所有门店生效，且**参与结算**（按订单快照）。
 */
const commissionDialogVisible = ref(false)
const commissionSaving = ref(false)
/** 当前正在编辑的商户（用于弹窗标题回显品牌名）。 */
const commissionTarget = ref<MerchantVO | null>(null)
/** 弹窗里的比例值；`null` = 保持不修改（提交时不带该字段）。 */
const commissionInput = ref<number | null>(null)
/**
 * 弹窗里的**物流单专用**让利比例（%，2026-10-02 P4 新增）。
 *
 * ⚠️ `null` = **不修改 / 沿用品牌级**（提交时**不带**该字段）——
 * 后端语义是"不传 = 不修改"，而传值就要过 3~20 ⇒ **恢复"跟随品牌级"只能不传**，不能传 0。
 */
const logisticsCommissionInput = ref<number | null>(null)

/** 打开让利比例弹窗，回显该商户当前值（`null` = 未设置）。 */
function openCommissionDialog(row: MerchantVO): void {
  commissionTarget.value = row
  commissionInput.value = typeof row.commissionRate === 'number' ? row.commissionRate : null
  // ⚠️ 物流单专用比例：后端 `MerchantVO` **已补齐该字段**（2026-10-02 晚 jar `870f9d98…`，
  //    列表 + 详情共用 `toVO` ⇒ 两处都返回）。⚠️ 但该 VO 走 `@JsonInclude(NON_NULL)`
  //    ⇒ 值为 NULL（= 跟随品牌级）时**键被省略**，拿到的是 `undefined`（不是 `null`）
  //    ⇒ 故用 `typeof === 'number'` 判断（**不要**写 `=== null`）；读不到就留空，
  //    留空提交 = 不修改（语义安全，不会误清商家的配置）。
  logisticsCommissionInput.value = typeof row.logisticsCommissionRate === 'number' ? row.logisticsCommissionRate : null
  commissionDialogVisible.value = true
}

/**
 * 保存让利比例。
 *
 * ⚠️ 必须**带上 `brandName`** —— 契约里它是 `MerchantUpdateDTO` 的**必填**项，
 *    只传 `commissionRate` 会参数校验不过。
 * ⚠️ 输入框清空时**故意不带 `commissionRate`**（而不是传 0 / null）：
 *    后端语义是"不传 = 不修改"，而传值就要过 3~20 的区间校验 —— 传 0 会被拒。
 */
async function saveCommission(): Promise<void> {
  const row = commissionTarget.value
  if (!row) return
  const value = commissionInput.value
  const logisticsValue = logisticsCommissionInput.value
  // 前端先拦一次，给出更快的反馈（后端强校验仍是最终把关，越界返回 13018）
  if (value != null && (value < 3 || value > 20)) {
    ElMessage.warning('让利比例需在 3~20 之间')
    return
  }
  if (logisticsValue != null && (logisticsValue < 3 || logisticsValue > 20)) {
    ElMessage.warning('物流单专用让利比例需在 3~20 之间')
    return
  }
  commissionSaving.value = true
  try {
    await updateMerchant(row.id, {
      brandName: row.brandName,
      // ⚠️ 两个比例都遵守「不传 = 不修改」：清空即不带该字段（传 0 会被 3~20 校验拒）
      ...(value == null ? {} : { commissionRate: value }),
      ...(logisticsValue == null ? {} : { logisticsCommissionRate: logisticsValue }),
    })
    const parts: string[] = []
    parts.push(value == null ? '让利比例未修改' : `让利比例 ${value}%`)
    parts.push(logisticsValue == null ? '物流单专用比例未修改（沿用品牌级）' : `物流单专用比例 ${logisticsValue}%`)
    ElMessage.success(`已提交（${parts.join('；')}）`)
    commissionDialogVisible.value = false
    await loadList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '让利比例保存失败')
  } finally {
    commissionSaving.value = false
  }
}

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const result = await getMerchants(page.value, pageSize.value, filters)
    total.value = result.total
    list.value = result.list
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '商户列表查询失败')
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void loadList()
}

async function toggleStatus(row: MerchantVO): Promise<void> {
  const next: 1 | 2 = row.status === 1 ? 2 : 1
  try {
    if (next === 1) {
      await ElMessageBox.confirm(`确认启用商户“${row.brandName}”吗？`, '状态确认')
      await toggleMerchantStatus(row.id, 1)
      ElMessage.success('商户已启用')
    } else {
      /**
       * ⚠️ 停用/驳回**必须**填审核意见（2026-09-21 实测）：
       * 后端置 2 时不传 `remark` 直接报 `code=1001 驳回/停用品牌必须填写审核意见（remark）`。
       * 老实现只发 `status` → 「驳回」按钮点了必然报错；且这个原因是入驻申请人
       * 在小程序「我的入驻申请」里唯一能看到的信息（写回申请单 `auditRemark`），
       * 不填就等于让商家盲改重提。故这里用 prompt 强制填写、不允许空白。
       */
      const { value } = await ElMessageBox.prompt(
        `确认停用/驳回商户“${row.brandName}”吗？请填写审核意见，该内容会展示给入驻申请人。`,
        '驳回 / 停用原因',
        {
          inputType: 'textarea',
          inputPlaceholder: '例如：资质不全，请补传营业执照',
          inputValidator: (text: string) => (text && text.trim() ? true : '必须填写审核意见'),
          confirmButtonText: '确认停用',
          cancelButtonText: '取消',
        },
      )
      await toggleMerchantStatus(row.id, 2, value.trim())
      ElMessage.success('商户已停用')
    }
    void loadList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '商户状态更新失败')
  }
}

/** 跳转商户门店管理（门店管理页已按模块矩阵开放给相关角色）。 */
function goShops(row: MerchantVO): void {
  // 门店列表由 shoPs 页承载，这里给个简单提示；后续接门店详情页可改成跳转。
  ElMessage.info(`商户「${row.brandName}」共 ${row.shopCount ?? 0} 家门店`)
}

/**
 * 按 URL query 初始化状态筛选（待办铃铛跳 `/merchants?status=0`）。
 *
 * ⚠️ 2026-09-18：先**清掉与待办无关的筛选** —— 待办铃铛的数字是"该状态的全量条数"
 * （`api/todo.ts` 承诺「徽标数字 = 点进去的条数」），若残留上一次的关键词搜索，
 * 列表条数会少于铃铛数字、看起来像对不上。
 */
function applyQuery(): void {
  filters.keyword = '' // 关键词与待办无关，进入待办视图时清掉
  const status = route.query.status
  if (typeof status === 'string' && status !== '' && !Number.isNaN(Number(status))) {
    filters.status = Number(status) as MerchantFilters['status']
    page.value = 1
  }
}

/** 重新套用 URL 筛选并刷新（待办铃铛信号；200ms 去重避免与路由变化重复请求）。 */
let lastTodoApply = 0
function applyTodoAndReload(): void {
  const now = Date.now()
  if (now - lastTodoApply < 200) return
  lastTodoApply = now
  applyQuery()
  void loadList()
}

// 同一模块内点不同待办/重复点同一待办都要有反应：query 变化 + 铃铛点击信号 双保险
watch(() => route.query.status, () => { applyTodoAndReload() })
watch(() => todoStore.clickTick, () => { applyTodoAndReload() })

onMounted(() => {
  applyQuery()
  void loadList()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>商户管理</h1><p>平台管理员管理入驻商户（品牌），含审核、启用/停用、门店与店员。</p></div>
      <el-button :loading="loading" @click="loadList"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>商户列表</strong><span class="toolbar-count">共 {{ total }} 条</span></div>
        <div class="toolbar-actions">
          <el-select v-model="filters.status" placeholder="状态" clearable class="status-select" @change="search">
            <el-option label="待审核" :value="0" />
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="2" />
          </el-select>
          <el-input v-model="filters.keyword" placeholder="品牌名" clearable class="search-input" @keyup.enter="search" @clear="search" />
          <el-button type="primary" @click="search"><el-icon><Search /></el-icon>搜索</el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" row-key="id" border stripe>
        <el-table-column prop="brandName" label="品牌名" min-width="160" />
        <el-table-column prop="contactName" label="联系人" min-width="110" />
        <el-table-column prop="contactPhone" label="联系电话" min-width="130" />
        <el-table-column label="门店数" width="90"><template #default="{ row }">{{ row.shopCount ?? 0 }}</template></el-table-column>
        <!-- ⚠️ 2026-09-30 新增：让利比例（商户级、参与结算）。
             后端约定 null = 未设置 ⇒ 显示「未设置」而不是 0（避免运营误读成"让利 0%"）。 -->
        <el-table-column label="让利比例" width="110">
          <template #default="{ row }">
            <span v-if="typeof row.commissionRate === 'number'">{{ row.commissionRate }}%</span>
            <span v-else class="cell-muted">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="statusType[row.status || 0]">{{ statusText[row.status || 0] }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" fixed="right" width="330">
          <template #default="{ row }">
            <div class="operator-actions">
              <el-button size="small" @click="goShops(row)"><el-icon><Shop /></el-icon>门店</el-button>
              <!-- ⚠️ 2026-09-30 新增：设置让利比例（后端已部署，区间 3~20） -->
              <el-button size="small" @click="openCommissionDialog(row)"><el-icon><Edit /></el-icon>让利</el-button>
              <el-button size="small" :type="row.status === 1 ? 'warning' : 'success'" @click="toggleStatus(row)"><el-icon><Warning /></el-icon>{{ row.status === 1 ? '停用' : '启用' }}</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !list.length" description="暂无商户数据" />
      <div v-if="total > 0" class="table-pagination">
        <el-pagination background layout="total, sizes, prev, pager, next" :current-page="page" :page-size="pageSize" :total="total" @current-change="page = $event; void loadList()" @size-change="pageSize = $event; page = 1; void loadList()" />
      </div>
    </el-card>

    <!-- ⚠️ 2026-09-30 新增：设置商户让利比例（后端已部署）。
         契约：`MerchantVO.commissionRate` 读、`MerchantUpdateDTO.commissionRate` 写，
         区间 **3~20**（越界 13018），**不传 = 不修改**。 -->
    <el-dialog v-model="commissionDialogVisible" title="设置商户让利比例" width="440px">
      <div v-if="commissionTarget" class="commission-body">
        <p class="commission-brand">商户：<strong>{{ commissionTarget.brandName }}</strong></p>
        <el-form label-width="96px">
          <el-form-item label="让利比例">
            <el-input-number v-model="commissionInput" :min="3" :max="20" :precision="2" :step="0.5" />
            <span class="commission-unit">%</span>
          </el-form-item>
          <!-- ⚠️ 2026-10-02 新增（P4）：**物流单专用**让利比例。仅对物流单生效，自提/同城仍用上面的品牌级。 -->
          <el-form-item label="物流单专用">
            <el-input-number v-model="logisticsCommissionInput" :min="3" :max="20" :precision="2" :step="0.5" />
            <span class="commission-unit">%</span>
          </el-form-item>
        </el-form>
        <!-- ⚠️ 2026-10-08：补一句「未设置 ≠ 0%」+ 平台默认比例的出处。
             spec §6 本轮把**平台默认**抽成改为 3%：本弹窗改的是**商户级**比例（数据，不跟着改），
             商户「从未配过」时按平台默认比例结算 —— 该默认值以「系统配置管理」页
             （`platform_commission_rate`）显示的当前值为准，避免这里写死的数字与后端漂移。 -->
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="区间 3~20。该比例是商户级的，对商户下所有门店生效，并参与结算（按订单快照，只影响之后新下的订单）。留空 / 清空表示不修改。⚠️ 未设置不等于 0%：商户从未配过时按「平台默认比例」结算，该默认值初始为 3%，可在「系统配置管理」页查看与修改（以该页当前值为准）。"
        />
        <el-alert
          class="commission-alert"
          type="warning"
          :closable="false"
          show-icon
          title="物流单专用让利比例（3~20）：仅对**物流单**生效，自提 / 同城仍用上面的品牌级比例。留空 = 沿用品牌级；清空表示不修改。"
        />
      </div>
      <template #footer>
        <el-button @click="commissionDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="commissionSaving" @click="saveCommission">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.toolbar-count { margin-left: 8px; color: #909399; font-size: 13px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.search-input { width: 200px; }
.status-select { width: 110px; }
.operator-actions { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
/* ⚠️ 2026-09-30：让利比例相关的样式（列表里的"未设置"灰字 + 弹窗内的排版） */
.cell-muted { color: #909399; }
.commission-body { display: flex; flex-direction: column; gap: 12px; }
.commission-brand { margin: 0; color: #303133; font-size: 14px; }
.commission-unit { margin-left: 8px; color: #606266; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.table-pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
