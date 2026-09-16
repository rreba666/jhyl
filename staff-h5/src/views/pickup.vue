<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { staffLogin, staffVerify } from '@/api/staff'
import { clearSession, getSession, setSession, type StaffSession } from '@/utils/auth'
import { getModules, isModuleEnabled, type ModuleConfig } from '@/utils/config'
import type { StaffVerifyVO } from '@/types/staff'

/** 当前登录态（null 表示未登录）。 */
const session = ref<StaffSession | null>(null)
/** 登录表单字段。 */
const username = ref('')
const password = ref('')
/** 自提码（扫码从 URL 带入，或手动输入）。 */
const code = ref('')
/** 自提码是否来自扫码（决定 verifyType：扫码 0 / 手动 1）。 */
const fromScan = ref(false)
/** 登录 / 核销进行中标记。 */
const logging = ref(false)
const verifying = ref(false)
/** 核销成功后的订单明细。 */
const result = ref<StaffVerifyVO | null>(null)
/** 页面内错误提示。 */
const error = ref('')
/** 当前品牌模块开关（空 = 未配置/失败，按全部启用兜底）。 */
const moduleConfig = ref<ModuleConfig[] | null>(null)
/** pickup 模块是否启用；未启用则拦截核销入口。 */
const pickupEnabled = ref(true)

onMounted(() => {
  session.value = getSession()
  // 扫码链接形如 /pickup?c=自提码
  const urlCode = new URLSearchParams(window.location.search).get('c')
  if (urlCode) {
    code.value = urlCode.trim()
    fromScan.value = true
  }
  // 拉取模块配置；失败保底全部启用。
  void getModules().then((modules) => {
    moduleConfig.value = modules
    pickupEnabled.value = isModuleEnabled(modules, 'pickup')
  })
})

/** 当前登录身份文案：核销员 / 店长（含核销）。 */
function roleText(): string {
  const role = session.value?.role
  if (role === 'VERIFIER') return '核销员'
  if (role === 'MANAGER') return '店长（含核销）'
  return '核销账号'
}

/** 店员登录：工号+密码换 token（固定 client=H5，后端据此放行核销/店长、拦截商家与骑手）。 */
async function login(): Promise<void> {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入工号和密码'
    return
  }
  logging.value = true
  try {
    session.value = setSession(await staffLogin({ username: username.value.trim(), password: password.value, client: 'H5' }))
    password.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    logging.value = false
  }
}

/** 退出登录，回到登录态并保留当前自提码。 */
function logout(): void {
  clearSession()
  session.value = null
  result.value = null
}

/** 用户手动改动自提码时，视为手动输码。 */
function onCodeInput(): void {
  fromScan.value = false
  result.value = null
}

/** 提交核销。 */
async function submitVerify(): Promise<void> {
  error.value = ''
  if (!code.value.trim()) {
    error.value = '请输入自提码'
    return
  }
  verifying.value = true
  try {
    result.value = await staffVerify({ code: code.value.trim(), verifyType: fromScan.value ? 0 : 1 })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '核销失败'
  } finally {
    verifying.value = false
  }
}

