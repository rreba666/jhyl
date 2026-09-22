<script setup lang="ts">
import { computed, ref } from 'vue'
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

/** 是否已展开全部图片：displayLimit 之外的图默认折叠 */
const expanded = ref(false)

const previewImages = computed(() => props.modelValue.filter(Boolean))
/**
 * 当前要渲染的图片列表。
 * ⚠️ 2026-09-22 修：之前折叠掉的图片**没有任何展开入口**，用户既看不到也删不掉
 * （详情图切片后常有 8~9 段，界面上只能操作前 3 段；想删掉多传的分段时就像「删不掉」）。
 * 现在折叠态显示「+N 展开全部」，点开后每张都带删除按钮，删完可再收起。
 */
const visibleImages = computed(() => (props.displayLimit > 0 && !expanded.value ? props.modelValue.slice(0, props.displayLimit) : props.modelValue))
const collapsedCount = computed(() => Math.max(props.modelValue.length - visibleImages.value.length, 0))
/** 折叠态下被隐藏的张数（用于判断「是否值得显示展开/收起」，与 collapsedCount 同源于 displayLimit） */
const hiddenCount = computed(() => Math.max(props.modelValue.length - props.displayLimit, 0))
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
        <el-button class="image-remove" link type="danger" @click="onRemove(index)">删除{{ modelValue.length > 1 ? ` 第${index + 1}张` : '' }}</el-button>
      </div>

      <!-- 折叠提示：点它展开全部（只折叠、不给入口会让被隐藏的图变成「看不见也删不掉」） -->
      <div
        v-if="collapsedCount > 0 && previewImages[visibleImages.length]"
        class="image-tile image-more-tile"
        role="button"
        tabindex="0"
        title="点击展开全部图片（展开后可逐张删除）"
        @click="expanded = true"
        @keydown.enter="expanded = true"
      >
        <!-- 缩略图与遮罩单独包一层：遮罩只盖住图片本身，不盖住下面的「展开全部」按钮 -->
        <div class="image-more-thumb">
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
        <el-button class="image-remove" link type="primary" @click.stop="expanded = true">展开全部</el-button>
      </div>
      <!-- 展开态收尾：给一个收起入口，避免长图列表把页面撑得过长 -->
      <div v-else-if="expanded && hiddenCount > 0" class="image-tile image-collapse-tile">
        <el-button class="image-remove" link @click="expanded = false">收起（隐藏 {{ hiddenCount }} 张）</el-button>
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
    <!-- 明确告知「一共有几张 / 当前折叠了几张」，免得用户以为图丢了 -->
    <p v-if="hiddenCount > 0" class="image-grid-count">
      共 {{ modelValue.length }} 张{{ expanded ? '' : `（已折叠 ${hiddenCount} 张，点「+${hiddenCount}」或「展开全部」查看/删除）` }}
    </p>
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
.image-remove { padding: 0; line-height: 1.2; white-space: normal; text-align: left; }
/* ⚠️ position: relative 必须保留 —— 折叠遮罩 .image-more-count 用 inset:0 定位，
   少了它遮罩会相对更外层容器铺开（2026-09-22 线上就是这个 bug：一片灰色遮罩盖住整个详情图区域，
   "+N" 跑到右侧中间，看着像页面坏了）。 */
.image-more-tile { position: relative; cursor: pointer; }
/* 折叠缩略图的定位上下文：遮罩只盖住图片本身，不盖住下面的「展开全部」按钮 */
.image-more-thumb { position: relative; display: block; width: 100%; }
.image-more-preview { display: block; }
.image-more-count { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: rgba(0, 0, 0, .48); border-radius: 8px; font-size: 22px; font-weight: 600; pointer-events: none; }
.image-grid-count { margin: 8px 0 0; color: var(--vben-muted); font-size: 12px; }

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
