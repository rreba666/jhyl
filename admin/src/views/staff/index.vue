<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useAuthStore } from '@/stores/auth'
import { useShopStore } from '@/stores/shop'
import { useStaffStore } from '@/stores/staff'
import type {
  StaffAccount,
  StaffAccountSaveDTO,
  StaffIdentityOption,
  StaffIssueResult,
  StaffPasswordLog,
  StaffPasswordView,
} from '@/types/staff'
import { getUsers } from '@/api/user'
import type { User } from '@/types/user'
import {
  STAFF_WECHAT_LABELS,
  WECHAT_ID_NEEDS_REGISTRATION_HINT,
  resolveStaffWechatBinding,
  staffWechatRoutingHint,
} from '@/utils/staffWechat'
import { Edit, Key, MoreFilled, RefreshLeft } from '@element-plus/icons-vue'

const store = useStaffStore()
const shopStore = useShopStore()
const authStore = useAuthStore()
const route = useRoute()
const selected = ref<StaffAccount[]>([])
const deletableSelected = computed(() => selected.value.filter((item) => item.delFlag !== 1))
const restorableSelected = computed(() => selected.value.filter((item) => item.delFlag === 1))

/**
 * 身份选项（**多选**：identities 是可叠加的数组）。
 * 后端 `PUT /api/admin/staff/{id}/identities` 的 DTO 就是 `identities: string[]`：
 * - `['MANAGER','RIDER']` = 店长兼骑手；`['RIDER','VERIFIER']` = 骑手兼核销；`[]` = 仅档案；
 * - ⚠️ **V1.18 起「店长」不再自动带骑手能力**：取消店长会同时取消骑手能力回普通店员，
 *   要继续干骑手必须**显式勾上「骑手」**（接口描述：需继续干骑手请显式传 [RIDER]）。
 */
const IDENTITY_OPTIONS: Array<{ value: StaffIdentityOption; label: string; hint: string }> = [
  { value: 'MANAGER', label: '店长', hint: '店长：小程序「门店管理」（仅本店、一店唯一，页内含骑手功能入口）；同时具备 H5 核销账号密码；必须绑定微信。' },
  { value: 'RIDER', label: '骑手', hint: '骑手：小程序「骑手工作台」（仅本店任务）；无密码，仅需绑定微信。' },
  { value: 'VERIFIER', label: '核销店员', hint: '核销店员：独立工号密码，仅用于 H5 核销页，不进小程序、禁止绑定微信。' },
  { value: 'NONE', label: '仅档案', hint: '仅档案：无任何业务身份与登录入口（C 端等同普通用户）。' },
]
/** 表单里可勾选的身份（仅档案 = 一个都不勾）。 */
const SELECTABLE_IDENTITIES = IDENTITY_OPTIONS.filter((item) => item.value !== 'NONE')

/** 勾选身份 → 提示文案（多条用换行拼接）。 */
const identityHints = computed<string>(() => {
  const list = SELECTABLE_IDENTITIES.filter((item) => form.identities.includes(item.value))
  if (!list.length) return IDENTITY_OPTIONS.find((item) => item.value === 'NONE')?.hint || ''
  return list.map((item) => item.hint).join('\n')
})
/** 列表筛选用：identities 出参 → 单个身份选项（仅用于查询参数）。 */
function fromIdentities(identities: string[] | undefined): StaffIdentityOption {
  const list = identities || []
  if (list.includes('VERIFIER')) return 'VERIFIER'
  if (list.includes('MANAGER')) return 'MANAGER'
  if (list.includes('RIDER')) return 'RIDER'
  return 'NONE'
}
/**
 * 列表回显：出参 identities → 表单多选数组（过滤掉未知值）。
 *
 * ⚠️ 2026-09-29 修（用户反馈"改身份提示保存成功但没有变化"）：
 * 这里**曾经**按 `deliveryEnabled` 自动补勾「骑手」，理由是"当时后端出参只给主身份码"。
 * 但后端**自 2026-09-16 起 `identities` 已是完整叠加集合**（契约原文：
 * 「前端「修改身份」回显应**直接用本字段**」），而那段补勾会**在打开弹窗时就把「骑手」勾上**
 * ⇒ 用户若不手动取消、直接保存，提交的与原本**完全相同** ⇒ 后端无变化
 * ⇒ 表现为"保存成功但列表没变"。
 * ⇒ 现在**只用 `identities` 本身回显**，不再做任何自动补勾。
 */
function toFormIdentities(row: StaffAccount): string[] {
  const allowed = SELECTABLE_IDENTITIES.map((item) => item.value)
  return (row.identities || []).filter((item): item is StaffIdentityOption => allowed.includes(item as StaffIdentityOption))
}

// ===== 新增 / 编辑身份 =====
const formVisible = ref(false)
const editingRow = ref<StaffAccount | null>(null)
const formRef = ref<FormInstance>()
/**
 * 表单模型。
 *
 * ⚠️ 2026-10-10：微信标识**从 2 个字段拆成 3 个**（`wechatUserId` / `wechatId` / `wechatOpenid`），
 * 因为它们对应契约里**三个各自独立的 key**（`userId` / `wechatId` / `openid`，见 `@/utils/staffWechat`）。
 * 旧实现是「微信用户ID」+「微信号 或 openid」两个框，而后者**永远被塞进 `openid`** ⇒
 * 运营按标签填微信号就必然失败（「微信标识不匹配」的真实成因）。
 */
const form = reactive<{
  identities: string[]
  name: string
  phone: string
  shopId: string
  username: string
  password: string
  /** 契约 `userId`：微信用户 ID（`wx_user.id`），**运营唯一能查到的标识**（按手机号搜用户）。 */
  wechatUserId: string
  /** 契约 `wechatId`：微信号（**人工登记值**，需先在「用户管理」登记）。 */
  wechatId: string
  /** 契约 `openid`：微信 openid（运营通常拿不到，保留作为兜底）。 */
  wechatOpenid: string
}>({
  identities: ['MANAGER'],
  name: '',
  phone: '',
  shopId: '',
  username: '',
  password: '',
  wechatUserId: '',
  wechatId: '',
  wechatOpenid: '',
})
/** 是否编辑模式（编辑 = D4 改身份；新增 = D1 建号）。 */
const isEditing = computed(() => Boolean(editingRow.value))
/** 需要工号密码的身份：含店长或核销店员。 */
const needAccount = computed(() => form.identities.includes('MANAGER') || form.identities.includes('VERIFIER'))
/** 需要绑定微信的身份：含店长或骑手。 */
const needWechat = computed(() => form.identities.includes('MANAGER') || form.identities.includes('RIDER'))

// ===== 微信标识三选一（契约：优先 userId > 微信号 > openid）=====
/**
 * 新增表单的微信标识解析结果。
 * ⚠️ 提交时**只发这一个 key**（契约原文「微信标识三选一」），多填时按契约优先级取一个，
 * 并把被忽略的那些**显式告诉运营**（不静默丢弃）。
 */
const wechatResolution = computed(() => resolveStaffWechatBinding({
  userId: form.wechatUserId,
  wechatId: form.wechatId,
  openid: form.wechatOpenid,
}))
/** 「将以 X 绑定」提示（多填时附上忽略项）。 */
const wechatRoutingHint = computed(() => staffWechatRoutingHint(wechatResolution.value))

// ===== 微信用户ID 怎么拿到：按手机号 / 昵称在「用户管理」同一数据源里搜 =====
/**
 * ⚠️ 这是本次修复的**关键**：运营**不可能知道 openid**，但**可以**按手机号查到用户的 `wx_user.id`
 * （契约 `GET /api/admin/user/list` 的 `keyword` 原文：「搜索关键词（纯数字按用户ID精确匹配，
 * 否则按昵称/手机号模糊匹配）」）⇒ 把 `userId` 变成运营拿得到的东西，
 * 「微信号 或 openid」那种"要求运营知道微信内部标识"的输入框就不需要了。
 */
