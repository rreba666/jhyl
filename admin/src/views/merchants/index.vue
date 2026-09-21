<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { getMerchants, toggleMerchantStatus } from '@/api/merchant'
import { useTodoStore } from '@/stores/todo'
import type { MerchantFilters, MerchantVO } from '@/types/merchant'
import { Refresh, Search, Shop, Warning } from '@element-plus/icons-vue'
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
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="statusType[row.status || 0]">{{ statusText[row.status || 0] }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" fixed="right" width="240">
          <template #default="{ row }">
            <div class="operator-actions">
              <el-button size="small" @click="goShops(row)"><el-icon><Shop /></el-icon>门店</el-button>
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
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.table-pagination { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
