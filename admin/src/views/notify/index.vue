<script setup lang="ts">
/**
 * 后台「微信通知」—— 订阅消息「模板配置 + 门店可达性诊断 + 测试发送」。
 *
 * 依据：`docs/前端对接说明-后台微信通知诊断-2026-09-29.md`
 * （§三 三个接口 / §3.2 字段口径 / §3.3 测试发送三点提示 / §四 硬约束 / §五 验收清单）。
 *
 * ## 这个页面解决什么
 * 「店长的微信收不到信息」要**同时**满足三个条件，缺一条就收不到：
 * | # | 条件 | 本页能不能看到 |
 * |---|---|---|
 * | ① | 模板已配置 | ✅ 「订阅消息模板」区（已配置 / 未配置） |
 * | ② | 门店通知接收人已绑微信（店长优先 → 回退门店主账号） | ✅ 「门店可达性诊断」 |
 * | ③ | **用户点过订阅授权** | ❌ **微信不提供任何授权状态查询** ⇒ 只能靠「测试发送」真发一条 |
 *
 * ## 硬性约定（改之前先读，别改坏）
 * 1. **全中文**：页面上不出现 `configured` / `templateId` / `variableName` / `canReceiveWechat` /
 *    `failReason` / `rawCode` 这类英文字段名；后端中文提示里若夹带字段名，统一走 {@link plainHint} 替换；
 * 2. **逻辑判断只用结构化字段**（`configured` / `canReceiveWechat` / `sent` / `rateLimited` / `rawCode`），
 *    **绝不匹配 `reasons[]` / `failReason` 的中文文案**（文案可能微调）；
 *    `reasons[]` / `suggestions[]` 一律**逐条展示**；
 * 3. 可达性诊断接口 **`shopId` 必传**（不传后端返回 1000）⇒ 页面必须先选门店；
 *    门店下拉数据源 = `GET /api/admin/shop/all?includeDisabled=true`（复用 `api/shop.ts` 的 `getEnabledShops`）；
 * 4. 「测试发送」区**必须**提示三点：一次性授权 / 测试会消耗一次额度 + 每门店每日 3 次限流 / 只发微信
 *    （不触发红点、短信、语音）；
 * 5. 本页**只读 + 一次测试发送**：不改任何后端配置。
 *
 * ## 权限
 * 仅**超级管理员 + 运营客服**（后端 `/api/admin/notify/**` 对商户管理员 **403**）。
 * 菜单与路由同源，见 `utils/permission.ts` 的 `/notify`。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getNotifyReachability, getNotifySubscribeConfig, sendNotifyTest } from '@/api/notify'
import { getEnabledShops } from '@/api/shop'
import { useAuthStore } from '@/stores/auth'
import { canAccess } from '@/utils/permission'
import { copyToClipboard } from '@/utils/clipboard'
import { sanitizeBonusText } from '@/utils/textSafe'
import type { NotifyReachability, NotifySubscribeConfig, NotifyTestSceneCode, NotifyTestSendResult } from '@/types/notify'
import type { AdminRole } from '@/types/auth'
import type { Shop } from '@/types/shop'

const router = useRouter()
const authStore = useAuthStore()

/* ============================ 常量 ============================ */

/** 测试发送「场景」白名单（对接说明 §3.3；顺序即下拉顺序）。 */
const NOTIFY_TEST_SCENE_CODES: NotifyTestSceneCode[] = ['NEW_ORDER', 'ACCEPT_TIMEOUT', 'EXCEPTION', 'CANCEL_REQUESTED']

/**
 * 场景中文名兜底（**正常情况用后端 `scenes[].label`**，这里只防备配置接口失败时下拉空着）。
 * 值取自后端需求稿 §5.1 的中文名，与后端文案一致。
 */
const NOTIFY_TEST_SCENE_FALLBACK_LABELS: Record<NotifyTestSceneCode, string> = {
  NEW_ORDER: '有新订单（待接单）',
  ACCEPT_TIMEOUT: '接单超时提醒',
  EXCEPTION: '配送异常（需商家介入）',
  CANCEL_REQUESTED: '用户提交取消申请',
}

/** 测试发送限流上限兜底值（后端现为每门店每日 3 次；拿到结果后以返回的 `dailyLimit` 为准）。 */
const DEFAULT_DAILY_LIMIT = 3

