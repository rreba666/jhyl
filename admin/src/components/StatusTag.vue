<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ status: string | boolean; labels?: Record<string, string> }>(), {
  labels: () => ({}),
})

const label = computed(() => props.labels[String(props.status)] || String(props.status))
const type = computed(() => {
  if (['启用', '已支付', '已发货', '已完成', '上架'].includes(label.value)) return 'success'
  if (['禁用', '已取消', '下架'].includes(label.value)) return 'info'
  if (['待支付', '售后中'].includes(label.value)) return 'warning'
  return ''
})
</script>

<template><el-tag :type="type">{{ label }}</el-tag></template>
