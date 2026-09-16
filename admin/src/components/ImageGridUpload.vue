<script setup lang="ts">
import { computed } from 'vue'
import type { UploadRequestOptions } from 'element-plus'

const props = withDefaults(defineProps<{
  modelValue: string[]
  max?: number
  accept?: string
  uploading?: boolean
  multiple?: boolean
  displayLimit?: number
  thumbnailMode?: 'square' | 'long'
}>(), {
  max: 5,
  accept: 'image/*',
  uploading: false,
  multiple: false,
  displayLimit: 0,
  thumbnailMode: 'square',
})

const previewImages = computed(() => props.modelValue.filter(Boolean))
const visibleImages = computed(() => props.displayLimit > 0 ? props.modelValue.slice(0, props.displayLimit) : props.modelValue)
const collapsedCount = computed(() => Math.max(props.modelValue.length - visibleImages.value.length, 0))
const thumbnailFit = computed<'cover' | 'contain'>(() => props.thumbnailMode === 'long' ? 'contain' : 'cover')

const emit = defineEmits<{
  upload: [options: UploadRequestOptions]
  remove: [index: number]
}>()

/** 将上传事件交给业务页面处理，组件本身不耦合 OSS 或接口。 */
function onUpload(options: UploadRequestOptions): void {
  emit('upload', options)
}

/** 删除指定图片，保持数组更新逻辑由父页面控制。 */
function onRemove(index: number): void {
  emit('remove', index)
}
</script>

<template>
  <div class="image-grid-upload">
    <div class="image-grid">
      <div v-for="(url, index) in visibleImages" :key="`${url}-${index}`" class="image-tile">
        <el-image
          v-if="url"
          :class="['image-preview', { 'image-preview--long': props.thumbnailMode === 'long' }]"
          :src="url"
          :preview-src-list="previewImages"
          :initial-index="previewImages.indexOf(url)"
          :fit="thumbnailFit"
          preview-teleported
        >
          <template #error><div class="image-preview--error">图片加载失败</div></template>
        </el-image>
        <div v-else :class="['image-preview image-preview--empty', { 'image-preview--long': props.thumbnailMode === 'long' }]"><span class="image-plus">+</span></div>
        <el-button class="image-remove" link type="danger" @click="onRemove(index)">删除</el-button>
      </div>

      <div v-if="collapsedCount > 0 && previewImages[visibleImages.length]" class="image-tile image-more-tile">
        <el-image
          :class="['image-preview image-more-preview', { 'image-preview--long': props.thumbnailMode === 'long' }]"
          :src="previewImages[visibleImages.length]"
          :preview-src-list="previewImages"
          :initial-index="visibleImages.length"
          :fit="thumbnailFit"
          preview-teleported
        />
        <span class="image-more-count">+{{ collapsedCount }}</span>
      </div>

      <el-upload
        v-if="modelValue.length < max"
        class="image-upload-tile"
        :disabled="uploading"
        :show-file-list="false"
        :http-request="onUpload"
        :accept="accept"
        :multiple="multiple"
      >
        <div :class="['image-preview image-preview--empty', { 'image-preview--long': props.thumbnailMode === 'long' }]"><span class="image-plus">+</span></div>
      </el-upload>
    </div>
  </div>
</template>

<style scoped>
.image-grid-upload { display: block; width: 100%; min-width: 0; }
.image-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 100px)); gap: 12px; width: 100%; justify-content: start; }
.image-tile { display: flex; width: 100px; min-width: 0; flex-direction: column; align-items: flex-start; gap: 6px; }
.image-upload-tile { display: block; width: 100px; }
.image-upload-tile :deep(.el-upload) { display: block; width: 100%; }
.image-preview { width: 100px; height: 100px; border: 1px solid var(--vben-border); border-radius: 8px; background: var(--vben-surface); }
.image-preview--long { height: 150px; }
.image-preview--empty { display: grid; place-items: center; border-style: dashed; color: var(--vben-muted); cursor: pointer; }
.image-preview--error { display: grid; width: 100%; height: 100%; place-items: center; padding: 12px; box-sizing: border-box; color: var(--vben-muted); font-size: 13px; text-align: center; }
.image-plus { color: #8b929c; font-size: 48px; font-weight: 300; line-height: 1; }
.image-remove { padding: 0; }
.image-more-tile { position: relative; }
.image-more-preview { display: block; }
.image-more-count { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: rgba(0, 0, 0, .48); border-radius: 8px; font-size: 22px; font-weight: 600; pointer-events: none; }

@media (max-width: 520px) {
  .image-grid { grid-template-columns: repeat(2, minmax(0, 100px)); }
}

@media (max-width: 340px) {
  .image-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .image-tile, .image-upload-tile { width: 100%; }
  .image-preview { width: min(100px, 100%); height: auto; aspect-ratio: 1 / 1; }
  .image-preview.image-preview--long { height: 150px; aspect-ratio: auto; }
}
</style>
