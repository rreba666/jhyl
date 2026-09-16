import axios from 'axios'
import { sanitizeBonusText } from '@/utils/textSafe'

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthRedirect?: boolean
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

// 统一请求实例，使用 Vite 环境变量区分不同部署环境的后端地址。
export const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
  // Spring 接口将数组绑定为重复查询参数，例如 statuses=6&statuses=7。
  paramsSerializer: { indexes: null },
})

// 请求拦截器统一注入管理员 Token。今华有礼为单商城系统，无 X-App-Key / 品牌切换。
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
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