const userSearching = ref(false)
const userOptions = ref<User[]>([])
/** 防竞态：只有最后一次搜索的结果才允许写回（远程搜索是连打的）。 */
let userSearchToken = 0

/** 远程搜索 C 端用户（新增弹窗与绑定弹窗共用这一份结果，同一时刻只有一个弹窗可见）。 */
async function searchBindUsers(keyword: string): Promise<void> {
  const query = keyword.trim()
  const token = ++userSearchToken
  if (!query) {
    userSearching.value = false
    userOptions.value = []
    return
  }
  userSearching.value = true
  try {
    const result = await getUsers(1, 20, query)
    if (token !== userSearchToken) return
    userOptions.value = result.list
  } catch (error) {
    if (token !== userSearchToken) return
    userOptions.value = []
    ElMessage.error(error instanceof Error ? error.message : '用户搜索失败')
  } finally {
    if (token === userSearchToken) userSearching.value = false
  }
}

/** 下拉项文案：昵称 / 手机号 / 用户ID，并**如实标注该用户的微信号有没有登记**（决定微信号能不能用来绑定）。 */
function userOptionLabel(user: User): string {
  const nickname = user.nickname || '（无昵称）'
  const phone = user.phone || '无手机号'
  const wx = user.wxId ? `微信号 ${user.wxId}` : '微信号未登记'
  return `${nickname} / ${phone} / 用户ID ${user.id} / ${wx}`
}

const rules = computed<FormRules>(() => {
  const base: FormRules = {
    name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  }
  if (!isEditing.value) base.shopId = [{ required: true, message: '请选择所属门店', trigger: 'change' }]
  if (needAccount.value) {
    base.username = [{ required: true, message: '请输入工号', trigger: 'blur' }]
    base.password = editingRow.value && editingRow.value.accountIssued ? [] : [{ required: true, message: '请输入密码', trigger: 'blur' }]
  }
  return base
})

/** 打开新增（D1）。 */
async function openCreate(): Promise<void> {
  editingRow.value = null
  Object.assign(form, { identities: ['MANAGER'], name: '', phone: '', shopId: '', username: '', password: '', wechatUserId: '', wechatId: '', wechatOpenid: '' })
  await shopStore.fetchEnabled()
  formVisible.value = true
}

/** 打开编辑身份（D4）。 */
async function openEditIdentity(row: StaffAccount): Promise<void> {
  editingRow.value = row
  Object.assign(form, {
    identities: toFormIdentities(row),
    name: row.name || '',
    phone: row.phone || '',
    shopId: row.shopId ? String(row.shopId) : '',
    username: row.username || '',
    password: '',
    wechatUserId: row.boundUserId ? String(row.boundUserId) : '',
    wechatId: '',
    wechatOpenid: '',
  })
  await shopStore.fetchEnabled()
  formVisible.value = true
}

