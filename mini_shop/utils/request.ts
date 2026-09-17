import developmentEnv from '../.env?raw'
import productionEnv from '../.env.production?raw'
import { clearAuth } from './auth'

/**
 * 展示层术语归一化：后端错误文案里若出现旧术语（Unicode 转义 5206 7EA2），
 * 统一按产品口径显示为「红包」。只处理提示文本，不改动业务码与任何接口字段；
 * 放在 `ApiRequestError` 构造函数里可覆盖 request / uploadFile 的全部报错出口，避免逐个调用点遗漏。
 */
function normalizeMessage(message: string): string {
  return String(message || '').replace(/\u5206\u7EA2/g, '红包')
}

/** 统一表示网络、HTTP 和后端业务失败，并保留后端业务码。 */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(normalizeMessage(message))
    this.name = 'ApiRequestError'
  }
}

/** 判断异常是否为请求层统一错误。 */
export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError
}

/** 从环境文件原文中读取指定配置，兼容 HBuilderX 不注入自定义 VITE 变量的情况。 */
function readEnvValue(source: string, key: string): string {
  const line = source.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`))
  return line ? line.trim().slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') : ''
}

const envSource = import.meta.env.MODE === 'production' ? productionEnv : developmentEnv
const API_BASE_URL = readEnvValue(envSource, 'VITE_API_BASE_URL').replace(/\/+$/, '')

/** 品牌标识（X-App-Key）：读 VITE_APP_KEY，小写 trim；未配置时默认 jinhua（与后端默认品牌一致）。 */
const APP_KEY = (readEnvValue(envSource, 'VITE_APP_KEY') || 'jinhua').trim().toLowerCase()

interface ApiResponse<T> {
  code?: number
  message?: string
  success?: boolean
  data?: T
}

/** 清理失效会话，但不改变当前页面路由；是否引导登录由具体业务页面决定。 */
function handleUnauthorized(statusCode: number, businessCode?: number): void {
  if (statusCode !== 401 && Number(businessCode) !== 401) return
  clearAuth()
}

/** 公开只读接口遇到旧 Token 时允许以游客身份重试一次。 */
function isPublicBrowseRequest(url: string | undefined, method?: string): boolean {
  if ((method || 'GET').toUpperCase() !== 'GET' || !url) return false
  const path = url.split(/[?#]/, 1)[0]
  return path === '/api/category/list'
    || path === '/api/product/list'
    || /^\/api\/v2\/product\/detail\/[^/]+$/.test(path)
    || path === '/api/v2/homepage'
    || path === '/api/shop/all'
    || /^\/api\/(public|setting|coupon|announcement)\//.test(path)
    || path === '/api/image'
    || path.startsWith('/api/image/')
}

function removeAuthorizationHeader(header: UniApp.RequestOptions['header']): UniApp.RequestOptions['header'] {
  const next = { ...(header || {}) } as Record<string, string>
  Object.keys(next)
    .filter((key) => key.toLowerCase() === 'authorization')
    .forEach((key) => { delete next[key] })
  return next
}

/** 公开浏览请求遇到旧 Token 401 时，清理会话并以游客身份重试一次。 */
function retryWithoutAuthorization<T>(options: UniApp.RequestOptions, resolve: (value: T) => void, reject: (reason?: unknown) => void): void {
  clearAuth()
  requestInternal<T>({ ...options, header: removeAuthorizationHeader(options.header) }, false).then(resolve, reject)
}

/** 发起 uni-app 网络请求，统一处理鉴权头和后端错误。 */
function requestInternal<T = unknown>(options: UniApp.RequestOptions, allowPublicRetry: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!API_BASE_URL) {
      reject(new ApiRequestError('未配置 VITE_API_BASE_URL，请检查 mini_shop 工程目录环境文件'))
      return
    }

    const token = uni.getStorageSync('mini_shop_token')
    const header: Record<string, string> = { ...(options.header || {}) }

    if (options.method && options.method.toUpperCase() !== 'GET') {
      header['Content-Type'] = 'application/json'
    }
    // 品牌标识：后端据此路由到对应品牌库（不传 = 默认品牌 jinhua）
    header['X-App-Key'] = APP_KEY
    if (token) {
      header.Authorization = `Bearer ${token}`
    }

    uni.request({
      ...options,
      url: `${API_BASE_URL}${options.url}`,
      timeout: options.timeout ?? 15000,
      header,
      success: (response) => {
        const body = (response.data && typeof response.data === 'object'
          ? response.data
          : {}) as ApiResponse<T>
        const unauthorized = response.statusCode === 401 || Number(body.code) === 401
        if (allowPublicRetry && token && isPublicBrowseRequest(options.url, options.method) && unauthorized) {
          retryWithoutAuthorization(options, resolve, reject)
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          handleUnauthorized(response.statusCode, body.code)
          // 404/405：接口不存在或未上线 → 给业务可读文案（与今华有肽同口径），避免被误报成「网络异常」
          if (response.statusCode === 404) {
            reject(new ApiRequestError(body.message || '接口不存在或尚未上线，请联系后端确认', body.code))
            return
          }
          if (response.statusCode === 405) {
            reject(new ApiRequestError('该功能所需的后端接口尚未上线，暂无法使用', body.code))
            return
          }
          reject(new ApiRequestError(body.message || '网络异常，请稍后重试', body.code))
          return
        }
        if (body.success === false || (body.code != null && body.code !== 0)) {
          handleUnauthorized(response.statusCode, body.code)
          reject(new ApiRequestError(body.message || '请求失败', body.code))
          return
        }
        resolve(body.data as T)
      },
      fail: (error) => {
        reject(new ApiRequestError(error.errMsg || '网络异常，请稍后重试'))
      },
    })
  })
}

/** 对外请求入口。公开浏览接口只有在旧 Token 失效时才会无 Token 重试一次。 */
export function request<T = unknown>(options: UniApp.RequestOptions): Promise<T> {
  return requestInternal<T>(options, true)
}

/**
 * 上传本地文件到后端通用上传接口，返回后端代理 URL（响应 data 为 URL 字符串）。
 * 用于头像等需要把微信临时文件转成永久可访问地址的场景。
 * 后端接口规范：POST /api/common/upload，multipart 字段名 file，返回 { code, message, data: "https://..." }。
 */
export function uploadFile(filePath: string, name = 'file'): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!API_BASE_URL) {
      reject(new ApiRequestError('未配置 VITE_API_BASE_URL，请检查 mini_shop 工程目录环境文件'))
      return
    }
    const token = uni.getStorageSync('mini_shop_token')
    const uploadHeader: Record<string, string> = { 'X-App-Key': APP_KEY }
    if (token) uploadHeader.Authorization = `Bearer ${token}`
    uni.uploadFile({
      url: `${API_BASE_URL}/api/common/upload`,
      filePath,
      name,
      header: uploadHeader,
      success: (response) => {
        try {
          const body = JSON.parse(response.data) as ApiResponse<string>
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new ApiRequestError(body.message || '网络异常，请稍后重试', body.code))
            return
          }
          if (body.success === false || (body.code != null && body.code !== 0)) {
            reject(new ApiRequestError(body.message || '上传失败', body.code))
            return
          }
          if (!body.data) {
            reject(new ApiRequestError('上传成功但未返回文件地址'))
            return
          }
          resolve(body.data)
        } catch {
          reject(new ApiRequestError('上传响应解析失败'))
        }
      },
      fail: (error) => {
        reject(new ApiRequestError(error.errMsg || '上传失败'))
      },
    })
  })
}
