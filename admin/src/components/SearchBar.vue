<script setup lang="ts">
import type { PropType } from 'vue'

export interface SearchField {
  prop: string
  label: string
  type?: 'input' | 'select' | 'date'
  placeholder?: string
  options?: Array<{ label: string; value: string | number }>
}

defineProps({
  modelValue: { type: Object as PropType<Record<string, unknown>>, required: true },
  fields: { type: Array as PropType<SearchField[]>, required: true },
})

const emit = defineEmits<{
  search: []
  reset: []
}>()
</script>

<template>
  <el-form :model="modelValue" inline class="search-bar">
    <el-form-item v-for="field in fields" :key="field.prop" :label="field.label">
      <el-input
        v-if="!field.type || field.type === 'input'"
        :model-value="modelValue[field.prop] as string"
        :placeholder="field.placeholder || `请输入${field.label}`"
        clearable
        @update:model-value="modelValue[field.prop] = $event"
      />
      <el-select v-else-if="field.type === 'select'" v-model="modelValue[field.prop]" clearable :placeholder="field.placeholder || `请选择${field.label}`">
        <el-option v-for="option in field.options || []" :key="option.value" v-bind="option" />
      </el-select>
      <el-date-picker v-else v-model="modelValue[field.prop]" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" @click="emit('search')">搜索</el-button>
      <el-button @click="emit('reset')">重置</el-button>
    </el-form-item>
  </el-form>
</template>
