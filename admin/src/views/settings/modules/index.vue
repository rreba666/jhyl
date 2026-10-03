<script setup lang="ts">
/**
 * 功能模块开关（V2 模块配置）。
 *
 * ## 这个页面解决什么
 * 用户需求：「**商家入驻的按钮要由后台管理系统来控制显隐**，因为有的时候需要关闭这个功能，
 *           隐藏按钮是成本最低的做法」。
 * 小程序端入口的显隐读的是模块开关（`GET /api/v2/modules`），但后台**此前没有模块开关的界面**
 * ⇒ 本页补上这一环：运营在这里把某个模块**停用**，小程序对应入口立即消失。
 *
 * ## 契约（`api_doc.json`）
 * - `GET /api/admin/v2/modules`       → `ModuleConfigEntity[]`（含停用）
 * - `PUT /api/admin/v2/modules/{key}` → body `ModuleConfigSaveDTO`
 *   ⚠️⚠️ **写入字段是 `name` / `enabled` / `sort`**，而读出来的是 `moduleName` / `sortOrder`
 *   —— 两套名字。拿读的字段名去写会被后端当未知字段**静默忽略**（不报错、也没改成功）。
 *   本页保存统一走 `api/modules.ts` 的 `saveModuleConfig`，字段名只在那里出现一次。
 *
 * ## ⚠️⚠️ 本页最大的风险：停用 ≠ 只隐藏入口
 * 每个模块带 `pathPatterns`，后端会按它**拦截接口**。
 * 实测 `delivery` = `/api/delivery/**,/api/merchant/**,/api/merchant/delivery/**`
 * ⇒ 误关 `delivery` 会把**商家端接口**一起打死（远不止少一个入口）。
 * 因此：① 表格里**必须显示** `pathPatterns`；② 有 `pathPatterns` 的模块在关闭前**强制二次确认**。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getModuleConfigList, saveModuleConfig } from '@/api/modules'
import type { ModuleConfigEntity } from '@/types/module'

const loading = ref(false)
const loadError = ref('')
const modules = ref<ModuleConfigEntity[]>([])
/** 正在保存的模块 key（用于禁用该行开关，防重复点击）。 */
const savingKey = ref('')

/** 契约规定的「必买模块」，不可停用。 */
const PROTECTED_KEYS = ['basic']

/**
 * 本次需求的目标模块。
 * ⚠️ 后端**目前只有 `delivery` / `pickup`**，还没有 `merchant`
 * ⇒ 若列表里找不到它，说明后端尚未建该模块，页面要明确提示（否则运营以为功能没做）。
 */
const MERCHANT_KEY = 'merchant'
const merchantProvisioned = computed(() => modules.value.some((item) => item.moduleKey === MERCHANT_KEY))

/** 后端还没建 merchant 模块时的提示文案。 */
const merchantHint = computed(() => {
  if (loading.value || loadError.value) return ''
  if (merchantProvisioned.value) return ''
  return `后端尚未建立「${MERCHANT_KEY}」（商家入驻）模块，所以列表里看不到它。`
    + '目前小程序「我的 → 商家入驻」入口仍然显示（前端对缺失模块的兜底是"启用"）。'
    + '请让后端在模块表补一行 merchant（pathPatterns 留空，只用于前端显隐、不拦截接口），'
    + '补好后刷新本页即可关闭它。'
})

/** 该模块是否受保护（不可停用）。 */
function isProtected(row: ModuleConfigEntity): boolean {
  return PROTECTED_KEYS.includes(row.moduleKey)
}

/** 把逗号分隔的 pathPatterns 拆成数组，便于逐条展示。 */
function patternList(row: ModuleConfigEntity): string[] {
  return String(row.pathPatterns || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 拉取模块列表。 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    modules.value = await getModuleConfigList()
  } catch (error) {
    modules.value = []
    loadError.value = error instanceof Error ? error.message : '模块配置查询失败'
  } finally {
    loading.value = false
  }
}

/**
 * 切换启停。
 * ⚠️ 停用带 `pathPatterns` 的模块会**拦截接口**，所以必须二次确认并把影响面写进弹窗；
 *    确认后失败则重新拉列表回滚开关视觉状态（避免界面与后端不一致）。
 */
