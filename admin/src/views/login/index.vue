<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { loginAdmin } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

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
    <!-- 左栏（55%）：品牌展示区（窄屏隐藏） -->
    <section class="login-aside">
      <div class="aside-glow aside-glow-a" />
      <div class="aside-glow aside-glow-b" />
      <div class="aside-ring" />
      <div class="aside-brand">
        <span class="login-mark">E</span>
        <div>
          <strong>E-Admin Pro</strong>
          <p>电商后台管理系统</p>
        </div>
      </div>
      <div class="aside-slogan">
        <h2>多品牌商城管理平台</h2>
        <p>一套系统，服务多个品牌，高效运营每一天</p>
      </div>
    </section>

    <!-- 右栏（45%）：登录表单区 -->
    <section class="login-main">
      <div class="login-card login-card-enter">
        <div class="login-heading"><h1>管理员登录</h1><p>请输入管理员账号和密码</p></div>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submitLogin">
          <el-form-item prop="username"><el-input v-model="form.username" placeholder="管理员账号" clearable /></el-form-item>
          <el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="登录密码" show-password @keyup.enter="submitLogin" /></el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" class="login-button">登录</el-button>
        </el-form>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* 登录页恒深色（莫兰迪渐变 + 金色点缀），不随主题切换 */
.login-page { min-height: 100vh; display: flex; background: linear-gradient(160deg, #10131a 0%, #1a1f2b 50%, #222836 100%); position: relative; overflow: hidden; }

/* ===== 左栏（55%）：品牌展示区 ===== */
.login-aside { position: relative; display: flex; flex: 1 1 55%; flex-direction: column; justify-content: center; padding: 0 8vw; overflow: hidden; color: #e7e9ee; }
/* 金色光晕装饰 */
.aside-glow { position: absolute; border-radius: 50%; filter: blur(80px); pointer-events: none; }
.aside-glow-a { width: 380px; height: 380px; top: -80px; left: -60px; background: radial-gradient(circle, rgba(212,168,67,.30), transparent 65%); }
.aside-glow-b { width: 320px; height: 320px; right: -40px; bottom: -80px; background: radial-gradient(circle, rgba(212,168,67,.20), transparent 65%); }
/* 大圆环装饰 */
.aside-ring { position: absolute; right: 10%; bottom: -160px; width: 420px; height: 420px; border: 1px solid rgba(212,168,67,.16); border-radius: 50%; pointer-events: none; }
.aside-ring::after { content: ''; position: absolute; top: 48px; right: 48px; width: 260px; height: 260px; border: 1px solid rgba(212,168,67,.10); border-radius: 50%; }
/* 品牌标识：金色标 + 品牌名 */
.aside-brand { display: flex; align-items: center; gap: 16px; position: relative; z-index: 1; }
.login-mark { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, #d4a843, #f0c96a); color: #fff; font-size: 30px; font-weight: 700; box-shadow: 0 6px 18px rgba(212,168,67,.35); }
.aside-brand strong { font-size: 26px; font-weight: 700; letter-spacing: .5px; }
.aside-brand p { margin: 6px 0 0; color: rgba(255,255,255,.6); font-size: 14px; }
/* 品牌口号 */
.aside-slogan { position: relative; z-index: 1; margin-top: 56px; }
.aside-slogan h2 { margin: 0 0 14px; color: #f0c96a; font-size: 34px; font-weight: 600; line-height: 1.3; }
.aside-slogan p { margin: 0; color: rgba(255,255,255,.55); font-size: 16px; line-height: 1.7; }

/* ===== 右栏（45%）：登录表单区 ===== */
.login-main { display: flex; flex: 1 1 45%; align-items: center; justify-content: center; padding: 24px; }
/* 登录卡片固定深色毛玻璃背景，不随主题切换，确保浅色文字始终可读 */
.login-card { width: 400px; padding: 44px 40px 40px; border-radius: 18px; background: rgba(26, 31, 40, 0.68); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(212,168,67,.25); box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.login-card-enter { animation: login-card-in .6s cubic-bezier(.22,.8,.28,1) both; }
@keyframes login-card-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
.login-heading { margin: 0 0 28px; }
.login-heading h1 { margin: 0; color: #e7e9ee; font-size: 26px; }
.login-heading p { margin: 8px 0 0; color: rgba(255,255,255,.6); font-size: 14px; }
.login-button { width: 100%; margin-top: 8px; }

/* ===== 响应式：窄屏隐藏左栏，右栏全宽 ===== */
@media (max-width: 900px) {
  .login-aside { display: none; }
  .login-main { flex: 1 1 100%; }
}
</style>
