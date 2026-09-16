<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useTransferStore } from '@/stores/transfer'
import { Refresh } from '@element-plus/icons-vue'

const store = useTransferStore()

function money(value: number): string {
  return `¥ ${Number(value || 0).toFixed(2)}`
}

async function load(): Promise<void> {
  try {
    await store.fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '余额转账记录查询失败')
  }
}

function pageChange(value: number): void {
  store.page = value
  void load()
}

function sizeChange(value: number): void {
  store.pageSize = value
  store.page = 1
  void load()
}

onMounted(() => { void load() })
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>余额转账记录</h1><p>查看用户余额转账流水。</p></div>
      <el-button :loading="store.loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>转账流水</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        empty-text="暂无转账记录"
        @page-change="pageChange"
        @size-change="sizeChange"
      >
        <el-table-column prop="transferNo" label="转账单号" min-width="200" />
        <el-table-column label="转出方" min-width="180">
          <template #default="{ row }">
            <div class="party-cell">
              <div>{{ row.fromNickname || '未知' }}</div>
              <small>{{ row.fromUserId }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="接收方" min-width="180">
          <template #default="{ row }">
            <div class="party-cell">
              <div>{{ row.toNickname || '未知' }}</div>
              <small>{{ row.toUserId }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="140"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
        <el-table-column prop="createTime" label="转账时间" min-width="180" />
      </DataTable>
    </el-card>
  </section>
</template>

<style scoped>
.party-cell { display: flex; flex-direction: column; gap: 2px; }
.party-cell small { color: var(--vben-muted); }
</style>