async function onToggle(row: ModuleConfigEntity, value: string | number | boolean): Promise<void> {
  const nextEnabled: 0 | 1 = value ? 1 : 0
  if (isProtected(row)) return

  const patterns = patternList(row)
  if (nextEnabled === 0 && patterns.length > 0) {
    try {
      await ElMessageBox.confirm(
        `停用「${row.moduleName}」后，后端会拦截以下接口路径（不只是隐藏小程序入口）：\n\n`
          + patterns.join('\n')
          + '\n\n确认停用吗？',
        '停用会影响后端接口',
        { confirmButtonText: '确认停用', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return // 用户取消：不改任何状态（el-switch 是 :model-value 受控，不会自己翻转）
    }
  }

  savingKey.value = row.moduleKey
  try {
    // ⚠️ 写入字段：enabled（不是出参的同名字段也无妨，这里只传 enabled，name/sort 不传=不修改）
    await saveModuleConfig(row.moduleKey, { enabled: nextEnabled })
    ElMessage.success(`已${nextEnabled === 1 ? '启用' : '停用'}「${row.moduleName}」`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
    await load() // 回滚界面状态
  } finally {
    savingKey.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="module-switch-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span class="card-title">功能模块开关</span>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon class="intro-alert">
        <template #title>停用模块会隐藏小程序对应入口；若该模块配置了接口路径，后端还会拦截这些接口</template>
        <div class="intro-lines">
          <div>· 本次需求：停用 <code>merchant</code> 即可隐藏小程序「我的 → 商家入驻」入口（该模块不应配置接口路径，只做显隐）。</div>
          <div>· ⚠️ <code>delivery</code> 的接口路径含 <code>/api/merchant/**</code> ⇒ 停用它会连商家端接口一起拦掉，非必要不要关。</div>
          <div>· <code>basic</code> 为必买模块，不可停用（开关已置灰）。</div>
        </div>
      </el-alert>

      <el-alert v-if="merchantHint" type="warning" :closable="false" show-icon class="intro-alert">
        <template #title>还没有「商家入驻」模块可关</template>
        <div class="intro-lines">{{ merchantHint }}</div>
      </el-alert>

      <el-alert v-if="loadError" type="error" :closable="false" show-icon class="intro-alert">
        <template #title>加载失败</template>
        <div class="intro-lines">{{ loadError }}</div>
      </el-alert>

      <el-table v-loading="loading" :data="modules" border stripe empty-text="暂无模块配置">
        <el-table-column prop="moduleName" label="模块名称" min-width="150">
          <template #default="{ row }">
            <span>{{ row.moduleName }}</span>
            <el-tag v-if="isProtected(row)" size="small" type="info" class="key-tag">不可停用</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="moduleKey" label="模块标识" width="140">
          <template #default="{ row }"><code>{{ row.moduleKey }}</code></template>
        </el-table-column>

        <el-table-column label="拦截的接口路径" min-width="300">
          <template #default="{ row }">
            <template v-if="patternList(row).length">
              <el-tag v-for="p in patternList(row)" :key="p" size="small" type="danger" effect="plain" class="pattern-tag">
                {{ p }}
              </el-tag>
              <div class="pattern-warn">⚠️ 停用后这些路径会被后端拦截</div>
            </template>
            <span v-else class="pattern-none">未配置（停用只影响前端显隐）</span>
          </template>
        </el-table-column>

        <el-table-column prop="sortOrder" label="排序" width="90" align="center" />

        <el-table-column label="启停" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled === 1"
              :disabled="isProtected(row) || savingKey === row.moduleKey"
              :loading="savingKey === row.moduleKey"
              active-text="启用"
              inactive-text="停用"
              inline-prompt
              @change="(val: string | number | boolean) => onToggle(row, val)"
            />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.module-switch-page { padding: 16px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 16px; font-weight: 600; }
.intro-alert { margin-bottom: 12px; }
.intro-lines { margin-top: 4px; font-size: 13px; line-height: 22px; }
.key-tag { margin-left: 8px; }
.pattern-tag { margin: 0 6px 4px 0; }
.pattern-warn { color: #f56c6c; font-size: 12px; }
.pattern-none { color: #909399; font-size: 12px; }
</style>