/** 核销完成后继续下一单：清空结果与自提码。 */
function nextOrder(): void {
  result.value = null
  code.value = ''
  fromScan.value = false
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="header-title">自提核销</div>
      <div class="header-user" v-if="session">
        <span class="staff-name">{{ session.staffName }}（{{ roleText() }}）</span>
        <button class="link-btn" @click="logout">退出</button>
      </div>
    </header>

    <main class="main">
      <!-- pickup 模块停用：拦截核销入口 -->
      <section class="card" v-if="!pickupEnabled">
        <h2 class="card-title">自提核销暂停</h2>
        <p class="tip-text">当前品牌未开通「门店自提」功能，核销暂不可用。</p>
      </section>

      <!-- 未登录：显示登录表单 -->
      <section class="card" v-else-if="!session">
        <h2 class="card-title">店员登录</h2>
        <label class="field">
          <span class="field-label">工号</span>
          <input v-model="username" class="field-input" type="text" placeholder="请输入工号" autocomplete="username" />
        </label>
        <label class="field">
          <span class="field-label">密码</span>
          <input v-model="password" class="field-input" type="password" placeholder="请输入密码" autocomplete="current-password" @keyup.enter="login" />
        </label>
        <button class="primary-btn" :disabled="logging" @click="login">{{ logging ? '登录中…' : '登录' }}</button>
      </section>

      <!-- 已登录：核销输入 -->
      <section class="card" v-else-if="!result">
        <h2 class="card-title">核销自提订单</h2>
        <label class="field">
          <span class="field-label">自提码</span>
          <input v-model="code" class="field-input code-input" type="text" placeholder="扫码自动带入，或手动输入 12 位自提码" maxlength="12" @input="onCodeInput" />
        </label>
        <button class="primary-btn" :disabled="verifying" @click="submitVerify">{{ verifying ? '核销中…' : '确认核销' }}</button>
      </section>

      <!-- 核销成功：展示订单明细 -->
      <section class="card" v-else>
        <div class="success-badge">核销成功</div>
        <div class="detail">
          <div class="detail-row"><span class="detail-label">订单号</span><span class="detail-value">{{ result.orderNo }}</span></div>
          <div class="detail-row"><span class="detail-label">实付金额</span><span class="detail-value amount">¥ {{ Number(result.payAmount || 0).toFixed(2) }}</span></div>
          <div class="detail-row"><span class="detail-label">核销时间</span><span class="detail-value">{{ result.verifyTime }}</span></div>
        </div>
        <div class="items">
          <div class="items-title">商品明细</div>
          <div class="item-row" v-for="(item, index) in result.items" :key="index">
            <span class="item-name">{{ item.productName }}</span>
            <span class="item-qty">× {{ item.quantity }}</span>
          </div>
        </div>
        <button class="primary-btn" @click="nextOrder">继续核销下一单</button>
      </section>

      <p class="error-tip" v-if="error">{{ error }}</p>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; display: flex; flex-direction: column; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #1666d9; color: #fff; }
.header-title { font-size: 18px; font-weight: 600; }
.header-user { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.staff-name { opacity: 0.95; }
.link-btn { background: none; border: none; color: #fff; font-size: 13px; text-decoration: underline; cursor: pointer; padding: 0; }

.main { flex: 1; padding: 16px; max-width: 520px; width: 100%; margin: 0 auto; }
.card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04); }
.card-title { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #1f2329; }
.tip-text { margin: 0; font-size: 15px; color: #6b7280; line-height: 1.6; }

.field { display: block; margin-bottom: 14px; }
.field-label { display: block; margin-bottom: 6px; font-size: 13px; color: #6b7280; }
.field-input { width: 100%; height: 46px; padding: 0 14px; border: 1px solid #d9dde3; border-radius: 8px; font-size: 16px; color: #1f2329; background: #fafbfc; outline: none; }
.field-input:focus { border-color: #1666d9; background: #fff; }
.code-input { letter-spacing: 2px; font-size: 18px; }

.primary-btn { width: 100%; height: 48px; margin-top: 4px; border: none; border-radius: 8px; background: #1666d9; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
.primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.success-badge { text-align: center; font-size: 18px; font-weight: 600; color: #12a150; margin-bottom: 16px; }
.detail { border: 1px solid #eef0f3; border-radius: 8px; padding: 4px 14px; margin-bottom: 16px; }
.detail-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f2f4f7; }
.detail-row:last-child { border-bottom: none; }
.detail-label { font-size: 13px; color: #6b7280; }
.detail-value { font-size: 14px; color: #1f2329; }
.detail-value.amount { color: #e0432a; font-weight: 600; }

.items { margin-bottom: 16px; }
.items-title { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
.item-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #eef0f3; }
.item-row:last-child { border-bottom: none; }
.item-name { font-size: 14px; color: #1f2329; }
.item-qty { font-size: 14px; color: #6b7280; }

.error-tip { margin: 14px 0 0; padding: 10px 12px; background: #fef2f2; color: #dc2626; border-radius: 8px; font-size: 14px; text-align: center; }
</style>