/** 校验并提交：新增走建号，编辑走改身份（可一步式发号）；微信字段编辑时单独走绑定接口。 */
async function submitForm(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  // 微信标识校验：含店长 / 骑手时**三选一**必须填一个（契约：微信标识三选一）
  // ⚠️ 文案必须与**实际提交行为**一致：旧文案写「三选一」，代码却只把值塞进 `openid` 一个 key。
  if (needWechat.value && !isEditing.value) {
    if (wechatResolution.value.key === null) {
      ElMessage.error(`含店长 / 骑手身份时必须填写${STAFF_WECHAT_LABELS.userId}、${STAFF_WECHAT_LABELS.wechatId} 或 ${STAFF_WECHAT_LABELS.openid}（三选一）`)
      return
    }
    // userId 是 integer(int64)：填了非正整数就**阻断**，绝不自动降级到次优先级的 key（那是替运营猜）
    if (wechatResolution.value.invalid) {
      ElMessage.error(`${STAFF_WECHAT_LABELS.userId} 必须是正整数（wx_user.id，可用上面的搜索框按手机号查）`)
      return
    }
  }
  // 身份会互相影响，提交前再确认一次（尤其"取消店长会同时取消骑手能力"）
  if (isEditing.value && editingRow.value) {
    const before = (editingRow.value.identities || []).slice().sort().join(',')
    const after = form.identities.slice().sort().join(',')
    if (before !== after) {
      const labels = form.identities.length
        ? SELECTABLE_IDENTITIES.filter((item) => form.identities.includes(item.value)).map((item) => item.label).join(' + ')
        : '仅档案（无任何入口）'
      try {
        await ElMessageBox.confirm(`将「${editingRow.value.name}」的身份改为：${labels}？`, '身份变更确认', { type: 'warning' })
      } catch {
        return
      }
    }
  }
  try {
    if (isEditing.value && editingRow.value) {
      await store.changeIdentities(editingRow.value.id, {
        identities: [...form.identities],
        ...(needAccount.value && form.username ? { username: form.username } : {}),
        ...(needAccount.value && form.password ? { password: form.password } : {}),
      })
      ElMessage.success('身份已更新')
    } else {
      const payload: StaffAccountSaveDTO = {
        identities: [...form.identities],
        name: form.name.trim(),
        shopId: form.shopId,
        phone: form.phone || undefined,
        ...(needAccount.value ? { username: form.username.trim(), password: form.password } : {}),
        // 微信标识三选一：**只发解析出来的那一个 key**（契约：优先 userId > 微信号 > openid）。
        // ⚠️ 旧实现把「微信号 或 openid」框的值一律发成 `openid` ⇒ 微信号被当成 openid 提交 ⇒
        //    后端报「微信标识不匹配: 填的值既不是用户#90010 的 openid，也不是其微信号(登记的微信号: 未登记)」。
        ...(needWechat.value ? wechatResolution.value.payload : {}),
      }
      await store.create(payload)
      ElMessage.success('人员已创建')
    }
    formVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

// ===== 发号（D1b，2026-10-10 B1：密码改为可选 + 展示发号结果）=====
/**
 * 发号结果弹窗（**不是** `ElMessageBox.prompt` 拼 "工号,密码" 字符串了）。
 *
 * ## 为什么要改
 * 旧实现强制运营输入「工号,密码」两段（`split(',')` + 正则要求密码 ≥6 位）⇒ 后端新上线的默认密码规则
 * （`手机号后 4 位 + 身份证后 4 位`）**永远用不到**。契约 `IssueBody` 的 `required` **只有 `username`**，
 * `password` 的描述原文：「不传则由后端按「手机号后4位+身份证后4位」生成，且要求首登强制改密；
 * 传则 6~32 位」⇒ 前端改为**密码可留空（留空 = 不传该字段）**。
 *
 * ## 结果怎么展示
 * 响应 `data = IssueResult{ password, passwordSource, mustChangePassword }`（契约里**三个字段都没有
 * description**，`passwordSource` **连 enum 都没有**）⇒
 * - `password`：**复用本页已有的明文门禁机制**（默认遮罩 → 点击揭示 → 30 秒自动隐藏 → 关闭即清），
 *   **不直接渲染**；
 * - `passwordSource`：**原样显示后端返回的字符串**，遇到不认识的值也不会翻译成中文标签
 *   —— 契约没定义取值域，翻译就是猜（本项目硬原则：不伪造、不猜测）；
 * - `mustChangePassword`：`true`/`false` 原义呈现，缺失就写「未下发」。
 */
const issueVisible = ref(false)
const issueSubmitting = ref(false)
/** 正在发号的人员（用于回显姓名 / 门店）。 */
const issueRow = ref<StaffAccount | null>(null)
/** 工号（必填，同旧实现）。 */
const issueUsername = ref('')
/** 自选密码（**可留空** = 不传该字段 = 走后端默认规则）。 */
const issuePassword = ref('')
/** 发号结果；`null` = 还没成功 / 后端没返回结果（**不编空壳对象**）。 */
const issueResult = ref<StaffIssueResult | null>(null)
/** 是否已经提交成功（决定弹窗显示"表单"还是"结果"）。 */
const issueFinished = ref(false)
/** 发号失败提示（失败保留表单内容，可改完重提）。 */
const issueError = ref('')

/**
 * 发号结果的揭示门禁。
 *
 * ⚠️ **为什么不直接复用 `canRevealPlaintext`（仅超管）**：两者读的东西性质不同 ——
 * - D2 `GET /{id}/login-password` 读的是**别人的历史明文留档**（契约：「仅中控/客服可用，调用即写审计」）
 *   ⇒ 前端在矩阵之外**再收窄一道**到超管；
 * - 这里的密码是**本次发号调用自己刚拿到的返回值**（对接文档 §一：「必须展示给客服并转告商家」）
 *   ⇒ 没有"多读一份秘密"的动作，门禁 = **能进本页并使用发号的角色**（`utils/permission.ts` 里
 *   本页就是超管 + 商户管理员）。若也收窄成"仅超管"，商户管理员发号后将拿不到要转告商家的密码，
 *   B1 的目的（让默认密码规则用得上）就落空了。
 * 角色判据同样取自 auth store（**不在这页写死角色字符串**），机制与 D2 完全同形：
 * 默认遮罩 → 显式点击揭示 → 30 秒自动隐藏 → 关闭 / 卸载即清。
 */
const canRevealIssuedPassword = computed(() => authStore.isPlatformAdmin || authStore.isMerchantAdmin)
/** 发号结果密码的遮罩 / 倒计时状态。 */
const issueRevealed = ref(false)
const issueCountdown = ref(0)
let issueTimer: ReturnType<typeof setInterval> | null = null
/** 结果里**确实拿到了**密码（缺失 / null / 空串都算"没拿到" —— 不拿空串冒充密码）。 */
const issuePasswordText = computed<string>(() =>
  typeof issueResult.value?.password === 'string' ? issueResult.value.password : '',
)
const hasIssuePassword = computed(() => issuePasswordText.value.length > 0)
/** 非授权角色的提示（本页只有超管 / 商户管理员，故文案按本页口径写）。 */
const ISSUE_NO_PERMISSION_HINT = '无权查看（本页仅超管 / 商户管理员可发号）'

/** 隐藏发号结果的明文（超时 / 关闭弹窗 / 卸载都会走这里）。 */
function hideIssuePassword(): void {
  issueRevealed.value = false
  issueCountdown.value = 0
  if (issueTimer !== null) {
    clearInterval(issueTimer)
    issueTimer = null
  }
}
/** 揭示发号结果的明文（仅授权角色 + 确实拿到了密码）；30 秒后自动隐藏。 */
function revealIssuePassword(): void {
  if (!canRevealIssuedPassword.value || !hasIssuePassword.value) return
  hideIssuePassword()
  issueRevealed.value = true
  issueCountdown.value = REVEAL_TIMEOUT_SECONDS
  issueTimer = setInterval(() => {
    issueCountdown.value -= 1
    if (issueCountdown.value <= 0) hideIssuePassword()
  }, 1000)
}

/** 打开发号弹窗（表单态：工号必填、密码可空）。 */
function openIssue(row: StaffAccount): void {
  issueRow.value = row
  issueUsername.value = row.username || ''
  issuePassword.value = ''
  issueResult.value = null
  issueFinished.value = false
  issueError.value = ''
  hideIssuePassword()
  issueVisible.value = true
}

/** 提交发号（成功后**就地切换到结果态**，不再弹一个"已发号"的空提示）。 */
async function submitIssue(): Promise<void> {
  const row = issueRow.value
  if (!row) return
  const username = issueUsername.value.trim()
  if (username === '') {
    issueError.value = '请填写工号'
    return
  }
  const password = issuePassword.value
  if (password !== '' && (password.length < 6 || password.length > 32)) {
    issueError.value = '自选密码须 6~32 位（契约 minLength 6 / maxLength 32）；留空则由后端按默认规则生成'
    return
  }
  issueSubmitting.value = true
  issueError.value = ''
  try {
    // ⚠️ 密码留空 = **不传该字段**（契约语义：后端按「手机号后4位+身份证后4位」生成 + 要求首登改密）。
    //    绝不送空串：空串既不是"不传"，也会直接撞上 minLength 6。
    const result = await store.issue(row.id, password === '' ? { username } : { username, password })
    issueResult.value = result
    issueFinished.value = true
    // 明文只留在"结果态"这一份，表单里立刻清掉（不在两处各留一份）
    issuePassword.value = ''
    if (result === null) {
      ElMessage.warning('已发号（后端返回成功），但本次响应未返回发号结果（password 等字段）')
    }
  } catch (error) {
    issueError.value = error instanceof Error ? error.message : '发号失败'
  } finally {
    issueSubmitting.value = false
  }
}

/**
 * 密码来源 `passwordSource`：**原样返回后端给的字符串**。
 * ⚠️ 契约里该字段**无 description、无 enum**（取值域未定义）⇒ 这里**绝不做中文映射**：
 * 不认识就把它本身显示出来（对接文档 §一 提到的 `DEFAULT` / `SELF` 只是文档口径，不是契约 enum）。
 */
function passwordSourceText(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '未下发'
}

/** 首登强制改密：`true`/`false` 原义呈现；缺失 / 非布尔 ⇒ 「未下发」（不猜）。 */
function mustChangePasswordLabel(value: boolean | null | undefined): string {
  if (value === true) return '是（首次登录会强制改密）'
  if (value === false) return '否'
  return '未下发（后端没给该字段，不猜测）'
}

/** 关闭发号弹窗 ⇒ 立刻撤掉结果里的明文与结果对象。 */
watch(issueVisible, (visible) => {
  if (visible) return
  hideIssuePassword()
  issueResult.value = null
  issueFinished.value = false
  issueError.value = ''
  issuePassword.value = ''
})

// ===== 明文门禁（D2 登录密码 / D3b 改密留痕，2026-10-10 加固）=====
/**
 * 明文揭示的**统一门禁**：默认遮罩 → 显式点击揭示 → 超时自动隐藏。
 *
 * 背景（改动原因）：`StaffPasswordViewVO.passwordPlain`（登录密码明文）与
 * `StaffPasswordLogVO.passwordBefore/passwordAfter`（改前/改后明文留档）此前**直接渲染在页面上**
 * ⇒ 只要页面开着（或一次肩窥 / 一张截图），店员密码就暴露了。
 * 现在这两处明文一律**先遮罩**，必须**点击**才显示，并在 **30 秒后自动隐藏**、
 * 弹窗关闭 / 路由离开时立刻清除。
 *
 * 角色：**只有平台管理员（SUPER_ADMIN）**能揭示 —— 复用 auth store 既有的 `isPlatformAdmin`
 * （与 `views/invoices/index.vue` 同一套判法，不另造角色判断）。
 * ⚠️ 这是**纵深防御、不是唯一一层**（后端契约 `GET /api/admin/staff/{id}/login-password` 的描述原文：
 * 「明文留档查看，**仅中控/客服可用**，调用即写审计」）：
 * - **客服（CUSTOMER_SERVICE）**在后端口径内，但本页路由矩阵（`utils/permission.ts`）里没有
 *   `/staff`，客服进不到本页；
 * - **商户管理员（ADMIN）能进本页**（矩阵里有 `/staff`）⇒ 前端这道门对他是**真正起作用**的那一道，
 *   但仍以**后端拦截为准** —— 不要把前端隐藏当作明文的保护手段。
 */
const canRevealPlaintext = computed(() => authStore.isPlatformAdmin)
/** 明文揭示的停留时长（秒）：到点自动隐藏，避免"人走了页面还开着"。 */
const REVEAL_TIMEOUT_SECONDS = 30
/** 默认遮罩占位（**绝不用明文本身兜底**）。 */
const MASKED_PLAINTEXT = '••••••••'
/** 无权限文案。 */
const NO_PERMISSION_HINT = '无权查看（仅平台管理员）'
/** 无明文留档文案（契约：历史账号可能无留档 ⇒ passwordPlain 为 null）。 */
const NO_PLAIN_RECORD_HINT = '无留档'
/** 留痕表的短文案（列宽有限）。 */
const NO_PERMISSION_SHORT = '无权查看'

/**
 * 倒计时 + 定时器（登录密码弹窗与留痕弹窗各一份）。
 * `ReturnType<typeof setInterval>` 与 `AdminLayout.vue` 的写法保持一致。
 */
const passwordRevealed = ref(false)
const passwordCountdown = ref(0)
let passwordTimer: ReturnType<typeof setInterval> | null = null
const historyRevealed = ref(false)
const historyCountdown = ref(0)
let historyTimer: ReturnType<typeof setInterval> | null = null

// ===== 查看登录密码（D2，敏感）=====
const passwordVisible = ref(false)
const passwordLoading = ref(false)
const passwordView = ref<StaffPasswordView | null>(null)
/**
 * 本次响应里**确实拿到了**明文。
 * ⚠️ **不能只看 `noPlainRecord`**：若后端按 R5 建议撤掉/改名留档字段
 * （`docs/26/10.10/后端需求-入驻默认密码与首登改密-2026-10-10.md` §六），
 * `noPlainRecord` 也会是 undefined ⇒ 会被误当成"有留档"而渲染出空白。
 * 这里以**明文本体是否存在**为准 ⇒ 字段消失/为 null 时走「无留档」，不空着、也不报错。
 */
const plainPassword = computed<string>(() => (typeof passwordView.value?.passwordPlain === 'string' ? passwordView.value.passwordPlain : ''))
const hasPlainPassword = computed(() => plainPassword.value.length > 0)
/** 隐藏明文（超时 / 关闭弹窗 / 离开路由都会走这里）。 */
function hidePasswordPlaintext(): void {
  passwordRevealed.value = false
  passwordCountdown.value = 0
  if (passwordTimer !== null) {
    clearInterval(passwordTimer)
    passwordTimer = null
  }
}
/** 揭示明文（仅超管 + 确实有留档时可用）；30 秒后自动隐藏。 */
function revealPasswordPlaintext(): void {
  if (!canRevealPlaintext.value || !hasPlainPassword.value) return
  hidePasswordPlaintext()
  passwordRevealed.value = true
  passwordCountdown.value = REVEAL_TIMEOUT_SECONDS
  passwordTimer = setInterval(() => {
    passwordCountdown.value -= 1
    if (passwordCountdown.value <= 0) hidePasswordPlaintext()
  }, 1000)
}
async function viewPassword(row: StaffAccount): Promise<void> {
  // 纵深防御：非超管连请求都不发（后端契约里该接口仅中控/客服可用，本页面前端再收窄一道）
  if (!canRevealPlaintext.value) {
    ElMessage.warning(NO_PERMISSION_HINT)
    return
  }
  try {
    await ElMessageBox.confirm('查看登录密码会记录操作日志，确认继续？', '敏感操作确认', { type: 'warning', confirmButtonText: '确认查看', cancelButtonText: '取消' })
  } catch { return }
  hidePasswordPlaintext()
  passwordVisible.value = true
  passwordLoading.value = true
  try {
    const result = await store.viewPassword(row.id)
    // 弹窗已关（或路由已离开）就**不再把明文落进响应式状态**
    if (passwordVisible.value) passwordView.value = result
  } catch (error) {
    passwordVisible.value = false
    ElMessage.error(error instanceof Error ? error.message : '登录密码查看失败')
  } finally {
    passwordLoading.value = false
  }
}

// ===== 改密留痕（D3b） =====
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref<StaffPasswordLog[]>([])

// ===== 绑定微信（D4b）弹窗状态 =====
/**
 * ⚠️ 这三个声明必须**早于**下面的 `watch(bindVisible, ...)` 与 `onBeforeUnmount(...)`
 * （它们要在关窗 / 卸载时清空表单）—— 否则是 TDZ 错误（vue-tsc: TS2448 "used before its declaration"）。
 * 弹窗的**行为函数**（`openBind` / `confirmBind`）仍在下面「绑定 / 解绑微信」小节里。
 *
 * ⚠️ 这里**没有**把 `bindVisible` 加进 `watch(() => route.fullPath, ...)`：全站是裸 `<RouterView />`
 * （无 keep-alive）⇒ 换路由必然卸载组件 ⇒ `onBeforeUnmount` 已经关掉它；
 * 而那条 watch 的**逐字形态**被 `tests/staff-password-reveal.contract.ps1` 钉住（明文门禁的清理断言），
 * 不去动它（**不改别人的断言**，也不做重复的第二个 route watcher）。
 */
const bindVisible = ref(false)
const bindRow = ref<StaffAccount | null>(null)
const bindForm = reactive<{ userId: string; wechatId: string; openid: string }>({ userId: '', wechatId: '', openid: '' })
/** 与提交同源的解析结果（契约：优先 userId > 微信号 > openid）。 */
const bindResolution = computed(() => resolveStaffWechatBinding(bindForm))
/** 「将以 X 绑定」提示（多填时附忽略项）。 */
const bindRoutingHint = computed(() => staffWechatRoutingHint(bindResolution.value))

/** 隐藏留痕里的改前/改后明文。 */
function hideHistoryPlaintext(): void {
  historyRevealed.value = false
  historyCountdown.value = 0
  if (historyTimer !== null) {
    clearInterval(historyTimer)
    historyTimer = null
  }
}
/** 揭示留痕里的改前/改后明文（仅超管）；30 秒后自动隐藏。 */
function revealHistoryPlaintext(): void {
  if (!canRevealPlaintext.value) return
  hideHistoryPlaintext()
  historyRevealed.value = true
  historyCountdown.value = REVEAL_TIMEOUT_SECONDS
  historyTimer = setInterval(() => {
    historyCountdown.value -= 1
    if (historyCountdown.value <= 0) hideHistoryPlaintext()
  }, 1000)
}
/**
 * 改密留痕的「改前 / 改后」列统一走这里：
 * 非超管 → 「无权查看」（不渲染明文）；未揭示 → 遮罩；留档字段缺失 / 为 null → 「无留档」。
 */
function plainLogText(value: string | null | undefined): string {
  if (!canRevealPlaintext.value) return NO_PERMISSION_SHORT
  if (!historyRevealed.value) return MASKED_PLAINTEXT
  return typeof value === 'string' && value.length > 0 ? value : NO_PLAIN_RECORD_HINT
}
async function viewHistory(row: StaffAccount): Promise<void> {
  hideHistoryPlaintext()
  historyVisible.value = true
  historyLoading.value = true
  try {
    historyList.value = await store.passwordHistory(row.id)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '改密留痕查询失败')
  } finally {
    historyLoading.value = false
  }
}

/**
 * 弹窗关闭 / 路由离开 ⇒ **立刻**撤掉明文（不留在响应式状态里等下一次覆盖）。
 */
watch(passwordVisible, (visible) => {
  if (visible) return
  hidePasswordPlaintext()
  passwordView.value = null
})
watch(historyVisible, (visible) => {
  if (visible) return
  hideHistoryPlaintext()
  historyList.value = []
})
// 绑定弹窗关闭 ⇒ 清掉尚未提交的微信标识（避免下次打开残留上一次的输入）
watch(bindVisible, (visible) => {
  if (visible) return
  Object.assign(bindForm, { userId: '', wechatId: '', openid: '' })
})
watch(() => route.fullPath, () => {
  passwordVisible.value = false
  historyVisible.value = false
})
onBeforeUnmount(() => {
  passwordVisible.value = false
  historyVisible.value = false
  bindVisible.value = false
  // 发号结果里也有明文 ⇒ 卸载时同样立刻清掉（watch 会顺手清空结果对象）
  issueVisible.value = false
  hidePasswordPlaintext()
  hideHistoryPlaintext()
  hideIssuePassword()
})

// ===== 绑定 / 解绑微信（D4b / D4c）=====
/**
 * 「绑定微信」弹窗（**替代原来的单行 prompt**）。
 *
 * ⚠️ 旧实现是 `ElMessageBox.prompt` + 按"值形状"路由：
 * `/^\d+$/.test(value) ? { userId: value } : { openid: value }` ——
 * 三选一里**根本没有 `wechatId` 这一支** ⇒ 任何非纯数字的值（= 微信号，如 `Yimu9783`）
 * 都会被当成 `openid` 提交 ⇒ 必然「微信标识不匹配」。
 * 而契约写的优先级是 **userId > 微信号 > openid**（`POST /api/admin/staff/{id}/bind` 描述原文）。
 * ⇒ 改为三个**各自独立标注**的输入，各走自己的 key，由 `resolveStaffWechatBinding` 统一解析。
 * （弹窗状态 `bindVisible` / `bindRow` / `bindForm` 声明在「改密留痕」小节之前，供路由与卸载的清理使用。）
 */
/** 打开「绑定微信」（D4b；契约里本接口的定位是「补绑 / 换绑」）。 */
function openBind(row: StaffAccount): void {
  bindRow.value = row
  // 不回填当前绑定值：本入口是"补绑 / 换绑"，回填旧值容易被误读成"确认绑定原值"
  Object.assign(bindForm, { userId: '', wechatId: '', openid: '' })
  bindVisible.value = true
}

/** 提交绑定：只发解析出的那一个 key。 */
async function confirmBind(): Promise<void> {
  const row = bindRow.value
  if (!row) return
  if (bindResolution.value.key === null) {
    ElMessage.error(bindRoutingHint.value)
    return
  }
  if (bindResolution.value.invalid) {
    ElMessage.error(`${STAFF_WECHAT_LABELS.userId} 必须是正整数（wx_user.id，可用搜索框按手机号查）`)
    return
  }
  try {
    await store.bindWechat(row.id, bindResolution.value.payload)
    ElMessage.success('微信绑定成功')
    bindVisible.value = false
  } catch (error) {
    // ⚠️ 失败时**保留弹窗**：运营可就地换 key 重试；后端错误原文（如「微信标识不匹配」）直接展示
    ElMessage.error(error instanceof Error ? error.message : '微信绑定失败')
  }
}
async function unbindWechat(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认解绑「${row.name}」的微信？解绑后该人 C 端身份入口消失。`, '解绑确认', { type: 'warning' })
    await store.unbindWechat(row.id)
    ElMessage.success('已解绑微信')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '微信解绑失败')
  }
}

// ===== 重置密码（D3）/ 启停（D6） =====
async function resetPassword(row: StaffAccount): Promise<void> {
  try {
    const result = await ElMessageBox.prompt('请输入新的登录密码', '重置密码', { inputPattern: /^.{6,}$/, inputErrorMessage: '密码至少 6 位' })
    await store.resetPassword(row.id, result.value)
    ElMessage.success('密码已重置（后端留痕并踢下线）')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '密码重置失败')
  }
}

/** D6① 启停：中控为 query 参数；禁用后该人立即掉线、C 端身份消失。 */
async function changeStatus(row: StaffAccount, value: boolean | string | number): Promise<void> {
  const next: 0 | 1 = value ? 1 : 0
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '禁用'}「${row.name}」吗？${next ? '' : '禁用后该人立即掉线，C 端身份入口消失。'}`, '状态确认', { type: 'warning' })
    await store.setStatus(row, next)
    ElMessage.success(next ? '已启用' : '已禁用')
  } catch (error) {
    row.status = next ? 0 : 1
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '状态更新失败')
  }
}