/** 微信「用户未授权 / 拒收」错误码 —— 用它给出结构化提示，**不匹配中文文案**。 */
const WECHAT_NOT_AUTHORIZED_CODE = 43101

/** 「全部门店体检」的并发度（接口要求必传门店，只能逐店调用；限并发避免打爆后端）。 */
const BATCH_CONCURRENCY = 3

/**
 * 后端中文提示里可能夹带的**英文字段名** ⇒ 上屏前统一换成中文（用户明确要求页面不出现英文字段名）。
 * 只做「词 → 中文」映射，不改动其它内容。
 */
const FIELD_TOKEN_LABELS: Array<[RegExp, string]> = [
  [/tmplIds/g, '订阅授权模板 ID 列表'],
  [/templateId/g, '模板 ID'],
  [/variableName/g, '「文本变量名」'],
  [/configured/g, '配置状态'],
  [/canReceiveWechat/g, '微信通知可用性'],
  [/failReason/g, '失败原因'],
  [/rawCode/g, '微信错误码'],
  [/rawMessage/g, '微信原始信息'],
]

/* ============================ ① 订阅消息模板 ============================ */

const loadingConfig = ref(false)
const configError = ref('')
const config = ref<NotifySubscribeConfig | null>(null)

/** 已配置模板的场景数（页面色标用 `configured`，**不拿模板 ID 是否为空反推**）。 */
const configuredCount = computed(() => (config.value?.scenes || []).filter((scene) => scene.configured).length)
/** 4 个场景是否全部已配置。 */
const configuredAll = computed(() => !!config.value?.scenes.length && configuredCount.value === config.value.scenes.length)

/** 拉取订阅消息模板配置（只读）。 */
async function loadConfig(): Promise<void> {
  loadingConfig.value = true
  configError.value = ''
  try {
    config.value = await getNotifySubscribeConfig()
  } catch (error) {
    config.value = null
    configError.value = error instanceof Error ? error.message : '微信通知配置查询失败'
  } finally {
    loadingConfig.value = false
  }
}

