<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { staffChangePassword } from '@/api/staff'
import { clearSession, consumeNotice, getSession, setNotice } from '@/utils/auth'
import { authErrorMessage, isSessionInvalidError } from '@/utils/error'
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from '@/utils/navigation'

/** 新密码长度区间：与后端契约一致（`newPassword` 6~32 位）。 */
const MIN_PASSWORD_LENGTH = 6
const MAX_PASSWORD_LENGTH = 32

/**
 * 客户端校验文案：**与后端保持一致**（契约「新密码 6~32 位、不能与原密码相同」）；
 * 这里的拦截只是少发一次必然失败的请求，服务端仍是权威（`1000` 会原样展示）。
 */
const LENGTH_MESSAGE = `新密码长度需为 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH} 位`
const SAME_MESSAGE = '新密码不能与原密码相同'

const route = useRoute()
const router = useRouter()

/** 原密码。 */
const oldPassword = ref('')
/** 新密码。 */
const newPassword = ref('')
/** 确认新密码。 */
const confirmPassword = ref('')
/** 提交中标记。 */
const submitting = ref(false)
/** 页面内错误提示（后端失败码会翻成中文文案，不透出裸码）。 */
const error = ref('')
/** 改密成功标记：成功后本地登录态已清、等待回登录页。 */
const success = ref(false)
/** 一次性提示，来自路由跳转（改密成功后回登录页时读）。 */
const notice = ref('')

/** 是否"被强制带过来改密"（路由带 `?force=1`；强制态下不提供返回核销页入口）。 */
const forced = computed(() => route.query.force === '1')

onMounted(() => {
  notice.value = consumeNotice()
  const session = getSession()
  if (!session) {
    // 兜底：守卫已处理多数情况；这里防"直接改 hash/清空 localStorage"后进页面提交必然 8104。
    void router.replace(LOGIN_PATH)
  }
})

/** 本地校验；返回错误文案，通过时返回空串。 */
function validate(): string {
  if (!oldPassword.value) return '请输入原密码'
  if (!newPassword.value) return '请输入新密码'
  if (newPassword.value.length < MIN_PASSWORD_LENGTH || newPassword.value.length > MAX_PASSWORD_LENGTH) {
    return LENGTH_MESSAGE
  }
  if (newPassword.value === oldPassword.value) return SAME_MESSAGE
  if (!confirmPassword.value) return '请再次输入新密码'
  if (confirmPassword.value !== newPassword.value) return '两次输入的新密码不一致'
  return ''
}

