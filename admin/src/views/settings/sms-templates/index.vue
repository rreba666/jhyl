<script setup lang="ts">
/**
 * 短信模板管理（阶段 → 阿里云模板编码）。
 *
 * 依据：`docs/20269231438/短信模板后台-前端对接说明-2026-09-23.md`（§3 语义 / §4 写接口 / §5 三种不可全信 / §6 页面结构 / §7 染色规则）。
 *
 * ## 这个页面管什么、不管什么
 * - **管**：把某个业务阶段（`场景@角色`）映射到阿里云某个**模板编码**，可停用、可清除后台覆盖；
 * - **不管**：模板**文案**（内容）—— 文案在阿里云控制台改，本页只提供跳转入口。
 *   ⛔ 不要在这里做"编辑文案"。
 *
 * ## 四条禁止（文档 §6，改这个页面前先读）
 * 1. ⛔ 不提供"编辑模板**文案**"入口；
 * 2. ⛔ 不把 `MISSING` 与 `CREDENTIALS_NOT_CONFIGURED` 显示成同一句话
 *    （前者让运营去阿里云建模板，后者让运维配密钥 —— 搞反等于白折腾）；
 * 3. ⛔ 不用 `content === null` / `configured === false` 直接判"缺模板"，**先看 `needsAction`**；
 * 4. ⛔ 不给 `adminEditable === false` 的条目渲染编辑框（会让运营以为改成功了）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getSmsTemplates, updateSmsTemplateCode } from '@/api/sms'
import type {
  SmsAuditStatus,
  SmsTemplateChannel,
  SmsTemplateCodeSource,
  SmsTemplateErrorCode,
  SmsTemplateItem,
  SmsTemplateListData,
  SmsTemplateSource,
} from '@/types/sms'

const loading = ref(false)
/** 用于 SPA 内跳转到语音配置页（用 `href` 会整页刷新，丢当前筛选状态）。 */
const router = useRouter()
const saving = ref(false)
const data = ref<SmsTemplateListData | null>(null)
const loadError = ref('')
const items = ref<SmsTemplateItem[]>([])

/** 编辑弹窗状态。 */
const dialogVisible = ref(false)
const editing = ref<SmsTemplateItem | null>(null)
const form = reactive<{ templateCode: string; enabled: boolean; reason: string }>({
  templateCode: '',
  enabled: true,
  reason: '',
})

/** 文案（内容）缓存滞后分钟数：`cacheTtlSeconds` 默认 600 ⇒ 10 分钟。 */
const cacheLagMinutes = computed(() => Math.max(0, Math.round((data.value?.cacheTtlSeconds || 0) / 60)))

/**
 * 三组分组（互斥）。
 * `needsAction = configurable && smsApplicable && !configured` ⇒ 需要处理的项必然 `configured=false`。
 */
const needActionItems = computed(() => items.value.filter((item) => item.needsAction))
const configuredItems = computed(() => items.value.filter((item) => !item.needsAction && item.configured))
const otherChannelItems = computed(() => items.value.filter((item) => !item.needsAction && !item.configured))

/** 角色中文。 */
function roleLabel(role: SmsTemplateItem['role']): string {
  if (role === 'MERCHANT') return '商家侧'
  if (role === 'DELIVERY_PERSON') return '骑手侧'
  return '用户侧'
}

/** 通道中文。 */
function channelLabel(channel: SmsTemplateChannel): string {
  const map: Record<SmsTemplateChannel, string> = {
    SMS: '短信',
    VOICE: '语音',
    SUBSCRIBE: '订阅消息',
    NONE: '无通知',
  }
  return map[channel] || channel
}

/** 文案来源文案（⚠️ `MISSING` 与凭证未配置是**两件事**，不要混）。 */
function sourceLabel(source: SmsTemplateSource): string {
  const map: Record<SmsTemplateSource, string> = {
    ALIYUN: '已读到阿里云文案',
    LOCAL_PLACEHOLDER: '已配编码但未读到文案',
    MISSING: '缺模板（短信发不出去）',
    CHANNEL_NOT_SMS: '该阶段不走短信，不是缺口',
  }
  return map[source] || source
}

