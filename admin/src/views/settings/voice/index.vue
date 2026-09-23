<script setup lang="ts">
/**
 * 语音配置管理（阿里云语音外呼：全局参数 + 场景播报文案）。
 *
 * 依据：`docs/20269231438/语音配置后台-前端对接说明-2026-09-24.md`
 * （§2.3 三个"不能呼"字段 / §3 两个写接口 / §4 source 速查 / §5 长度与截断 / §7 页面骨架）。
 *
 * ## 与「短信模板管理」页的关系
 * 两页互不重叠：短信页只能改"用哪个模板码"（文案在阿里云短信控制台），
 * **本页能改"每个场景念什么"**（阿里云只提供通用 TTS 模板，正文由我们传入）。
 * 场景只有 **3 条**（真会打电话的）。
 *
 * ## ⚠️⚠️ 三个"看起来都能表示不能呼"的字段，语义完全不同（§2.3）
 * | 情况 | 含义 | 运营要做什么 |
 * |---|---|---|
 * | `blocked=true` / `source=DB_DISABLED` | **运营显式停用**，且**不回落**代码文案 | 想恢复就重填模板 + `enabled=true` |
 * | `source=FALLBACK`（`contentTemplate=null`） | **没配过**，播报用代码里现成的摘要（与改造前完全一致） | **不用管** |
 * | `truncatedAtRuntime=true` | 模板**能用**，但渲染后超 50 字，实际只念前 50 字 | **把模板改短**（否则后半句永远不播） |
 *
 * ## ⛔ 不要做（§7.5）
 * 编辑阿里云模板文案的入口、"新增场景"按钮、"删除场景"（场景是代码里真实会呼的，共 3 条）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getVoiceConfig, updateVoiceConfig, updateVoiceTemplate } from '@/api/voice'
import { VOICE_TEMPLATE_VARIABLES } from '@/types/voice'
import type {
  VoiceConfigData,
  VoiceConfigUpdate,
  VoiceGlobalSource,
  VoiceSceneItem,
  VoiceSceneSource,
} from '@/types/voice'

const router = useRouter()

const loading = ref(false)
const savingGlobal = ref(false)
const savingScene = ref('')
const data = ref<VoiceConfigData | null>(null)
const loadError = ref('')

/** 场景文案编辑缓存：`displayKey -> 正在编辑的文案`。 */
const sceneDrafts = reactive<Record<string, string>>({})
/** 场景开关缓存：`displayKey -> 是否允许外呼`。 */
const sceneEnabled = reactive<Record<string, boolean>>({})

/** 全局参数表单。 */
const form = reactive<{
  voiceCode: string
  enabled: boolean
  /** 显号三态：`keep` 不改（**不带该键**）/ `pool` 显式公共号池（传 `''`）/ `custom` 指定号码。 */
  callerMode: 'keep' | 'pool' | 'custom'
  callerNumber: string
  reason: string
}>({
  voiceCode: '',
  enabled: true,
  callerMode: 'keep',
  callerNumber: '',
  reason: '',
})

/** 多实例最大滞后秒数（用于页面提示）。 */
const cacheLagSeconds = computed(() => data.value?.cacheTtlSeconds || 0)

/** 模板码格式（与后端一致：忽略大小写的 `TTS_` + 6~12 位数字）。 */
const VOICE_CODE_PATTERN = /^TTS_[0-9]{6,12}$/i

/** 全局参数来源文案。 */
function globalSourceLabel(source: VoiceGlobalSource): string {
  const map: Record<VoiceGlobalSource, string> = {
    DB: '后台已配置并生效（覆盖了服务端配置）',
    DB_DISABLED: '后台已停用（且不会回落服务端配置）',
    YML_FALLBACK: '来自服务端静态配置',
    NONE: '两层都没有 ⇒ 语音根本呼不出去',
  }
  return map[source] || source
}