// ===== P7：删除（进回收站）/ 恢复 =====
/** 是否已删除（回收站行）。 */
function isDeleted(row: StaffAccount): boolean {
  return row.delFlag === 1
}
/** 已删除行置灰。 */
function rowClassName({ row }: { row: StaffAccount }): string {
  return isDeleted(row) ? 'row-deleted' : ''
}

/** 软删除人员（可在「回收站」恢复）。 */
async function removeRow(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」吗？删除后该人立即掉线、C 端身份消失；可在「回收站」恢复。`, '删除确认', { type: 'warning' })
    await store.remove(row.id)
    selected.value = []
    ElMessage.success('已删除（可在回收站恢复）')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

/** 恢复已删除人员。 */
async function restoreRow(row: StaffAccount): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复「${row.name}」吗？恢复后其 C 端身份一并回来。`, '恢复确认', { type: 'warning' })
    await store.restore(row.id)
    selected.value = []
    ElMessage.success('已恢复')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

/** 批量删除（仅在用行）。 */
async function removeSelected(): Promise<void> {
  if (!deletableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${deletableSelected.value.length} 个人员吗？可在「回收站」恢复。`, '批量删除确认', { type: 'warning' })
    const result = await store.removeBatch(deletableSelected.value.map((item) => item.id))
    selected.value = []
    ElMessage.success(`删除成功 ${result.successIds.length} 个${result.failedIds.length ? `，失败 ${result.failedIds.length} 个` : ''}`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 批量恢复（仅已删除行）。 */
async function restoreSelected(): Promise<void> {
  if (!restorableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${restorableSelected.value.length} 个人员吗？`, '批量恢复确认', { type: 'warning' })
    const result = await store.restoreBatch(restorableSelected.value.map((item) => item.id))
    selected.value = []
    ElMessage.success(`恢复成功 ${result.successIds.length} 个${result.failedIds.length ? `，失败 ${result.failedIds.length} 个` : ''}`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量恢复失败')
  }
}

