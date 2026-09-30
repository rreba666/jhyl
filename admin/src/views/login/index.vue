<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { loginAdmin } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
// ⚠️ 2026-09-30：品牌资源。
//   · `logo.png`  = 今华有礼绿色龙标（方形，取自小程序 `static/logo.png`）→ 替换原先写死的字母「E」标
//   · `index.png` = 品牌整图（白底横版：龙标 + 今華有礼 + JinhuaYou + 「今华有礼，礼赠万家。」）→ 左侧展示区
import logoUrl from '@/assets/logo.png'
import visualUrl from '@/assets/index.png'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入管理员账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入登录密码', trigger: 'blur' }],
}

/**
 * 判断重定向地址是否为当前站点内的安全路径；无 redirect 时默认进商户业务台（单商户系统）。
 */
function getSafeRedirect(): string {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect
  return '/merchant'
}

/** 校验登录表单、调用接口并跳转到原目标页面。 */
async function submitLogin(): Promise<void> {
  if (loading.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const loginData = await loginAdmin(form)
    authStore.setLoginData(loginData)
    ElMessage.success('登录成功')
    await router.replace(getSafeRedirect())
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <!-- ⚠️ 2026-09-30 改版：原先是「左栏品牌文字区 + 右栏登录卡」左右分栏。
         现按用户要求调整为：
           · 左侧：只放**品牌整图**（`index.png`）撑满整个左栏；
           · 右侧：把原左栏的**品牌标识与口号移到登录框上方**，下面才是登录表单。 -->
    <section class="login-visual">
      <img class="login-visual-img" :src="visualUrl" alt="今华有礼" />
    </section>

    <section class="login-main">
      <div class="login-panel login-card-enter">
        <!-- 品牌标识（原左栏内容，上移到登录框上方） -->
        <header class="panel-brand">
          <img class="panel-logo" :src="logoUrl" alt="今华有礼" />
          <div class="panel-brand-text">
            <strong>今华有礼后台管理系统</strong>
            <p>多品牌商城管理平台 · 一套系统，服务多个品牌</p>
          </div>
        </header>

        <div class="login-card">
          <div class="login-heading"><h1>管理员登录</h1><p>请输入管理员账号和密码</p></div>
          <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submitLogin">
            <el-form-item prop="username"><el-input v-model="form.username" placeholder="管理员账号" clearable /></el-form-item>
            <el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="登录密码" show-password @keyup.enter="submitLogin" /></el-form-item>
            <el-button type="primary" native-type="submit" :loading="loading" class="login-button">登录</el-button>
          </el-form>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ⚠️ 2026-09-30 改版说明：
   原登录页是「深色莫兰迪渐变 + 金色点缀」的风格；但本次左侧要展示的品牌图 `index.png` 是**白底**的，
   若右侧仍保持深色会非常割裂 ⇒ 整体改为**白色/浅色专业风**，主色取自 logo 的绿（`#268A50`）。
   ⚠️ 底色按要求为**纯白**（左栏品牌图本身也是白底 ⇒ 两者融为一体，只留一条细分界线）。
   ⚠️ 仅在本页覆盖主色，**不动全局 `--vben-primary`**（后台其它页面仍是金色主题）。 */
.login-page { min-height: 100vh; display: flex; background: #fff; }

/* ===== 左栏：品牌整图撑满 ===== */
/* 图片本身是「白底 + 居中 logo」，所以容器也用白底 ⇒ 两者融为一体、看起来就是整块品牌画面。
   `object-fit: contain` 保证图片**完整不被裁切**（若改成 cover，竖长左栏会把 logo 两侧裁掉）。 */
.login-visual { flex: 1 1 52%; display: flex; align-items: center; justify-content: center; padding: 40px; overflow: hidden; background: #fff; border-right: 1px solid #ebefec; }
.login-visual-img { width: 100%; height: 100%; object-fit: contain; }

/* ===== 右栏：品牌信息 + 登录表单 ===== */
.login-main { display: flex; flex: 1 1 48%; align-items: center; justify-content: center; padding: 32px; }
.login-panel { width: 100%; max-width: 400px; }
/* 品牌标识（原左栏内容） */
.panel-brand { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
.panel-logo { width: 48px; height: 48px; flex: none; object-fit: contain; }
.panel-brand-text strong { display: block; color: #1d2b23; font-size: 20px; font-weight: 700; letter-spacing: .3px; }
.panel-brand-text p { margin: 6px 0 0; color: #6b7b73; font-size: 13px; line-height: 1.5; }
/* 登录卡片：浅色白卡 + 柔和阴影 */
.login-card { padding: 36px 32px 32px; border-radius: 16px; background: #fff; border: 1px solid #e6ebe8; box-shadow: 0 10px 30px rgba(29, 43, 35, .07); }
/* 入场动画。⚠️ 用 `backwards` 而非 `both`：`both` 会在动画结束后**永久保留** `transform`，
   而非 none 的 transform 会让后代 `position: fixed` 相对本元素定位（见 style.css 的同款说明）。 */
.login-card-enter { animation: login-card-in .6s cubic-bezier(.22,.8,.28,1) backwards; }
@keyframes login-card-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
.login-heading { margin: 0 0 28px; }
.login-heading h1 { margin: 0; color: #1d2b23; font-size: 24px; }
.login-heading p { margin: 8px 0 0; color: #7d8b84; font-size: 14px; }
.login-button { width: 100%; margin-top: 8px; }
/* 登录页专属品牌色（绿）：按钮 + 输入框聚焦描边，与左侧品牌图呼应 */
.login-card :deep(.el-button--primary) {
  --el-button-bg-color: #268A50;
  --el-button-border-color: #268A50;
  --el-button-hover-bg-color: #2f9e5c;
  --el-button-hover-border-color: #2f9e5c;
  --el-button-active-bg-color: #1f7343;
  --el-button-active-border-color: #1f7343;
}
.login-card :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #268A50 inset; }

/* ===== 响应式：窄屏隐藏左图，右栏全宽 ===== */
@media (max-width: 900px) {
  .login-visual { display: none; }
  .login-main { flex: 1 1 100%; }
}
</style>