/** 场景文案来源文案（三态）。 */
function sceneSourceLabel(source: VoiceSceneSource): string {
  const map: Record<VoiceSceneSource, string> = {
    DB: '后台配置',
    DB_DISABLED: '已被后台停用（不会回落代码文案）',
    FALLBACK: '未配过，用代码里的摘要（行为与改造前一致，不用管）',
  }
  return map[source] || source
}

/** 全局参数是否处于"呼不出去"的红状态。 */
const globalTone = computed<'danger' | 'normal'>(() => {
  const current = data.value
  if (!current) return 'normal'
  if (current.blocked) return 'danger'
  if (current.source === 'DB_DISABLED' || current.source === 'NONE') return 'danger'
  return 'normal'
})

/** 被叫角色中文。 */
function roleLabel(role: string): string {
  if (role === 'MERCHANT') return '门店'
  return '收货人'
}

/** 场景卡片色调：只有"显式停用"才红；`FALLBACK` 是正常（不用管）。 */
function sceneTone(item: VoiceSceneItem): 'danger' | 'warning' | 'info' {
  if (item.blocked || item.source === 'DB_DISABLED') return 'danger'
  if (item.truncatedAtRuntime) return 'warning'
  return 'info'
}

/** 场景状态结论（把三个"不能呼"的语义分开说）。 */
function sceneToneText(item: VoiceSceneItem): string {
  if (item.blocked || item.source === 'DB_DISABLED') return '已被停用，不外呼（不会回落代码文案）'
  if (item.truncatedAtRuntime) return '能呼，但实际只念前若干字，建议改短'
  if (item.source === 'FALLBACK') return '未配过，用代码摘要（不用管）'
  return '正常'
}

/** 拉取配置。 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getVoiceConfig()
    data.value = result
    form.voiceCode = result.voiceCode || ''
    form.enabled = result.enabled
    // 显号回填：DB 里的值与"是否覆盖"是两件事，默认按"不修改"提交，避免误清显号
    form.callerMode = 'keep'
    form.callerNumber = result.callerNumber || ''
    form.reason = ''
    // 场景草稿
    Object.keys(sceneDrafts).forEach((key) => delete sceneDrafts[key])
    Object.keys(sceneEnabled).forEach((key) => delete sceneEnabled[key])
    result.items.forEach((item) => {
      sceneDrafts[item.displayKey] = item.contentTemplate || ''
      sceneEnabled[item.displayKey] = item.enabled
    })
  } catch (error) {
    data.value = null
    loadError.value = error instanceof Error ? error.message : '语音配置查询失败'
  } finally {
    loading.value = false
  }
}

/**
 * 保存全局参数。
 * ⚠️ `callerNumber` 三态：`keep` ⇒ **完全不构造这个键**（= 后端不改），
 * 否则"只换个模板码"会把现有显号清掉（文档 §3.1 特意点出的坑）。
 */
async function saveGlobal(): Promise<void> {
  const code = form.voiceCode.trim()
  if (code && !VOICE_CODE_PATTERN.test(code)) {
    ElMessage.warning('模板码格式不对，形如 TTS_328595660（TTS_ + 6~12 位数字）')
    return
  }
  if (form.callerMode === 'custom' && !form.callerNumber.trim()) {
    ElMessage.warning('请填写指定显号，或改为「显式公共号池」')
    return
  }
  // 语义二义：留空模板码 + 停用 —— 从交互上避免（文档 §6 最后一行）
  if (!code && !form.enabled) {
    ElMessage.warning('「留空模板码」与「停用」不能同时提交：留空是清除覆盖、停用是保留行但不外呼，二者语义冲突')
    return
  }

  const body: VoiceConfigUpdate = {
    voiceCode: code || null,
    enabled: form.enabled,
    reason: form.reason.trim() || null,
  }
  if (form.callerMode === 'pool') body.callerNumber = ''
  else if (form.callerMode === 'custom') body.callerNumber = form.callerNumber.trim()
  // 'keep' ⇒ 不设置 callerNumber 键

  savingGlobal.value = true
  try {
    const result = await updateVoiceConfig(body)
    const hint = result.cleared === 'DB_OVERRIDE_CLEARED'
      ? '已清除后台覆盖，回落服务端配置'
      : result.cleared === 'NO_OVERRIDE_TO_CLEAR'
        ? '本来就没有覆盖（无需清除）'
        : '已保存'
    ElMessage.success(`${hint}：生效模板码 ${result.voiceCode || '（无）'}`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '语音全局配置保存失败')
  } finally {
    savingGlobal.value = false
  }
}