/** 切换「回收站」视图（只看已删除）。 */
function toggleRecycle(): void {
  store.page = 1
  selected.value = []
  void loadList()
}

/** 身份标签颜色（按 identityLabel 粗分）。 */
function identityTagType(row: StaffAccount): 'primary' | 'success' | 'warning' | 'info' {
  if (row.identities?.includes('VERIFIER')) return 'warning'
  if (row.identities?.includes('MANAGER')) return 'primary'
  if (row.identities?.includes('RIDER')) return 'success'
  return 'info'
}

/**
 * 该人员是否**需要**「工号 + 密码」。
 *
 * 纯骑手走微信登录（只绑 `userId` / `openid`），**不需要工号** —— 所以列表里不给它标「未发号」、
 * 也不给「发号」按钮（否则看起来像"没配置好"）；工号密码只服务于
 * **PC 控制台**（店主 `MERCHANT_OWNER`）与 **H5 核销页**（店长 `MANAGER` / 核销店员 `VERIFIER`）。
 * 表单侧的同类判断是 `needAccount`（看当前勾选的身份），本函数看的是**行上已有的身份集合**。
 */
function rowNeedsAccount(row: StaffAccount): boolean {
  const ids = row.identities || []
  return ids.some((id) => id === 'MERCHANT_OWNER' || id === 'MANAGER' || id === 'VERIFIER')
}

async function loadList(): Promise<void> {
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '人员台账查询失败') }
}
function search(): void { store.page = 1; void loadList() }
function resetFilters(): void { store.keyword = ''; store.shopId = ''; store.role = ''; store.status = ''; search() }

onMounted(() => {
  // 从「门店管理 → 查看人员」跳转带入 shopId：直接按该门店过滤
  const queryShopId = route.query.shopId
  if (queryShopId) store.shopId = String(queryShopId)
  void loadList()
  shopStore.fetchEnabled().catch(() => undefined)
})