/** 编码来源文案（告运营"我在改哪一层"）。 */
function codeSourceLabel(source: SmsTemplateCodeSource): string {
  const map: Record<SmsTemplateCodeSource, string> = {
    DB: '后台配置（本页可改）',
    DB_DISABLED: '已被后台显式停用（不会回落服务端配置）',
    YML_FALLBACK: '来自服务端配置（尚未在后台改过）',
    NONE: '两层都没有',
  }
  return map[source] || source
}

/** 阿里云审核状态文案（⚠️ 只有读到内容时才有值，null 时显示"未读取"）。 */
function auditLabel(status: SmsAuditStatus | null): string {
  if (!status) return '未读取'
  const map: Record<SmsAuditStatus, string> = {
    AUDIT_STATE_PASS: '审核通过',
    AUDIT_STATE_INIT: '审核中',
    AUDIT_STATE_NOT_PASS: '审核未通过',
    AUDIT_STATE_CANCEL: '审核取消',
  }
  return map[status] || status
}

/** 失败原因码的处置建议（照文档 §3.5）。 */
function errorHint(code: SmsTemplateErrorCode | null): string {
  if (!code) return ''
  const map: Record<SmsTemplateErrorCode, string> = {
    CREDENTIALS_NOT_CONFIGURED: '让运维配置 aliyun.sms.access-key-id / access-key-secret / sign-name',
    ALIYUN_ERROR: '去阿里云控制台核对模板编码与账号权限',
    FETCH_EXCEPTION: '稍后重试；持续失败让运维查出网与超时配置',
    TEMPLATE_CODE_BLANK: '该条目没有模板编码',
    PORT_UNAVAILABLE: '让后端确认部署是否包含 fengling-sms',
  }
  return map[code] || ''
}

/** 单条的色调（文档 §7「染色规则」，顺序即优先级）。 */
function toneOf(item: SmsTemplateItem): 'danger' | 'warning' | 'success' | 'info' {
  if (item.needsAction) return 'danger'
  if (item.templateCodeSource === 'DB_DISABLED') return 'danger'
  if (item.configured && item.source === 'LOCAL_PLACEHOLDER') return 'warning'
  if (item.configured && item.source === 'ALIYUN' && item.auditStatus === 'AUDIT_STATE_PASS') return 'success'
  if (item.configured && item.source === 'ALIYUN' && item.auditStatus !== 'AUDIT_STATE_PASS') return 'warning'
  // !smsApplicable：该阶段不走短信，不是缺口 ⇒ 灰
  return 'info'
}

/** 单条的结论文案（用 `needsAction` 判红，不用 `source`）。 */
function toneText(item: SmsTemplateItem): string {
  if (item.needsAction) return '缺模板：该阶段短信发不出去'
  if (item.templateCodeSource === 'DB_DISABLED') return '已被后台显式停用'
  if (item.configured && item.source === 'LOCAL_PLACEHOLDER') return '已配置但未读到文案'
  if (item.configured && item.source === 'ALIYUN' && item.auditStatus === 'AUDIT_STATE_PASS') return '正常'
  if (item.configured && item.source === 'ALIYUN') return '审核中/未通过'
  return '该阶段不走短信'
}

/** 拉取列表。 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const result = await getSmsTemplates()
    data.value = result
    items.value = result.items
  } catch (error) {
    data.value = null
    items.value = []
    loadError.value = error instanceof Error ? error.message : '短信模板查询失败'
  } finally {
    loading.value = false
  }
}

/** 打开编辑弹窗（⚠️ 只有 `adminEditable=true` 才允许）。 */
function openEdit(item: SmsTemplateItem): void {
  if (!item.adminEditable) return
  editing.value = item
  form.templateCode = item.templateCode || ''
  form.enabled = item.templateCodeSource !== 'DB_DISABLED'
  form.reason = ''
  dialogVisible.value = true
}