/** 保存某个场景的播报文案 / 开关。 */
async function saveScene(item: VoiceSceneItem): Promise<void> {
  const draft = (sceneDrafts[item.displayKey] || '').trim()
  const enabled = sceneEnabled[item.displayKey]
  // 语义二义：留空文案 + 停用（后端 1000）
  if (!draft && enabled === false) {
    ElMessage.warning('「留空文案」与「停用」不能同时提交：留空是清除覆盖、停用是保留行但不外呼')
    return
  }
  // 变量白名单校验（后端会 1000，前端提前拦更友好）
  const used = draft.match(/\{[A-Za-z]+\}/g) || []
  const illegal = used.filter((name) => !(VOICE_TEMPLATE_VARIABLES as readonly string[]).includes(name))
  if (illegal.length) {
    ElMessage.warning(`模板含未知变量 ${illegal.join('、')}：只支持 ${VOICE_TEMPLATE_VARIABLES.join('、')}（TTS 会把未知变量当字面量念出来）`)
    return
  }

  savingScene.value = item.displayKey
  try {
    const result = await updateVoiceTemplate(item.displayKey, {
      contentTemplate: draft || null,
      enabled: enabled !== false,
      reason: null,
    })
    ElMessage.success(result.cleared ? '已清除后台覆盖，回落代码文案' : '场景文案已保存')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '语音场景文案保存失败')
  } finally {
    savingScene.value = ''
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>语音配置管理</h1>
        <p>阿里云语音外呼的<strong>全局参数</strong>与<strong>各场景播报文案</strong>。改完即时生效，多实例下最多滞后 {{ cacheLagSeconds }} 秒。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="block">
      <template #title>查询失败，本次结果不可用</template>
      <p class="hint">{{ loadError }}</p>
    </el-alert>

    <template v-else>
      <!-- ① 全局停用：最醒目 -->
      <el-alert v-if="data && data.blocked" type="error" :closable="false" show-icon class="block">
        <template #title>全局语音已被停用：所有场景都不会外呼</template>
        <p class="hint">当前 DB 配置处于停用状态（且<strong>不会回落</strong>服务端配置）。要恢复请重新填写模板码并打开全局开关。</p>
      </el-alert>

      <!-- 页面提示语（后端给，原样展示） -->
      <el-alert v-if="data?.notice" type="info" :closable="false" class="block">
        <p class="hint">{{ data.notice }}</p>
      </el-alert>

      <!-- ② 全局参数 -->
      <el-card v-if="data" shadow="never" class="block" :class="{ 'card-danger': globalTone === 'danger' }">
        <template #header>
          <div class="card-head">
            <strong>全局参数</strong>
            <el-tag :type="globalTone === 'danger' ? 'danger' : 'success'" size="small">
              {{ globalSourceLabel(data.source) }}
            </el-tag>
          </div>
        </template>

        <el-form label-width="110px">
          <el-form-item label="语音模板码">
            <el-input v-model="form.voiceCode" placeholder="TTS_328595660" clearable />
            <p class="hint"><strong>留空 = 清除后台覆盖</strong>，回落服务端配置（可逆）。</p>
          </el-form-item>

          <el-form-item label="当前生效值">
            <span>
              <code>{{ data.effectiveVoiceCode || '（无）' }}</code>
              <el-tag v-if="data.effectiveVoiceCodeSource === 'CHANNEL_STATIC'" size="small" type="info" class="ml">
                来自服务端配置
              </el-tag>
              <el-tag v-else-if="data.effectiveVoiceCodeSource === 'NONE'" size="small" type="danger" class="ml">
                没有可用模板码，呼不出去
              </el-tag>
            </span>
          </el-form-item>

          <el-form-item label="显号">
            <el-radio-group v-model="form.callerMode">
              <el-radio value="keep">不修改（推荐）</el-radio>
              <el-radio value="pool">显式公共号池</el-radio>
              <el-radio value="custom">指定号码</el-radio>
            </el-radio-group>
            <el-input
              v-if="form.callerMode === 'custom'"
              v-model="form.callerNumber"
              class="mt"
              placeholder="只允许数字 / + / - / 空格，≤32 位"
            />
            <p class="hint">
              当前：{{ data.callerNumberDescription }}
              <template v-if="form.callerMode === 'keep'">
                —— 选「不修改」时请求里<strong>不会带显号字段</strong>，只换模板码不会误清显号。
              </template>
              <template v-else-if="form.callerMode === 'pool'">
                —— 传空串 = 不指定显号，由阿里云公共号池随机分配。
              </template>
            </p>
          </el-form-item>

          <el-form-item label="全局开关">
            <el-switch v-model="form.enabled" />
            <span class="hint inline">关闭 = 全局停用（保留后台配置、不回落，谁都不呼）</span>
          </el-form-item>

          <el-form-item label="变更原因">
            <el-input v-model="form.reason" placeholder="写入审计留痕（可选）" />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="savingGlobal" @click="saveGlobal">保存全局参数</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- ③ 场景列表 -->
      <h2 class="group-title">
        外呼场景
        <el-tag type="info" size="small">{{ data?.sceneCount ?? 0 }} 条</el-tag>
        <span class="hint inline">场景是代码里真实会呼的，不支持新增 / 删除</span>
      </h2>

      <el-card
        v-for="item in data?.items || []"
        :key="item.displayKey"
        shadow="never"
        :class="['scene-card', `tone-${sceneTone(item)}`]"
      >
        <div class="scene-head">
          <div class="scene-title">
            <strong>{{ item.sceneLabel }}</strong>
            <el-tag size="small" effect="plain">被叫：{{ roleLabel(item.role) }}</el-tag>
            <code class="scene-key">{{ item.displayKey }}</code>
          </div>
          <el-tag :type="sceneTone(item) === 'info' ? 'success' : sceneTone(item)" size="small">
            {{ sceneToneText(item) }}
          </el-tag>
        </div>

        <p v-if="item.triggerPoint" class="trigger">触发点：{{ item.triggerPoint }}</p>
        <p v-if="item.note" class="hint">{{ item.note }}</p>

        <div class="scene-body">
          <div class="scene-editor">
            <p class="field-label">
              播报文案模板
              <span class="hint inline">
                可用变量：{{ VOICE_TEMPLATE_VARIABLES.join('、') }}（大小写不敏感，写别的后端会拒绝）
              </span>
            </p>
            <el-input
              v-model="sceneDrafts[item.displayKey]"
              type="textarea"
              :rows="3"
              maxlength="200"
              show-word-limit
              :placeholder="item.renderedSample ? `留空则用代码摘要，例如：${item.renderedSample}` : '留空 = 清除后台覆盖，回落代码里的摘要文案'"
            />
            <p class="hint">
              <strong>留空 = 清除后台覆盖</strong>，回落代码里现成的摘要文案。业务上限 200 字。
            </p>
          </div>

          <div class="scene-preview">
            <p class="field-label">实际播报（运行期截断后）</p>
            <pre class="preview-text">{{ item.runtimeText || item.renderedSample || '（无）' }}</pre>
            <p class="hint">
              运行期上限 {{ item.runtimeMaxChars }} 字（当前 <code>runtimeContentMaxChars = {{ data?.runtimeContentMaxChars }}</code>）。
            </p>
            <!-- 三个"不能呼"的第三种：能呼但会被截断 ⇒ 必须显式告诉运营 -->
            <el-alert v-if="item.truncatedAtRuntime" type="warning" :closable="false" show-icon class="mt">
              <template #title>渲染后超过 {{ item.runtimeMaxChars }} 字，实际只念前 {{ item.runtimeMaxChars }} 字</template>
              <p class="hint">{{ item.truncationHint || '后半句永远不会播出来，建议把模板改短。' }}</p>
            </el-alert>
          </div>
        </div>

        <div class="scene-actions">
          <el-switch v-model="sceneEnabled[item.displayKey]" active-text="允许外呼" />
          <el-button
            type="primary"
            size="small"
            :loading="savingScene === item.displayKey"
            @click="saveScene(item)"
          >
            保存该场景
          </el-button>
          <span class="hint inline">来源：{{ sceneSourceLabel(item.source) }}</span>
        </div>
      </el-card>

      <!-- ④ 只读信息区 -->
      <el-card v-if="data" shadow="never" class="block mt-lg">
        <template #header><strong>只读信息</strong></template>
        <div class="readonly-grid">
          <div>
            <span class="field-label">渠道静态配置</span>
            <p class="hint">
              <template v-if="data.channelStatic">
                模板码 <code>{{ data.channelStatic.templateCode || '（无）' }}</code> ·
                显号 <code>{{ data.channelStatic.callerNumberDescription || data.channelStatic.callerNumber || '（无）' }}</code>
                <template v-if="data.channelStatic.label"> · {{ data.channelStatic.label }}</template>
              </template>
              <template v-else>该渠道不提供静态视图</template>
            </p>
          </div>
          <div>
            <span class="field-label">配置键说明</span>
            <p class="hint">{{ data.configKeyHint || '—' }}</p>
          </div>
          <div>
            <span class="field-label">缓存与查询时间</span>
            <p class="hint">
              进程内缓存 {{ data.cacheTtlSeconds }} 秒（多实例最大滞后同值）· 查询时间 {{ data.fetchedAt || '—' }}
            </p>
          </div>
        </div>
        <el-link type="primary" @click="router.push('/settings/sms-templates')">
          去「短信模板管理」页（短信通道，文案在阿里云改）↗
        </el-link>
      </el-card>
    </template>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; }
