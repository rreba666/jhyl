<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { ref } from 'vue'

defineProps<{
  title: string
  width?: string
  rules?: FormRules
}>()

const visible = defineModel<boolean>('visible', { default: false })
const formRef = ref<FormInstance>()
const emit = defineEmits<{ submit: [form: FormInstance] }>()

async function submit(): Promise<void> {
  await formRef.value?.validate()
  emit('submit', formRef.value as FormInstance)
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" :width="width || '560px'" append-to-body destroy-on-close>
    <el-form ref="formRef" :rules="rules" label-width="96px"><slot /></el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>