// ⚠️ 同一路由内 query 变化时组件会被复用、`onMounted` 不再执行，所以必须监听 query：
// 例如带着 `?shopId=A` 进来后，再点左侧菜单「店员管理」（query 被清空）必须回到"全部门店"，
// 否则列表会一直停在上一个门店，且门店下拉还显示 A（2026-09-17 修）。
watch(() => route.query.shopId, (value) => {
  store.shopId = value ? String(value) : ''
  store.page = 1
  void loadList()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div><h1>店员管理（人员台账）</h1><p>身份由「档案 + 叠加身份」构成，<strong>可多选</strong>（店长 + 骑手、骑手 + 核销店员…）；店长含 H5 核销账号密码、骑手无密码、核销店员不绑微信；店长 / 骑手必须绑定微信。</p></div>
      <el-button type="primary" @click="openCreate">新增人员</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="门店">
          <el-select v-model="store.shopId" clearable placeholder="全部门店" style="width: 180px">
            <el-option v-for="shop in shopStore.enabledList" :key="shop.id" :label="shop.name" :value="shop.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="身份">
          <el-select v-model="store.role" clearable placeholder="全部身份" style="width: 150px">
            <el-option v-for="item in IDENTITY_OPTIONS" :key="item.value" :label="item.label" :value="item.value === 'NONE' ? 'STAFF' : item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词"><el-input v-model="store.keyword" clearable placeholder="姓名 / 工号" style="width: 180px" @keyup.enter="search" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="store.status" clearable placeholder="全部" style="width: 110px">
            <el-option label="正常" :value="1" /><el-option label="禁用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="回收站">
          <el-switch v-model="store.onlyDeleted" @change="toggleRecycle" />
          <span class="muted" style="margin-left: 8px">只看已删除（可恢复）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <div class="toolbar">
        <div><strong>人员列表</strong><span class="toolbar-count">共 {{ store.total }} 条</span></div>
        <div class="toolbar-actions">
          <span v-if="selected.length" class="selection-tip">已选择 {{ selected.length }} 项</span>
          <el-button v-if="!store.onlyDeleted" size="small" type="danger" plain :disabled="!deletableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="removeSelected">批量删除</el-button>
          <el-button v-else size="small" type="success" plain :disabled="!restorableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="restoreSelected">批量恢复</el-button>
          <el-button :loading="store.loading" @click="loadList">刷新</el-button>
        </div>
      </div>
      <DataTable
        :data="store.list"
        :loading="store.loading"
        :total="store.total"
        :page="store.page"
        :page-size="store.pageSize"
        empty-text="暂无人员数据"
        :row-class-name="rowClassName"
        @selection-change="selected = $event"
        @page-change="store.page = $event; selected = []; void loadList()"
        @size-change="store.pageSize = $event; store.page = 1; selected = []; void loadList()"
      >
        <el-table-column label="身份" width="130">
          <template #default="{ row }">
            <el-tag :type="identityTagType(row)" size="small">{{ row.identityLabel }}</el-tag>
            <el-tag v-if="row.canLoginH5" size="small" type="info" effect="plain" class="tag-gap">可登H5</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="工号" min-width="130">
          <template #default="{ row }">
            <span v-if="row.username">{{ row.username }}</span>
            <!-- ⚠️ 纯骑手**不需要工号**（走微信登录：绑 userId/openid），列表里不该标「未发号」——会误导成"没配置好"。
                 只有需要密码登录的身份（店主/店长/核销店员）未发号时才提示。 -->
            <el-tag v-else-if="rowNeedsAccount(row)" size="small" type="warning" effect="plain">未发号</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column prop="shopName" label="所属门店" min-width="140" />
        <el-table-column label="微信绑定" min-width="190">
          <template #default="{ row }">
            <template v-if="row.boundUserId || row.boundNickname || row.boundOpenidMasked">
              <div>{{ row.boundNickname || row.boundUserId || row.boundOpenidMasked }}</div>
              <!-- 微信号是**人工登记**值（`wx_user.wx_id`，契约 `StaffAccountVO.boundWechatId`
                   「未登记为 null」）——没登记时，用微信号做绑定 key 必然失败，
                   所以列表必须把这一格显示出来，而不是等运营踩一次错。 -->
              <div class="muted wechat-cell-tip">微信号：{{ row.boundWechatId || '未登记' }}</div>
            </template>
            <span v-else class="muted">未绑定</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="isDeleted(row)" type="info">已删除</el-tag>
            <el-switch v-else :model-value="row.status === 1" :loading="store.actionLoading" @change="changeStatus(row, $event)" />
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="operator-actions">
              <template v-if="isDeleted(row)">
                <el-button size="small" type="success" :loading="store.actionLoading" @click="restoreRow(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button>
              </template>
              <template v-else>
                <el-button size="small" type="primary" @click="openEditIdentity(row)"><el-icon><Edit /></el-icon>改身份</el-button>
                <el-button v-if="rowNeedsAccount(row) && !row.accountIssued" size="small" type="warning" plain @click="openIssue(row)">发号</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => { if (cmd === 'password') viewPassword(row); else if (cmd === 'history') viewHistory(row); else if (cmd === 'bind') openBind(row); else if (cmd === 'unbind') unbindWechat(row); else if (cmd === 'reset') resetPassword(row); else if (cmd === 'delete') removeRow(row) }">
                  <el-button size="small">更多<el-icon><MoreFilled /></el-icon></el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <!-- 查看登录密码：**仅平台管理员**可点（后端契约「仅中控/客服可用」，客服进不到本页）。
                           非超管渲染成禁用项而不是直接消失 —— 让运营知道"有这项能力、但不是我能用的"。 -->
                      <el-dropdown-item v-if="row.accountIssued && canRevealPlaintext" command="password"><el-icon><Key /></el-icon>查看登录密码</el-dropdown-item>
                      <el-dropdown-item v-else-if="row.accountIssued" disabled><el-icon><Key /></el-icon>查看登录密码（仅平台管理员）</el-dropdown-item>
                      <el-dropdown-item command="history">改密留痕</el-dropdown-item>
                      <!-- ⚠️ 只有"纯核销账号"才不能绑微信：身份是「骑手 + 核销店员」这类叠加时仍需绑微信（否则该骑手接不了单）
                           —— 原来用 `includes('VERIFIER')` 会把叠加身份一起禁掉（2026-09-17 修） -->
                      <el-dropdown-item v-if="row.identities?.length === 1 && row.identities[0] === 'VERIFIER'" disabled>核销账号不绑微信</el-dropdown-item>
                      <el-dropdown-item v-else-if="row.boundUserId || row.boundOpenidMasked" command="unbind">解绑微信</el-dropdown-item>
                      <el-dropdown-item v-else command="bind">绑定微信</el-dropdown-item>
                      <el-dropdown-item v-if="row.accountIssued" command="reset" divided>重置密码</el-dropdown-item>
                      <el-dropdown-item command="delete" divided><span class="danger-text">删除（进回收站）</span></el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </div>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 新增 / 改身份 -->
    <el-dialog v-model="formVisible" :title="isEditing ? '修改身份' : '新增人员'" width="620px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="身份" prop="identities">
          <el-checkbox-group v-model="form.identities">
            <el-checkbox-button v-for="item in SELECTABLE_IDENTITIES" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox-button>
          </el-checkbox-group>
          <span class="muted identity-tip">可多选（如「店长 + 骑手」「骑手 + 核销店员」）；都不勾 = 仅档案</span>
        </el-form-item>
        <el-form-item label-width="0">
          <el-alert type="info" :closable="false" show-icon>
            <div class="identity-hint-box">{{ identityHints }}</div>
          </el-alert>
        </el-form-item>
        <el-form-item label="姓名" prop="name"><el-input v-model="form.name" /></el-form-item>
        <el-form-item v-if="!isEditing" label="所属门店" prop="shopId">
          <el-select v-model="form.shopId" placeholder="请选择门店" style="width: 100%">
            <el-option v-for="shop in shopStore.enabledList" :key="shop.id" :label="shop.name" :value="shop.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="11" /></el-form-item>
        <template v-if="needAccount">
          <el-form-item label="工号" prop="username"><el-input v-model="form.username" placeholder="H5 核销页登录工号（全局唯一）" /></el-form-item>
          <el-form-item :label="isEditing && editingRow?.accountIssued ? '密码（留空不改）' : '密码'" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        </template>
        <template v-if="needWechat && !isEditing">
          <!-- 微信标识**三选一**（契约原文：「微信标识三选一，优先 userId > 微信号 > openid」）。
               ⚠️ 拆成三个独立输入，是因为它们对应契约里三个**各自独立**的 key：
                  `userId`（微信用户ID）/ `wechatId`（微信号 · 人工登记值）/ `openid`。
               旧实现只有一个「微信号 或 openid」输入框，且值**永远以 `openid` 提交** ⇒
               运营按标签填微信号必然被拒（2026-10-10「微信标识不匹配」的真实成因）。
               ⇒ 现在每个 key 一个输入、各走各的 key；多填时按契约优先级取一个并**如实显示忽略项**，
                  既不静默丢弃、也不按"值的形状"猜 key。 -->
          <el-form-item :label="STAFF_WECHAT_LABELS.userId">
            <el-select
              v-model="form.wechatUserId"
              class="wechat-input"
              filterable
              allow-create
              default-first-option
              remote
              reserve-keyword
              clearable
              :remote-method="searchBindUsers"
              :loading="userSearching"
              placeholder="按手机号 / 昵称搜用户，或直接填 wx_user.id"
            >
              <el-option v-for="user in userOptions" :key="user.id" :label="userOptionLabel(user)" :value="user.id" />
            </el-select>
            <span class="muted wechat-tip">推荐填这一项：按手机号搜到人即可拿到，运营不需要知道 openid。</span>
          </el-form-item>
          <el-form-item :label="STAFF_WECHAT_LABELS.wechatId">
            <el-input v-model="form.wechatId" placeholder="用户本人的微信号（如 wxid_xxx / 自定义微信号）" />
            <span class="muted wechat-tip">{{ WECHAT_ID_NEEDS_REGISTRATION_HINT }}</span>
          </el-form-item>
          <el-form-item :label="STAFF_WECHAT_LABELS.openid">
            <el-input v-model="form.wechatOpenid" placeholder="微信 openid（形如 oX-abc123）" />
            <span class="muted wechat-tip">兜底项：openid 是微信内部标识，运营通常拿不到，仅在能拿到时使用。</span>
          </el-form-item>
          <el-form-item label-width="0">
            <span class="muted wechat-tip">{{ wechatRoutingHint }}</span>
          </el-form-item>
        </template>
        <el-form-item v-if="isEditing && needWechat" label-width="0">
          <el-alert title="微信绑定请用操作列「绑定微信 / 解绑微信」，此处不修改。" type="warning" :closable="false" show-icon />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving || store.actionLoading" @click="submitForm">保存</el-button></template>
    </el-dialog>

    <!-- 绑定微信（D4b）：三个 key **各自独立**输入，各走各的 key
         （契约原文：「微信标识三选一，优先 userId > 微信号 > openid」）。
         ⚠️ 取代了旧的单行 prompt：旧实现按"值是不是纯数字"路由成 userId / openid，
         **没有 wechatId 这一支** ⇒ 填微信号必被当成 openid 提交。 -->
    <el-dialog v-model="bindVisible" title="绑定微信" width="580px" append-to-body>
      <el-alert type="info" :closable="false" show-icon>
        <p class="muted">绑定对象：<strong>{{ bindRow?.name || '—' }}</strong>（{{ bindRow?.shopName || '—' }}）</p>
        <p class="muted">三个标识填一个即可；多填时按后端优先级取「微信用户ID &gt; 微信号 &gt; openid」，页面会写明实际用了哪个。</p>
      </el-alert>
      <el-form label-width="110px" class="bind-form">
        <el-form-item :label="STAFF_WECHAT_LABELS.userId">
          <el-select
            v-model="bindForm.userId"
            class="wechat-input"
            filterable
            allow-create
            default-first-option
            remote
            reserve-keyword
            clearable
            :remote-method="searchBindUsers"
            :loading="userSearching"
            placeholder="按手机号 / 昵称搜用户，或直接填 wx_user.id"
          >
            <el-option v-for="user in userOptions" :key="user.id" :label="userOptionLabel(user)" :value="user.id" />
          </el-select>
          <span class="muted wechat-tip">推荐填这一项：按手机号搜到人即可拿到。</span>
        </el-form-item>
        <el-form-item :label="STAFF_WECHAT_LABELS.wechatId">
          <el-input v-model="bindForm.wechatId" placeholder="用户本人的微信号（如 wxid_xxx / 自定义微信号）" />
          <span class="muted wechat-tip">{{ WECHAT_ID_NEEDS_REGISTRATION_HINT }}</span>
        </el-form-item>
        <el-form-item :label="STAFF_WECHAT_LABELS.openid">
          <el-input v-model="bindForm.openid" placeholder="微信 openid（形如 oX-abc123）" />
        </el-form-item>
        <el-form-item label-width="0">
          <span class="muted wechat-tip">{{ bindRoutingHint }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="store.actionLoading" @click="confirmBind">确定绑定</el-button>
      </template>
    </el-dialog>

    <!-- 发号（D1b，2026-10-10 B1）：密码**可留空**（后端按「手机号后4位+身份证后4位」生成并要求首登改密）；
         成功后**就地切换成结果态**展示 IssueResult（明文走门禁，passwordSource 原样显示） -->
    <el-dialog v-model="issueVisible" title="发号（给未发号的账号发工号与密码）" width="580px" append-to-body>
      <template v-if="!issueFinished">
        <el-descriptions :column="1" border size="small" class="issue-meta">
          <el-descriptions-item label="人员">{{ issueRow?.name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="所属门店">{{ issueRow?.shopName || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-form label-width="110px">
          <el-form-item label="工号" required>
            <el-input v-model="issueUsername" placeholder="H5 核销页 / PC 控制台登录工号（全局唯一）" />
          </el-form-item>
          <el-form-item label="密码（可不填）">
            <el-input
              v-model="issuePassword"
              type="password"
              show-password
              placeholder="留空 = 不传该字段，由后端按默认规则生成"
            />
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" show-icon>
          <p class="muted">
            <strong>密码留空</strong>即"不传该字段"：后端按「<strong>手机号后 4 位 + 身份证后 4 位</strong>」生成，
            并要求<strong>首次登录强制改密</strong>；该员工<strong>缺手机号或缺身份证</strong>时后端会报错并提示
            "请手工指定密码"（不会生成半个密码）。自选密码须 <strong>6~32 位</strong>。
          </p>
          <p class="muted">已发号的账号不会被自动覆盖。发号后还需「绑定微信」，该人员的 C 端入口才会变成可点。</p>
        </el-alert>
        <el-alert v-if="issueError" type="error" :closable="false" show-icon class="issue-error">
          <template #title>发号失败，本次未生效</template>
          <p class="muted">{{ issueError }}</p>
        </el-alert>
      </template>

      <template v-else>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="人员">
            {{ issueRow?.name || '—' }}（工号 {{ issueUsername || '—' }}）
          </el-descriptions-item>
          <el-descriptions-item label="本次实际生效的密码">
            <!-- ① 后端没返回结果（data 为 null，例如旧版后端）：如实说"没拿到"，**不编空密码** -->
            <span v-if="issueResult === null" class="danger-text">
              后端未返回发号结果（本次响应 data 为 null）—— 没有密码可转告，请与后端确认版本后重试
            </span>
            <!-- ② 非授权角色：不渲染明文，也不给揭示控件 -->
            <span v-else-if="!canRevealIssuedPassword" class="muted">{{ ISSUE_NO_PERMISSION_HINT }}</span>
            <!-- ③ 字段缺失 / 为 null：不给默认值、不空着 -->
            <span v-else-if="!hasIssuePassword" class="muted">
              后端未下发密码（字段缺失或为 null）—— 不给默认值，请与后端核对
            </span>
            <!-- ④ 默认遮罩 → 点击揭示 → 30 秒后自动隐藏（与「查看登录密码」同一套机制） -->
            <template v-else>
              <span class="plain-pwd" :class="{ 'plain-masked': !issueRevealed }">
                {{ issueRevealed ? issuePasswordText : MASKED_PLAINTEXT }}
              </span>
              <el-button
                size="small"
                :type="issueRevealed ? 'info' : 'warning'"
                plain
                @click="issueRevealed ? hideIssuePassword() : revealIssuePassword()"
              >
                {{ issueRevealed ? '隐藏' : '点击查看' }}
              </el-button>
              <span v-if="issueRevealed" class="muted reveal-countdown">{{ issueCountdown }} 秒后自动隐藏</span>
            </template>
          </el-descriptions-item>
          <el-descriptions-item label="密码来源（passwordSource）">
            <!-- ⚠️ 契约**没有**该字段的 description / enum（取值域未定义）⇒ **原样显示后端返回值**，
                 绝不翻译成中文标签（不认识的值也照原样显示） -->
            <span class="plain-pwd">{{ passwordSourceText(issueResult?.passwordSource) }}</span>
            <span class="muted issue-note">（契约未定义取值域，此处原样显示后端返回值，不做中文翻译）</span>
          </el-descriptions-item>
          <el-descriptions-item label="首次登录须改密">
            {{ mustChangePasswordLabel(issueResult?.mustChangePassword) }}
          </el-descriptions-item>
        </el-descriptions>
        <p class="muted">
          本次响应返回的是<strong>本次实际生效</strong>的密码：请<strong>立即转告商家</strong>，勿截屏或外传。
          后端契约<strong>未声明</strong>该密码此后是否还能再次查看（要核对可用「查看登录密码」/「重置密码」，
          但那两处各有自己的权限与留痕口径）——如需留档请按贵司流程处理。
        </p>
      </template>

      <template #footer>
        <template v-if="!issueFinished">
          <el-button @click="issueVisible = false">取消</el-button>
          <el-button type="primary" :loading="issueSubmitting" @click="submitIssue">发号</el-button>
        </template>
        <el-button v-else type="primary" @click="issueVisible = false">完成</el-button>
      </template>
    </el-dialog>

    <!-- 查看登录密码（D2，敏感）：**默认遮罩**，必须点击才揭示，30 秒后自动隐藏 -->
    <el-dialog v-model="passwordVisible" title="查看登录密码（已记录操作日志）" width="480px" append-to-body>
      <el-skeleton v-if="passwordLoading" :rows="4" animated />
      <template v-else-if="passwordView">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="姓名">{{ passwordView.name }}</el-descriptions-item>
          <el-descriptions-item label="工号">{{ passwordView.username || '—' }}</el-descriptions-item>
          <el-descriptions-item label="登录入口">{{ passwordView.entry }}</el-descriptions-item>
          <el-descriptions-item label="登录密码">
            <!-- ① 非超管：不渲染明文，也不给揭示控件（后端契约里该接口仅中控/客服可用） -->
            <span v-if="!canRevealPlaintext" class="muted">{{ NO_PERMISSION_HINT }}</span>
            <!-- ② 后端明说无留档（历史账号 BCrypt 不可逆） -->
            <span v-else-if="passwordView.noPlainRecord" class="danger-text">{{ passwordView.hint || '该账号为历史数据（无明文留档），请使用「重置密码」' }}</span>
            <!-- ③ 字段缺失 / 为 null（后端若撤掉明文留档字段，走这里，不空着也不报错） -->
            <span v-else-if="!hasPlainPassword" class="muted">{{ NO_PLAIN_RECORD_HINT }}（该账号无明文留档，请使用「重置密码」）</span>
            <!-- ④ 默认遮罩 → 点击揭示 → 30 秒后自动隐藏 -->
            <template v-else>
              <span class="plain-pwd" :class="{ 'plain-masked': !passwordRevealed }">{{ passwordRevealed ? plainPassword : MASKED_PLAINTEXT }}</span>
              <el-button size="small" :type="passwordRevealed ? 'info' : 'warning'" plain @click="passwordRevealed ? hidePasswordPlaintext() : revealPasswordPlaintext()">
                {{ passwordRevealed ? '隐藏' : '点击查看' }}
              </el-button>
              <span v-if="passwordRevealed" class="muted reveal-countdown">{{ passwordCountdown }} 秒后自动隐藏</span>
            </template>
          </el-descriptions-item>
        </el-descriptions>
        <!-- 审计提示：后端契约两条都写明「调用即写审计」，且审计枚举里有
             ADMIN_VIEW_LOGIN_PASSWORD=查看B端账号登录密码 ⇒ 这句是**已证实**的，不是威慑话术。 -->
        <p class="muted">查看动作会记录操作留痕（可追溯）；明文仅用于本次核验，请勿截屏、记录或外传。</p>
      </template>
    </el-dialog>

    <!-- 改密留痕（D3b）：改前/改后同为明文留档，同样默认遮罩 -->
    <el-dialog v-model="historyVisible" title="改密留痕（已记录操作日志）" width="760px" append-to-body>
      <div class="plain-toolbar">
        <el-button v-if="canRevealPlaintext" size="small" :type="historyRevealed ? 'info' : 'warning'" plain @click="historyRevealed ? hideHistoryPlaintext() : revealHistoryPlaintext()">
          {{ historyRevealed ? '隐藏明文' : '显示明文' }}
        </el-button>
        <span v-else class="muted">改前 / 改后：{{ NO_PERMISSION_HINT }}</span>
        <span v-if="historyRevealed" class="muted reveal-countdown">{{ historyCountdown }} 秒后自动隐藏</span>
        <span class="muted">查看动作会记录操作留痕（可追溯），请勿截屏或外传。</span>
      </div>
      <el-table v-loading="historyLoading" :data="historyList" border size="small" max-height="420">
        <el-table-column prop="createTime" label="时间" width="180" />
        <el-table-column prop="username" label="工号" width="140" />
        <el-table-column label="改前" width="130"><template #default="{ row }"><span class="plain-pwd" :class="{ 'plain-masked': !historyRevealed }">{{ plainLogText(row.passwordBefore) }}</span></template></el-table-column>
        <el-table-column label="改后" width="130"><template #default="{ row }"><span class="plain-pwd" :class="{ 'plain-masked': !historyRevealed }">{{ plainLogText(row.passwordAfter) }}</span></template></el-table-column>
        <el-table-column label="类型" width="90"><template #default="{ row }">{{ row.changeType === 'CREATE' ? '建号/发号' : '重置' }}</template></el-table-column>
        <el-table-column label="操作方" width="110"><template #default="{ row }">{{ row.operatorType === 'ADMIN' ? '中控' : '商家PC' }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" />
      </el-table>
    </el-dialog>
  </section>
</template>

<style scoped>
.filter-card { margin-bottom: 16px; }
.content-card { margin-bottom: 16px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.toolbar-count { margin-left: 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; }
.tag-gap { margin-left: 4px; }
.selection-tip { color: var(--el-text-color-secondary); font-size: 13px; }
.muted { color: var(--el-text-color-secondary); }
.danger-text { color: var(--el-color-danger); }
/* P7 回收站：已删除行置灰 */
:deep(.row-deleted) { color: var(--el-text-color-placeholder); background: var(--el-fill-color-light); }
:deep(.row-deleted .el-tag) { opacity: .8; }
.plain-pwd { font-family: monospace; font-weight: 600; }
/* 明文遮罩态：只做视觉弱化，真正的门禁是"渲染层根本不输出明文" */
.plain-masked { letter-spacing: 2px; color: var(--el-text-color-secondary); }
.reveal-countdown { margin-left: 8px; font-size: 12px; }
.plain-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; font-size: 12px; }
/* 身份多选 */
.identity-tip { margin-left: 10px; font-size: 12px; }
.identity-hint-box { white-space: pre-line; line-height: 1.7; }
/* 发号（D1b）弹窗 */
.issue-meta { margin-bottom: 14px; }
.issue-error { margin-top: 12px; }
.issue-note { margin-left: 6px; font-size: 12px; }
/* 微信标识三选一（2026-10-10）：三个 key 各一个输入，必须能一眼看出"哪个 key 会被提交" */
.wechat-input { width: 100%; }
.wechat-tip { display: block; line-height: 1.6; font-size: 12px; }
.wechat-cell-tip { font-size: 12px; }
.bind-form { margin-top: 14px; }
</style>