.mt { margin-top: 8px; }
.mt-lg { margin-top: 22px; }
.ml { margin-left: 8px; }
.hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.hint.inline { margin: 0; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.card-danger { border-left: 4px solid var(--el-color-danger); }
.group-title { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 16px; }
.scene-card { margin-bottom: 14px; border-left: 4px solid var(--el-border-color); }
.scene-card.tone-danger { border-left-color: var(--el-color-danger); }
.scene-card.tone-warning { border-left-color: var(--el-color-warning); }
.scene-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.scene-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.6; }
.scene-key { color: var(--el-text-color-secondary); font-size: 12px; }
.trigger { margin: 10px 0 0; font-size: 13px; line-height: 1.7; }
.scene-body { display: flex; gap: 18px; margin-top: 12px; }
.scene-editor { flex: 1 1 0; min-width: 0; }
.scene-preview { flex: 0 0 280px; }
.field-label { display: block; margin: 0 0 6px; color: var(--el-text-color-regular); font-size: 13px; font-weight: 600; }
.preview-text { margin: 0; padding: 10px 12px; background: var(--el-fill-color-light); border-radius: 6px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
.scene-actions { display: flex; align-items: center; gap: 16px; margin-top: 14px; flex-wrap: wrap; }
.readonly-grid { display: flex; flex-direction: column; gap: 14px; }
</style>