/** 模板 ID 过长时截断显示（完整值仍可复制）。 */
function ellipsis(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

/** 复制模板 ID（便于贴给后端/运营核对）。 */
async function copyTemplateId(value: string): Promise<void> {
  const ok = await copyToClipboard(value)
  if (ok) ElMessage.success('模板 ID 已复制')
  else ElMessage.warning('复制失败，请手动选中复制')
}

/* ============================ ② 门店可达性诊断 ============================ */

const shops = ref<Shop[]>([])
const shopsLoading = ref(false)
/** 当前选中的门店 ID（下拉选项用的是 `Shop.id` 字符串，调接口时再转数字）。 */
const selectedShopId = ref('')

const diagnosing = ref(false)
const batchRunning = ref(false)
const batchDone = ref(0)
/** 只看微信通知不可用的门店（运营日常只需要看有问题的那几家）。 */
const onlyUnavailable = ref(false)

/**
 * 诊断结果行 —— 单店诊断 / 批量体检 / 请求失败**统一成这一种形状**，模板只认它。
 * 白名单式重建，避免把接口字段直接铺到模板上（漏字段会静默显示空）。
 */
interface DiagnosisRow {
  shopId: number
  shopName: string
  merchantName: string
  receiverName: string | null
  receiverRole: string | null
  canReceiveWechat: boolean
  fallbackNote: string | null
  configuredSceneCount: number | null
  reasons: string[]
  suggestions: string[]
  /** 诊断请求本身失败时的中文提示（此时其余字段取门店下拉里的兜底值）。 */
  errorMessage: string
}

const rows = ref<DiagnosisRow[]>([])

/** 当前选中门店（两个下拉共用一个 `selectedShopId`，天然同步）。 */
const selectedShop = computed(() => shops.value.find((shop) => shop.id === selectedShopId.value) || null)

/** 门店下拉选项文案（停用门店要标出来 —— 诊断时同样要能选中）。 */
function shopOptionLabel(shop: Shop): string {
  return shop.status === 1 ? shop.name : `${shop.name}（已停用）`
}

/** 接口结果 → 表格行。 */
function toRow(result: NotifyReachability): DiagnosisRow {
  return {
    shopId: result.shopId,
    shopName: result.shopName,
    merchantName: result.merchantName || '',
    receiverName: result.receiverName,
    receiverRole: result.receiverRole,
    canReceiveWechat: result.canReceiveWechat,
    fallbackNote: result.fallbackNote,
    configuredSceneCount: result.configuredSceneCount,
    reasons: result.reasons,
    suggestions: result.suggestions,
    errorMessage: '',
  }
}

/** 请求失败 → 占位行（否则运营不知道这家没查到，会误以为"没问题"）。 */
function toFailedRow(shop: Shop, message: string): DiagnosisRow {
  return {
    shopId: Number(shop.id),
    shopName: shop.name,
    merchantName: shop.merchantName || '',
    receiverName: null,
    receiverRole: null,
    // 失败行按「不可用」处理：同样需要人工跟进
    canReceiveWechat: false,
    fallbackNote: null,
    configuredSceneCount: null,
    reasons: [],
    suggestions: [],
    errorMessage: message,
  }
}

/** 「不可用 / 诊断失败」排在前面（要处理的先看见），同组按门店名排序。 */
function sortRows(): void {
  rows.value.sort((a, b) => {
    const rank = (row: DiagnosisRow) => (row.canReceiveWechat ? 1 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.shopName.localeCompare(b.shopName)
  })
}

/** 按门店覆盖/追加一行诊断结果（同一门店重复诊断只保留最新一条）。 */
function upsertRow(row: DiagnosisRow): void {
  const index = rows.value.findIndex((item) => item.shopId === row.shopId)
  if (index >= 0) rows.value.splice(index, 1, row)
  else rows.value.push(row)
  sortRows()
}

/** 表格可见行（「只看微信通知不可用的门店」筛选用的是**结构化字段** `canReceiveWechat`）。 */
const visibleRows = computed(() => (onlyUnavailable.value ? rows.value.filter((row) => !row.canReceiveWechat) : rows.value))

/** 不可用（含诊断失败）门店数，用于工具栏统计。 */
const unavailableCount = computed(() => rows.value.filter((row) => !row.canReceiveWechat).length)

/** 微信通知状态色标（诊断失败单独一档）。 */
function wechatTagType(row: DiagnosisRow): 'success' | 'danger' | 'warning' {
  if (row.errorMessage) return 'warning'
  return row.canReceiveWechat ? 'success' : 'danger'
}

/** 微信通知状态文案。 */
function wechatTagText(row: DiagnosisRow): string {
  if (row.errorMessage) return '诊断失败'
  return row.canReceiveWechat ? '微信通知可用' : '微信通知不可用'
}

/** 接收人展示：「姓名（身份）」；两者都为空显示「—」（后端可能给 null）。 */
function receiverText(row: { receiverName: string | null; receiverRole: string | null }): string {
  const name = row.receiverName
  const role = row.receiverRole
  if (name && role) return `${name}（${role}）`
  return name || role || '—'
}

/** 拉取门店下拉（含**停用**门店：诊断要覆盖全部在册门店）。失败不阻断页面。 */
async function loadShops(): Promise<void> {
  shopsLoading.value = true
  try {
    shops.value = await getEnabledShops(true)
  } catch {
    shops.value = []
  } finally {
    shopsLoading.value = false
  }
}

/** 诊断当前选中的门店。 */
async function diagnoseOne(): Promise<void> {
  const shop = selectedShop.value
  if (!shop) {
    ElMessage.warning('请先选择门店')
    return
  }
  if (diagnosing.value) return
  diagnosing.value = true
  try {
    const row = toRow(await getNotifyReachability(shop.id))
    upsertRow(row)
    // 单店诊断是用户主动点的一次查询：结果若正好被「只看不可用」筛掉，先关掉筛选，避免"点了没反应"
    if (onlyUnavailable.value && row.canReceiveWechat) onlyUnavailable.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '门店微信通知可达性诊断失败')
  } finally {
    diagnosing.value = false
  }
}

/**
 * 全部门店体检。
 *
 * ⚠️ 诊断接口**要求必传门店**，后端没有「一次返回全部门店」的形态
 * ⇒ 这里的「列表」是**前端逐店调用后汇总**的，按 {@link BATCH_CONCURRENCY} 限并发。
 * 所以先弹确认框把请求量说清楚（门店多时会花一点时间）。
 */
async function runBatch(): Promise<void> {
  if (batchRunning.value) return
  const total = shops.value.length
  if (!total) {
    ElMessage.warning('没有可诊断的门店')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将对全部 ${total} 家门店逐店诊断（每家一次接口请求，最多同时 ${BATCH_CONCURRENCY} 家）。\n\n` +
        '诊断接口要求必传门店，所以这里由前端逐店查询后汇总；门店较多时会花一些时间，中途不要关闭页面。\n\n确认开始吗？',
      '全部门店体检',
      { type: 'info', confirmButtonText: '开始体检', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  batchRunning.value = true
  batchDone.value = 0
  rows.value = []
  let cursor = 0
  // 简易并发池：多个 worker 抢同一个游标（读+自增之间没有 await，JS 单线程下不会重复取到同一家）
  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const shop = shops.value[cursor]
      cursor += 1
      try {
        upsertRow(toRow(await getNotifyReachability(shop.id)))
      } catch (error) {
        upsertRow(toFailedRow(shop, error instanceof Error ? error.message : '诊断请求失败'))
      }
      batchDone.value += 1
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, total) }, () => worker()))
  } finally {
    batchRunning.value = false
  }
}

/**
 * 当前角色能否进「店员管理」（绑定微信的落点）。
 * ⚠️ 平台角色里**只有超管**有 `/staff`（客服没有）⇒ 客服看到的是说明文案而不是按钮，
 *    避免点了被路由守卫打回工作台（菜单/路由矩阵见 `utils/permission.ts`，本次**不改**其它模块的权限）。
 */
const canBindWechat = computed(() => canAccess((authStore.role || '') as AdminRole, '/staff'))

/** 跳「店员管理」并按该门店筛选（该页已支持 `?shopId=` 过滤）。 */
function goBindWechat(shopId: number): void {
  router.push({ path: '/staff', query: { shopId: String(shopId) } })
}

/* ============================ ③ 测试发送 ============================ */

const testScene = ref<NotifyTestSceneCode>('NEW_ORDER')
const sending = ref(false)
const testResult = ref<NotifyTestSendResult | null>(null)

/**
 * 场景下拉选项：**中文名优先取后端 `scenes[].label`**（后端本来就是中文，不自己造词），
 * 只在配置没拿到时回落内置中文。匹配用的是结构化字段 `scene`，不是中文文案。
 */
const sceneOptions = computed<Array<{ value: NotifyTestSceneCode; label: string }>>(() => {
  const labelByScene = new Map<string, string>()
  ;(config.value?.scenes || []).forEach((scene) => {
    if (scene.scene && scene.label) labelByScene.set(scene.scene, scene.label)
  })
  return NOTIFY_TEST_SCENE_CODES.map((code) => ({
    value: code,
    label: labelByScene.get(code) || NOTIFY_TEST_SCENE_FALLBACK_LABELS[code],
  }))
})

/** 限流上限：优先用最近一次返回的 `dailyLimit`（后端可调），没测过就用兜底值。 */
const testDailyLimit = computed(() => testResult.value?.dailyLimit || DEFAULT_DAILY_LIMIT)

/** 结果标题（分支只看结构化的 `sent` / `rateLimited`）。 */
const testResultTitle = computed(() => {
  const result = testResult.value
  if (!result) return ''
  if (result.sent) return '发送成功：消息已交给微信下发'
  if (result.rateLimited) return '已触发今日限流：本门店今日测试次数已用完'
  return '发送失败'
})

/** 结果横幅色调（同上，只看结构化字段）。 */
const testResultTone = computed<'success' | 'warning' | 'error'>(() => {
  const result = testResult.value
  if (!result) return 'error'
  if (result.sent) return 'success'
  return result.rateLimited ? 'warning' : 'error'
})

/**
 * 「未授权」结构化提示：**只看微信错误码** `43101`（用户未授权 / 拒收），
 * 不匹配 `failReason` 的中文文案（文案可能微调）。
 */
const notAuthorizedHint = computed(() => {
  const result = testResult.value
  if (!result || result.sent) return ''
  if (result.rawCode !== WECHAT_NOT_AUTHORIZED_CODE) return ''
  return `微信返回 ${WECHAT_NOT_AUTHORIZED_CODE}（用户未授权）：请让该接收人在小程序里打开一次工作台或订单页，点一次订阅后，再回来重测。`
})

/** 测试发送（真发一条微信）。 */
async function sendTest(): Promise<void> {
  const shop = selectedShop.value
  if (!shop) {
    ElMessage.warning('请先选择门店')
    return
  }
  if (sending.value) return
  const sceneLabel = sceneOptions.value.find((item) => item.value === testScene.value)?.label || testScene.value
  try {
    await ElMessageBox.confirm(
      `将向门店「${shop.name}」的微信通知接收人真发一条「${sceneLabel}」测试消息。\n\n` +
        '① 订阅消息是一次性授权：本次测试会消耗一次授权额度（成功、失败都算）；\n' +
        `② 后端每门店每日最多 ${testDailyLimit.value} 次；\n` +
        '③ 本操作只发微信，不会触发红点、短信、语音。\n\n确认发送吗？',
      '测试发送（会消耗一次订阅授权额度）',
      { type: 'warning', confirmButtonText: '确认发送', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  sending.value = true
  try {
    testResult.value = await sendNotifyTest(shop.id, testScene.value)
  } catch (error) {
    testResult.value = null
    ElMessage.error(error instanceof Error ? error.message : '微信测试消息发送失败')
  } finally {
    sending.value = false
  }
}

// 换门店 / 换场景后，上一次的发送结果已经不对应当前选择了 ⇒ 清掉，避免误读
watch(selectedShopId, () => {
  testResult.value = null
})
watch(testScene, () => {
  testResult.value = null
})

/* ============================ 工具 ============================ */

/**
 * 后端中文提示的展示前处理：
 * 1. 过 `sanitizeBonusText()`（项目统一口径：后端若仍下发历史旧业务词，展示层归一化）；
 * 2. 把提示里可能夹带的**英文字段名**换成中文（用户明确要求页面不出现英文字段名）；
 * 3. 收掉替换后中文之间多余的空格（英文/数字两侧的空格保留，例如「微信 thing 类目 ≤20 字」）。
 */
function plainHint(value: string | null | undefined): string {
  let text = sanitizeBonusText(value)
  for (const [pattern, label] of FIELD_TOKEN_LABELS) text = text.replace(pattern, label)
  return text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
}

/** 页面刷新：配置 + 门店下拉一起重拉（诊断结果保留，避免白屏）。 */
async function refreshAll(): Promise<void> {
  await Promise.all([loadConfig(), loadShops()])
}

onMounted(() => {
  void loadConfig()
  void loadShops()
})
</script>

<template>
  <section class="page-container">
    <div class="page-heading">
      <div>
        <h1>微信通知</h1>
        <p>排查「店长的微信收不到消息」：先看模板配置 → 再看每家门店谁收、能不能收 → 最后真发一条验证。</p>
      </div>
      <el-button :loading="loadingConfig" @click="refreshAll">刷新</el-button>
    </div>

    <!-- 页面级口径：把「三个条件」和「微信查不到授权状态」一次说清，避免把"可用"误判成"一定能收到" -->
    <el-alert type="info" :closable="false" show-icon class="block">
      <template #title>先记住三条口径（它们决定了这个页面能看到什么）</template>
      <ul class="hint-list">
        <li>模板已配置 —— 见下方「① 订阅消息模板」，显示<strong>已配置 / 未配置</strong>。</li>
        <li>门店通知接收人已绑微信（店长优先 → 回退门店主账号）—— 见「② 门店可达性诊断」。</li>
        <li>
          <strong>用户点过订阅授权 —— 微信不提供任何授权状态查询，这里永远看不到</strong>；
          要确认它，只能靠「③ 测试发送」真发一条。
        </li>
      </ul>
    </el-alert>

    <!-- ① 订阅消息模板（只读） -->
    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <strong>① 订阅消息模板（只读）</strong>
          <el-tag v-if="config" size="small" :type="configuredAll ? 'success' : 'warning'" effect="light">
            {{ configuredCount }} / {{ config.scenes.length }} 个场景已配置
          </el-tag>
        </div>
      </template>

      <el-alert v-if="configError" type="error" :closable="false" show-icon>
        <template #title>配置查询失败，本区结果不可用</template>
        <p class="hint">{{ configError }}</p>
      </el-alert>

      <template v-else>
        <el-table v-loading="loadingConfig" :data="config?.scenes || []" size="small" border>
          <el-table-column label="通知场景" min-width="200">
            <template #default="{ row }">{{ row.label || '—' }}</template>
          </el-table-column>
          <el-table-column label="配置状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.configured ? 'success' : 'danger'" effect="light">
                {{ row.configured ? '已配置' : '未配置' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="模板 ID" min-width="280">
            <template #default="{ row }">
              <template v-if="row.templateId">
                <code class="mono">{{ ellipsis(row.templateId) }}</code>
                <el-button link type="primary" @click="copyTemplateId(row.templateId)">复制</el-button>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="文本变量名" width="140">
            <template #default="{ row }">
              <code v-if="row.variableName" class="mono">{{ row.variableName }}</code>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>

        <p v-if="config?.variableHint" class="hint">{{ plainHint(config.variableHint) }}</p>
        <p v-if="config?.tmplIds.length" class="hint">
          订阅授权用的模板 ID 列表（后端已去重、最多 3 个）：
          <code class="mono">{{ config.tmplIds.join('、') }}</code>
        </p>
        <p v-if="config?.note" class="hint">{{ plainHint(config.note) }}</p>
      </template>
    </el-card>

    <!-- ② 门店可达性诊断 -->
    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <strong>② 门店可达性诊断</strong>
          <span class="muted">诊断必须指定门店，所以先选门店</span>
        </div>
      </template>

      <div class="toolbar">
        <el-select
          v-model="selectedShopId"
          filterable
          clearable
          placeholder="请选择门店"
          style="width: 260px"
          :loading="shopsLoading"
        >
          <el-option v-for="shop in shops" :key="shop.id" :label="shopOptionLabel(shop)" :value="shop.id" />
        </el-select>
        <el-button type="primary" :loading="diagnosing" :disabled="!selectedShopId" @click="diagnoseOne">诊断该门店</el-button>
        <el-button :loading="batchRunning" :disabled="!shops.length" @click="runBatch">
          {{ batchRunning ? `体检中… ${batchDone}/${shops.length}` : '全部门店体检' }}
        </el-button>
        <el-checkbox v-model="onlyUnavailable" :disabled="!rows.length">只看微信通知不可用的门店</el-checkbox>
        <span v-if="rows.length" class="muted">
          已诊断 {{ rows.length }} 家，其中 <strong>{{ unavailableCount }}</strong> 家不可用（或诊断失败）
        </span>
      </div>

      <el-table
        v-loading="diagnosing || batchRunning"
        :data="visibleRows"
        size="small"
        border
        empty-text="还没有诊断结果：选一家门店点「诊断该门店」，或点「全部门店体检」一次看完"
      >
        <el-table-column label="门店" min-width="180">
          <template #default="{ row }">
            <div>{{ row.shopName || '—' }}</div>
            <div class="muted">门店 ID：{{ row.shopId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属商户" min-width="140">
          <template #default="{ row }">{{ row.merchantName || '—' }}</template>
        </el-table-column>
        <el-table-column label="通知接收人" min-width="200">
          <template #default="{ row }">
            <div>{{ receiverText(row) }}</div>
            <!-- 口径补充：例如「店长未绑但主账号已绑 ⇒ 实际会回退」，避免把"会回退"误判成"收不到" -->
            <div v-if="row.fallbackNote" class="fallback-note">口径补充：{{ plainHint(row.fallbackNote) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="微信通知" width="160">
          <template #default="{ row }">
            <el-tag size="small" :type="wechatTagType(row)" effect="light">{{ wechatTagText(row) }}</el-tag>
            <div v-if="row.configuredSceneCount !== null" class="muted">模板已配置场景 {{ row.configuredSceneCount }} 个</div>
          </template>
        </el-table-column>
        <el-table-column label="原因与建议" min-width="320">
          <template #default="{ row }">
            <div v-if="row.errorMessage" class="error-text">诊断失败：{{ row.errorMessage }}</div>
            <ul v-if="row.reasons.length" class="reason-list">
              <li v-for="(reason, index) in row.reasons" :key="`r-${index}`">{{ plainHint(reason) }}</li>
            </ul>
            <ul v-if="row.suggestions.length" class="suggest-list">
              <li v-for="(tip, index) in row.suggestions" :key="`s-${index}`">建议：{{ plainHint(tip) }}</li>
            </ul>
            <span v-if="!row.errorMessage && !row.reasons.length && !row.suggestions.length" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canBindWechat" link type="primary" @click="goBindWechat(row.shopId)">去绑定微信</el-button>
            <span v-else class="muted">请平台管理员在「店员管理」中绑定微信</span>
          </template>
        </el-table-column>
      </el-table>

      <el-alert type="info" :closable="false" show-icon class="block top-gap">
        <template #title>「微信通知可用」只代表：模板已配置 + 接收人存在 + 已绑微信</template>
        <p class="hint">
          它<strong>不代表一定能收到</strong> —— 订阅消息是<strong>一次性授权</strong>，而用户是否点过订阅
          <strong>微信不提供查询</strong>。要确认最后一步，只能用下面的「测试发送」真发一条。
        </p>
      </el-alert>
    </el-card>

    <!-- ③ 测试发送 -->
    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <strong>③ 测试发送（真发一条微信）</strong>
          <span class="muted">这是唯一能确认「用户是否订阅授权」的手段</span>
        </div>
      </template>

      <el-alert type="warning" :closable="false" show-icon class="block">
        <template #title>发送前必须知道的三点</template>
        <ul class="hint-list">
          <li>订阅消息是<strong>一次性授权</strong>：<strong>测试会消耗一次授权额度</strong>（成功、失败都算）。</li>
          <li>后端<strong>每门店每日限流 {{ testDailyLimit }} 次</strong>（返回的「今日已用 / 上限」会在下方结果里展示）。</li>
          <li>本操作<strong>只发微信</strong>：<strong>不会</strong>触发红点、短信、语音，不会变成对店长的骚扰。</li>
        </ul>
      </el-alert>

      <div class="toolbar">
        <el-select
          v-model="selectedShopId"
          filterable
          clearable
          placeholder="请选择门店"
          style="width: 260px"
          :loading="shopsLoading"
        >
          <el-option v-for="shop in shops" :key="shop.id" :label="shopOptionLabel(shop)" :value="shop.id" />
        </el-select>
        <el-select v-model="testScene" style="width: 220px">
          <el-option v-for="item in sceneOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" :loading="sending" :disabled="!selectedShopId" @click="sendTest">发送测试消息</el-button>
        <span class="muted">当前门店：{{ selectedShop ? selectedShop.name : '未选择（请在上方选择门店）' }}</span>
      </div>

      <el-alert v-if="testResult" :type="testResultTone" :closable="false" show-icon class="block" :title="testResultTitle">
        <div class="result-body">
          <p v-if="testResult.failReason" class="hint">{{ plainHint(testResult.failReason) }}</p>
          <p class="hint">实际发送给：{{ receiverText(testResult) }}</p>
          <p class="hint">
            本门店今日已用
            <strong>{{ testResult.usedToday }} / {{ testResult.dailyLimit }}</strong>
            次（订阅消息一次性授权，本次测试已消耗一次）。
          </p>
          <p v-if="testResult.suggestion" class="hint">建议：{{ plainHint(testResult.suggestion) }}</p>
          <p v-if="testResult.note" class="hint">{{ plainHint(testResult.note) }}</p>
          <p v-if="notAuthorizedHint" class="hint strong">{{ notAuthorizedHint }}</p>

          <!-- 技术详情：rawCode / rawMessage 默认收起（对接说明：默认不必展示给非技术用户） -->
          <el-collapse v-if="testResult.rawCode !== null || testResult.rawMessage" class="tech-block">
            <el-collapse-item title="技术详情（排查用，普通运营不用看）" name="tech">
              <p class="hint">微信错误码：<code class="mono">{{ testResult.rawCode ?? '—' }}</code></p>
              <p class="hint">微信原始信息：<code class="mono">{{ testResult.rawMessage || '—' }}</code></p>
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-alert>
    </el-card>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; }
.top-gap { margin-top: 16px; margin-bottom: 0; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.hint { margin: 8px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.hint.strong { color: var(--el-color-warning); font-weight: 600; }
.hint-list { margin: 6px 0 0; padding-left: 20px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.8; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.mono { padding: 1px 4px; font-size: 12px; background: var(--el-fill-color-light); border-radius: 4px; word-break: break-all; }
.fallback-note { margin-top: 4px; color: var(--el-color-warning); font-size: 12px; line-height: 1.6; }
.error-text { color: var(--el-color-danger); font-size: 12px; line-height: 1.6; }
.reason-list { margin: 0; padding-left: 18px; color: var(--el-color-danger); font-size: 12px; line-height: 1.7; }
.suggest-list { margin: 4px 0 0; padding-left: 18px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
.result-body { margin-top: 4px; }
.tech-block { margin-top: 10px; }
</style>
