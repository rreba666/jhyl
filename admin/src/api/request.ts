import axios from 'axios'
import { sanitizeBonusText } from '@/utils/textSafe'

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthRedirect?: boolean
    /**
     * 可选的请求幂等键：传入时会作为请求头 `X-Request-Id` 发给后端。
     * 后端「接口调用计数」（fengling-apicount）以该头为幂等键 —— 同一个 id 重复提交只计一次调用。
     * **不传则不发这个头**（= 无幂等，保持历史行为），值的生成与复用见 `@/utils/requestId`。
     */
    requestId?: string
  }
}

export type { ApiResponse } from '@/types/common'

/** 清理失效认证并跳转到登录页，保留当前地址供登录后返回。 */
function redirectToLogin(): void {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_login_info')
  if (window.location.pathname === '/login') return
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`)
}

/**
 * 后端基址（按优先级）：
 * 1. `VITE_ADMIN_API_BASE_URL` —— **admin 专用覆盖**（仍复用 `mini_shop` 的 env 文件，见 `vite.config.ts` 的 `envDir`）。
 *    为什么需要这一层：微信小程序的「request 合法域名」**不允许带端口**（必须 443 https），
 *    而后端 2026-09-22 对外暴露的是 `https://yladmin.jinhuayou365.com:8443`（带端口）
 *    → **后台能用、小程序不能用**，两者必须允许配成不同的值。
 * 2. `VITE_API_BASE_URL` —— 与小程序的共用值（未单独覆盖时的回退）。
 * 3. 兜底：dev 用内网地址、生产用正式域名 —— 今华有肽的教训：baseURL 为 `undefined` 时 axios 会静默走相对路径、
 *    打到当前站点，报错很隐蔽。⚠️ 用 `import.meta.env.DEV` 分支是为了让**内网地址不出现在生产包里**（构建时被常量折叠）。
 */
// 后端 2026-09-22 已在 443 上提供（不带端口）→ 生产兜底也用无端口形态，产物里不会再出现 :8443
const FALLBACK_API_BASE_URL = import.meta.env.DEV ? 'http://192.168.1.4:8080' : 'https://yladmin.jinhuayou365.com'

/**
 * 后端基址（**全项目唯一来源**，末尾斜杠已归一化）。
 * ⚠️ `api/media.ts` 也 import 这个常量来补全图片地址 —— 它原先自己读 `VITE_API_BASE_URL`，
 * 于是后台的图片/头像前缀用的是**小程序那个值**（生产=内网）→ 部署后后台图片会全裂（2026-09-22 发现并修）。
 */
export const API_BASE_URL = String(
  import.meta.env.VITE_ADMIN_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || FALLBACK_API_BASE_URL,
).replace(/\/+$/, '')

// 统一请求实例，使用 Vite 环境变量区分不同部署环境的后端地址。
export const request = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  // Spring 接口将数组绑定为重复查询参数，例如 statuses=6&statuses=7。
  paramsSerializer: { indexes: null },
})

// 请求拦截器统一注入管理员 Token。今华有礼为单商城系统，无 X-App-Key / 品牌切换。
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  // 幂等键：**调用方显式传入 `requestId` 时才发送** `X-Request-Id`（不传 = 无幂等，不自动生成）
  if (config.requestId) config.headers['X-Request-Id'] = config.requestId
  return config
})

// 响应拦截器统一转换 HTTP、网络和超时错误；404/500 等业务响应由具体 API 校验。
// 后端下发的 message 一律经 sanitizeBonusText 兜底，保证页面任何情况下不出现历史遗留旧词。
request.interceptors.response.use(
  (response) => {
    // 1004：数据范围越权（HTTP 200 业务错误）→ 统一提示
    const code = response.data?.code
    if (code === 1004) {
      return Promise.reject(new Error(sanitizeBonusText(response.data?.message) || '只能操作自己商户的门店/店员'))
    }
    return response
  },
  (error) => {
    // 401：登录态失效 → 跳登录
    if (error.response?.status === 401) {
      if (error.config?.skipAuthRedirect) {
        return Promise.reject(new Error(sanitizeBonusText(error.response?.data?.message) || '当前管理员信息查询失败'))
      }
      redirectToLogin()
      return Promise.reject(new Error('登录状态已失效，请重新登录'))
    }
    // 403：无权限（RoleGuard/服务层校验）→ 提示无权限，不跳登录
    if (error.response?.status === 403) {
      return Promise.reject(new Error(sanitizeBonusText(error.response?.data?.message) || '您没有权限执行此操作'))
    }
    // 404：接口不存在（常见于后端尚未上线的接口）→ 给出明确文案，避免被误报成"网络异常"
    if (error.response?.status === 404) {
      return Promise.reject(new Error(sanitizeBonusText(error.response?.data?.message) || '接口不存在或尚未上线，请联系后端确认'))
    }
    // 405：路径存在但后端未实现该方法（例如某接口只实现了 GET）→ 用业务可读文案，屏蔽技术报错原文
    if (error.response?.status === 405) {
      return Promise.reject(new Error('该功能所需的后端接口尚未上线，暂无法使用，请联系后端确认'))
    }
    if (error.response?.data?.message) {
      return Promise.reject(new Error(sanitizeBonusText(error.response.data.message)))
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error('请求超时，请稍后重试'))
    }
    return Promise.reject(new Error('网络异常，请稍后重试'))
  },
)