/**
 * 提交编辑。
 * ⚠️ 三种语义（文档 §4）：填码=正常配置；填码 + 关 enabled=**显式停用**；
 * **留空**=清除后台覆盖、回落服务端静态配置（若本来就没有覆盖，后端会以"语义二义"拒绝）。
 */
async function submitEdit(): Promise<void> {
  const target = editing.value
  if (!target) return
  saving.value = true
  try {
    const result = await updateSmsTemplateCode(target.displayKey, {
      templateCode: form.templateCode.trim() || null,
      enabled: form.enabled,
      reason: form.reason.trim() || null,
    })
    const action = result.cleared === 'DB_OVERRIDE_CLEARED' ? '已清除后台覆盖' : '已保存'
    ElMessage.success(`${action}：${result.templateCode || '（无编码）'}`)
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '模板编码修改失败')
  } finally {
    saving.value = false
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
        <h1>短信模板管理</h1>
        <p>按业务阶段查看短信模板的真实文案与审核状态；<strong>文案请去阿里云改</strong>，本页只改模板编码。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 接口报错：不渲染成"0 条"，也不与"缺模板"混为一谈 -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="block">
      <template #title>查询失败，本次结果不可用</template>
      <p class="hint">{{ loadError }}</p>
    </el-alert>

    <template v-else>
      <!-- 顶部说明区 -->
      <el-card v-if="data" shadow="never" class="block">
        <p class="notice">{{ data.notice }}</p>
        <div class="meta">
          <span>查询时间：{{ data.fetchedAt || '—' }}</span>
          <span>文案数据最多滞后 {{ cacheLagMinutes }} 分钟（缓存 {{ data.cacheTtlSeconds }} 秒）</span>
          <span>编码改完<strong>即时生效</strong>（多实例下最多滞后 30 秒）</span>
        </div>
        <div class="actions">
          <el-link v-if="data.templateDocsUrl" type="primary" :href="data.templateDocsUrl" target="_blank">
            去阿里云改文案 ↗
          </el-link>
        </div>
      </el-card>

      <!-- 凭证横幅：⚠️ 绝不要把这种条目渲染成"没有模板"（那是让运营去阿里云建模板，方向就错了） -->
      <el-alert
        v-if="data && !data.credentialsConfigured"
        type="warning"
        :closable="false"
        show-icon
        class="block"
      >
        <template #title>短信密钥未配置，所有模板内容都读不到</template>
        <p class="hint">{{ data.credentialsHint || '请让运维配置阿里云短信凭证（AccessKeyId / Secret / signName）。' }}</p>
        <p class="hint">
          这是<strong>凭证缺失</strong>，不是"没有模板"—— 先配密钥，不要先去阿里云建模板。
        </p>
      </el-alert>

      <!-- 概览 -->
      <el-card v-if="data" shadow="never" class="block">
        <div class="summary">
          <div class="summary-item">
            <span class="summary-label">阶段总数</span>
            <span class="summary-value">{{ data.total }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">已配编码</span>
            <span class="summary-value">{{ data.configuredCount }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">缺模板（需处理）</span>
            <span class="summary-value" :class="{ danger: data.missingCount > 0 }">{{ data.missingCount }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">已读文案</span>
            <span class="summary-value" :class="{ warning: data.contentReadCount < data.configuredCount }">
              {{ data.contentReadCount }}
            </span>
          </div>
        </div>
        <!-- 第三种"不可全信"：已配的编码有部分内容没读到 -->
        <p v-if="data.credentialsConfigured && data.contentReadCount < data.configuredCount" class="hint">
          有已配模板的内容没读到（{{ data.contentReadCount }} / {{ data.configuredCount }}），
          逐条看「失败原因」—— 多为模板被删 / 换账号 / RAM 未授权。
        </p>
      </el-card>

      <!-- 分组 1：需要处理（默认置顶、红） -->
      <div v-if="data" class="group">
        <h2 class="group-title">
          需要处理
          <el-tag v-if="needActionItems.length" type="danger" size="small">{{ needActionItems.length }}</el-tag>
          <el-tag v-else type="success" size="small">无</el-tag>
        </h2>
        <el-empty v-if="!needActionItems.length" description="没有需要处理的阶段" :image-size="60" />
        <el-card
          v-for="item in needActionItems"
          :key="item.displayKey"
          shadow="never"
          :class="['row-card', `tone-${toneOf(item)}`]"
        >
          <div class="row-head">
            <div class="row-title">
              <strong>{{ item.sceneLabel }}</strong>
              <el-tag size="small" effect="plain">{{ roleLabel(item.role) }}</el-tag>
              <code class="scene">{{ item.displayKey }}</code>
            </div>
            <el-tag :type="toneOf(item)" size="small">{{ toneText(item) }}</el-tag>
          </div>
          <div class="row-body">
            <span>编码：<code>{{ item.templateCode || '（无）' }}</code></span>
            <span>编码来源：{{ codeSourceLabel(item.templateCodeSource) }}</span>
            <span v-if="item.templateCodeConfigKey">
              配置键：<code>{{ item.templateCodeConfigKey }}</code>
            </span>
            <span v-if="item.note" class="note">{{ item.note }}</span>
          </div>
          <p v-if="item.error" class="error-text">失败原因：{{ item.error }}（{{ errorHint(item.errorCode) }}）</p>
          <div class="row-actions">
            <el-button v-if="item.adminEditable" type="primary" size="small" @click="openEdit(item)">
              填写模板编码
            </el-button>
            <span v-else class="not-editable">该码由服务端配置决定，本页不可改</span>
          </div>
        </el-card>
      </div>

      <!-- 分组 2：已配置 -->
      <div v-if="data" class="group">
        <h2 class="group-title">已配置 <el-tag type="info" size="small">{{ configuredItems.length }}</el-tag></h2>
        <el-empty v-if="!configuredItems.length" description="暂无已配置阶段" :image-size="60" />
        <el-card
          v-for="item in configuredItems"
          :key="item.displayKey"
          shadow="never"
          :class="['row-card', `tone-${toneOf(item)}`]"
        >
          <div class="row-head">
            <div class="row-title">
              <strong>{{ item.sceneLabel }}</strong>
              <el-tag size="small" effect="plain">{{ roleLabel(item.role) }}</el-tag>
              <code class="scene">{{ item.displayKey }}</code>
            </div>
            <el-tag :type="toneOf(item)" size="small">{{ toneText(item) }}</el-tag>
          </div>
          <div class="row-body">
            <span>编码：<code>{{ item.templateCode }}</code></span>
            <span>{{ codeSourceLabel(item.templateCodeSource) }}</span>
            <span>审核：{{ auditLabel(item.auditStatus) }}</span>
            <span v-if="item.auditMessage" class="note">{{ item.auditMessage }}</span>
          </div>
          <div v-if="item.content" class="content-box">
            <p class="content-label">
              阿里云文案
              <span v-if="item.variables.length">变量：{{ item.variables.join('、') }}</span>
            </p>
            <pre class="content-text">{{ item.content }}</pre>
          </div>
          <p v-if="!item.content" class="hint">
            未读取到文案（{{ sourceLabel(item.source) }}）—— 文案在阿里云改，本页只读展示。
          </p>
          <p v-if="item.error" class="error-text">失败原因：{{ item.error }}（{{ errorHint(item.errorCode) }}）</p>
          <div class="row-actions">
            <el-button v-if="item.adminEditable" size="small" @click="openEdit(item)">修改模板编码</el-button>
            <span v-else class="not-editable">该码由服务端配置决定，本页不可改</span>
            <el-link v-if="data?.templateDocsUrl" type="primary" :href="data.templateDocsUrl" target="_blank">
              去阿里云编辑文案 ↗
            </el-link>
          </div>
        </el-card>
      </div>

      <!-- 分组 3：其他通道（灰，不是缺口） -->
      <div v-if="data" class="group">
        <h2 class="group-title">其他通道 <el-tag type="info" size="small">{{ otherChannelItems.length }}</el-tag></h2>
        <el-empty v-if="!otherChannelItems.length" description="暂无" :image-size="60" />
        <el-card
          v-for="item in otherChannelItems"
          :key="item.displayKey"
          shadow="never"
          class="row-card tone-info"
        >
          <div class="row-head">
            <div class="row-title">
              <strong>{{ item.sceneLabel }}</strong>
              <el-tag size="small" effect="plain">{{ roleLabel(item.role) }}</el-tag>
              <el-tag size="small" type="info">走{{ channelLabel(item.channel) }}</el-tag>
              <code class="scene">{{ item.displayKey }}</code>
            </div>
          </div>
          <p class="hint">
            该阶段当前不走短信（{{ channelLabel(item.channel) }}），<strong>不是缺模板</strong>，不计入告警。
            <template v-if="item.note">{{ item.note }}</template>
          </p>
          <div class="row-actions">
            <el-link
              v-if="item.channel === 'VOICE'"
              type="primary"
              @click="router.push('/settings/voice')"
            >
              去「语音配置管理」↗
            </el-link>
          </div>
        </el-card>
      </div>
    </template>

    <!-- 编辑模板编码 -->
    <el-dialog v-model="dialogVisible" title="修改模板编码" width="520px" append-to-body>
      <el-form label-width="92px">
        <el-form-item label="阶段">
          <span>{{ editing?.sceneLabel }}（{{ editing?.displayKey }}）</span>
        </el-form-item>
        <el-form-item label="模板编码">
          <el-input
            v-model="form.templateCode"
            placeholder="形如 SMS_512035080（SMS_ + 6~12 位数字）"
            clearable
          />
          <p class="hint">
            <strong>留空 = 清除后台覆盖</strong>，回落服务端静态配置（可逆；若本来就没有覆盖，后端会拒绝）。
          </p>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
          <p class="hint">
            关闭 = <strong>显式停用</strong>（保留后台记录、<strong>不回落</strong>服务端配置 ⇒ 该阶段短信发不出去）。
          </p>
        </el-form-item>
        <el-form-item label="变更原因">
          <el-input v-model="form.reason" placeholder="写入审计留痕（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; }
.hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.notice { margin: 0; line-height: 1.7; }
.meta { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 10px; color: var(--el-text-color-secondary); font-size: 13px; }
.actions { margin-top: 10px; }
.summary { display: flex; flex-wrap: wrap; gap: 32px; }
.summary-item { display: flex; flex-direction: column; gap: 6px; }
.summary-label { color: var(--el-text-color-secondary); font-size: 13px; }
.summary-value { font-size: 22px; font-weight: 700; }
.summary-value.danger { color: var(--el-color-danger); }
.summary-value.warning { color: var(--el-color-warning); }
.group { margin-bottom: 22px; }
.group-title { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 16px; }
.row-card { margin-bottom: 12px; border-left: 4px solid var(--el-border-color); }
.row-card.tone-danger { border-left-color: var(--el-color-danger); }
.row-card.tone-warning { border-left-color: var(--el-color-warning); }
.row-card.tone-success { border-left-color: var(--el-color-success); }
.row-card.tone-info { border-left-color: var(--el-border-color); }
.row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.6; }
.scene { color: var(--el-text-color-secondary); font-size: 12px; }
.row-body { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 10px; font-size: 13px; }
.row-body .note { color: var(--el-text-color-secondary); }
.error-text { margin: 10px 0 0; color: var(--el-color-danger); font-size: 13px; line-height: 1.7; }
.content-box { margin-top: 12px; padding: 10px 12px; background: var(--el-fill-color-light); border-radius: 6px; }
.content-label { display: flex; gap: 14px; margin: 0 0 6px; color: var(--el-text-color-secondary); font-size: 12px; }
.content-text { margin: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }
.row-actions { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
.not-editable { color: var(--el-text-color-secondary); font-size: 13px; }
</style>