/** 清空密码输入（成功与失败都不把密码留在输入框里）。 */
function resetFields(): void {
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

/** 提交改密。 */
async function submit(): Promise<void> {
  if (submitting.value || success.value) return
  error.value = ''
  const message = validate()
  if (message) {
    error.value = message
    return
  }
  submitting.value = true
  try {
    await staffChangePassword({ oldPassword: oldPassword.value, newPassword: newPassword.value })
    handleSuccess()
  } catch (err) {
    handleFailure(err)
  } finally {
    submitting.value = false
  }
}

/**
 * 改密成功：后端**已删除 Redis 登录标记（踢下线）**，旧 token 立刻失效
 * ⇒ 先清本地登录态（绝不停留在"token 已死"的页面），提示「密码已修改，请用新密码登录」，再回登录页。
 * 提示用 sessionStorage 传递（`setNotice`）+ 500ms 让用户看清页面上的成功态，避免"页面闪一下就没"。
 */
function handleSuccess(): void {
  clearSession()
  resetFields()
  success.value = true
  setNotice('密码已修改，请用新密码登录')
  window.setTimeout(() => {
    void router.replace(LOGIN_PATH)
  }, 500)
}

/**
 * 改密失败：8104 已由请求层清会话并跳登录页，这里直接让位；其余落页面内提示。
 * ⚠️ 必须传 'change-password'：本接口的 8102 是「原密码不正确」（与登录接口的
 * 「工号或密码错误」同码不同义，契约里已分别写明）。
 */
function handleFailure(err: unknown): void {
  if (isSessionInvalidError(err)) return
  error.value = authErrorMessage(err, '修改密码失败，请稍后重试', 'change-password')
  resetFields()
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="header-title">修改密码</div>
    </header>

    <main class="main">
      <section class="card">
        <h2 class="card-title">修改登录密码</h2>

        <!-- 首登强制改密说明：只有被强制带过来的才显示 -->
        <p class="tip-text" v-if="forced && !success">
          当前使用的是初始密码，请先设置新密码后再继续使用核销功能。
        </p>

        <!-- 改密成功：旧 token 已失效，正在回登录页 -->
        <div class="success-badge" v-if="success">密码已修改，请用新密码登录</div>

        <template v-else>
          <label class="field">
            <span class="field-label">原密码</span>
            <input
              v-model="oldPassword"
              class="field-input"
              type="password"
              placeholder="请输入原密码（首次登录为初始密码）"
              autocomplete="current-password"
            />
          </label>
          <label class="field">
            <span class="field-label">新密码</span>
            <input
              v-model="newPassword"
              class="field-input"
              type="password"
              :placeholder="`请输入新密码（${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH} 位，不能与原密码相同）`"
              autocomplete="new-password"
            />
          </label>
          <label class="field">
            <span class="field-label">确认新密码</span>
            <input
              v-model="confirmPassword"
              class="field-input"
              type="password"
              placeholder="请再次输入新密码"
              autocomplete="new-password"
              @keyup.enter="submit"
            />
          </label>
          <button class="primary-btn" :disabled="submitting" @click="submit">
            {{ submitting ? '提交中…' : '确认修改' }}
          </button>
          <p class="rule-tip">新密码需 {{ MIN_PASSWORD_LENGTH }}~{{ MAX_PASSWORD_LENGTH }} 位，且不能与原密码相同；修改成功后需用新密码重新登录。</p>
        </template>

        <p class="error-tip" v-if="error">{{ error }}</p>

        <!-- 非强制（自己主动来改密）才给退出入口；强制态下只能改密 -->
        <button class="link-btn" v-if="!forced && !success" @click="router.replace(LOGIN_PATH)">返回核销页</button>
      </section>

      <p class="notice-tip" v-if="notice">{{ notice }}</p>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; display: flex; flex-direction: column; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #1666d9; color: #fff; }
.header-title { font-size: 18px; font-weight: 600; }

.main { flex: 1; padding: 16px; max-width: 520px; width: 100%; margin: 0 auto; }
.card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04); }
.card-title { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #1f2329; }
.tip-text { margin: 0 0 16px; font-size: 13px; color: #b25b00; background: #fff7e6; border-radius: 8px; padding: 10px 12px; line-height: 1.6; }

.field { display: block; margin-bottom: 14px; }
.field-label { display: block; margin-bottom: 6px; font-size: 13px; color: #6b7280; }
.field-input { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #d9dde3; border-radius: 8px; font-size: 16px; color: #1f2329; background: #fafbfc; outline: none; }
.field-input:focus { border-color: #1666d9; background: #fff; }

.primary-btn { width: 100%; height: 48px; margin-top: 4px; border: none; border-radius: 8px; background: #1666d9; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.rule-tip { margin: 12px 0 0; font-size: 12px; color: #8b93a1; line-height: 1.6; }
.success-badge { text-align: center; font-size: 16px; font-weight: 600; color: #12a150; padding: 12px 0 4px; }
.error-tip { margin: 14px 0 0; padding: 10px 12px; background: #fef2f2; color: #dc2626; border-radius: 8px; font-size: 14px; text-align: center; }
.notice-tip { margin: 14px 0 0; padding: 10px 12px; background: #eef6ff; color: #1666d9; border-radius: 8px; font-size: 14px; text-align: center; }

.link-btn { display: block; margin: 16px auto 0; background: none; border: none; color: #6b7280; font-size: 13px; text-decoration: underline; cursor: pointer; padding: 0; }
</style>
