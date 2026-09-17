<script setup lang="ts" generic="T extends object">
import type { PropType } from 'vue'

defineProps({
  data: { type: Array as PropType<T[]>, required: true },
  loading: Boolean,
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  emptyText: { type: String, default: '暂无数据' },
  rowKey: { type: String, default: 'id' },
  /** 是否显示左侧勾选列（默认显示；只读表格可传 false）。 */
  showSelection: { type: Boolean, default: true },
  /** 行样式类名，**透传给 el-table**（如整行标色）。⚠️ 必须在这里声明，否则页面传 `:row-class-name` 只会落到根 div 上、表格收不到。 */
  rowClassName: { type: [String, Function] as PropType<string | ((data: { row: T; rowIndex: number }) => string)>, default: '' },
})

const emit = defineEmits<{
  selectionChange: [rows: T[]]
  pageChange: [page: number]
  sizeChange: [size: number]
}>()
</script>

<template>
  <div v-loading="loading" class="data-table">
    <el-table :data="data" :row-key="rowKey" :row-class-name="rowClassName" border stripe @selection-change="emit('selectionChange', $event)">
      <el-table-column v-if="showSelection" type="selection" width="48" />
      <slot />
      <template #empty>
        <el-empty :description="emptyText" />
      </template>
    </el-table>
    <div class="table-pagination">
      <span class="table-total">共 {{ total }} 条</span>
      <el-pagination
        background
        layout="total, sizes, prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="emit('pageChange', $event)"
        @size-change="emit('sizeChange', $event)"
      />
    </div>
  </div>
</template>
