import developmentEnv from '../.env?raw'
import productionEnv from '../.env.production?raw'
import { clearAuth } from './auth'

/**
 * 展示层术语归一化：后端文案里若残留历史旧术语（Unicode 转义 5206 7EA2），统一改写为「红包」。
 * 只处理提示文本，不改动业务码与任何接口字段。
 *
 * ⚠️ 2026-09-27 修正两个 bug（与今华有肽同口径，此前实现会破坏文案）：
 *  ① **复合词优先**：若先替换单个旧词，后端的「旧词+红包」会变成「红包红包」；
 *  ② **保护合规词「「部分」+「红包」」**：它内部含旧词子串，误替换会毁成「部红包包」。
 * ⇒ 用 `replace` **回调**判断上下文（前一字「部」且后一字「包」则跳过），
 *   **不要用 lookbehind** —— 低版本 iOS 的 JavaScriptCore 不支持，正则字面量会在**解析期**报错、整个文件挂掉。
 *
 * 该实现幂等：正确归一化过的文案再过一次结果不变，因此各页面可安全重复调用。
 */
export function normalizeLegacyWording(input: string): string {
  // ① 复合词优先：「旧词 + 红包」整体收敛为一个「红包」
  let text = String(input || '').replace(/\u5206\u7EA2\u7EA2\u5305/g, '\u7EA2\u5305')
  // ② 单个旧词替换，但跳过合规词「「部分」+「红包」」里的那一个
  text = text.replace(/\u5206\u7EA2/g, (match: string, offset: number, whole: string): string => {
    const before = whole[offset - 1]
    const after = whole[offset + 2]
    return before === '\u90E8' && after === '\u5305' ? match : '\u7EA2\u5305'
  })
  return text
}

/** 兼容旧调用名：报错出口统一走 {@link normalizeLegacyWording}。 */
function normalizeMessage(message: string): string {
  return normalizeLegacyWording(message)
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

/**
 * 生产构建却指向内网/本机地址时**运行时直接告警**（这件事编译期拦不住）。
 *
 * 起因（2026-09-22）：反馈「重新编译后请求地址仍是内网 dev 地址（ERR_CONNECTION_TIMED_OUT）」——
 * 根因是走的 HBuilderX **「运行到小程序模拟器」**（`MODE=development` → 读 `.env`），而那份 `.env` 还写着当天已下线的内网地址。
 * 现在**两份 env 都指向公网域名**，这条告警用于防止将来再改回去。
 * （只匹配内网网段前缀、不写具体 IP —— `tests/env-config.contract.ps1` 有"禁止硬编码内网 IP"的反向断言。）
 */
if (import.meta.env.MODE === 'production' && /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(API_BASE_URL)) {
  console.warn('[env] 生产构建仍在使用内网/本机后端地址：', API_BASE_URL)
}

/**
 * 品牌标识（X-App-Key）：读 `VITE_APP_KEY`，小写 trim。
 * 未配置时默认 **`longping`（今华有礼自己的品牌）** —— 原默认值是 `jinhua`（今华有肽），
 * 漏配环境变量会被后端路由到**另一个品牌的库**，属高危默认值（与 staff-h5 同批修正，2026-09-22）。
 */
const APP_KEY = (readEnvValue(envSource, 'VITE_APP_KEY') || 'longping').trim().toLowerCase()

interface ApiResponse<T> {
  code?: number
  message?: string
  success?: boolean
  data?: T
}

/**
 * 请求入参：uni-app 原生请求参数 + 一个**可选**的幂等键 `requestId`。
 *
 * - 传了：请求层会把它写成请求头 `X-Request-Id` → 后端「接口调用计数」（fengling-apicount）
 *   以该头为幂等键，同一 id 重复提交只计一次；
 * - **没传：绝对不发这个头**（= 无幂等，保持历史行为）——请求层**不会自动生成**，
 *   以免把"本来没有幂等语义"的读接口也带上幂等键。
 *
 * 值的生成与复用规则见 `utils/request-id.ts`：同一次业务动作（防连点 + 失败重试）复用同一个值。
 */
export type RequestOptions = UniApp.RequestOptions & { requestId?: string }

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
    // 2026-10-10 S3 / S2b 新增的两条 C 端公开门店接口（免登录、游客可访问）：
    // 旧 Token 失效时同样要能降级成游客重试，否则店铺页会显示成"加载失败"。
    || /^\/api\/shop\/[^/]+$/.test(path)
    || /^\/api\/shop\/[^/]+\/products$/.test(path)
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
function retryWithoutAuthorization<T>(options: RequestOptions, resolve: (value: T) => void, reject: (reason?: unknown) => void): void {
  clearAuth()
  requestInternal<T>({ ...options, header: removeAuthorizationHeader(options.header) }, false).then(resolve, reject)
}

/**
 * 过滤 `data` 中值为 `undefined` 的字段。
 *
 * 微信小程序的 `uni.request` 会把 `undefined` 拼成**字面量字符串** `undefined` 发给后端，
 * 于是后端按字符串校验时报出「时间格式非法: undefined（支持 2026-09-01 或 2026-09-01 10:00:00）」
 * 「month 格式应为 yyyy-MM，如 2026-09」这类**看起来像后端 bug** 的错误（2026-09-19 实测踩到）。
 * 这里统一丢弃 `undefined`，让"不传这个参数"真正等于不传；`null` 与空串保持原样（可能是有效语义）。
 */
function omitUndefinedData(data: UniApp.RequestOptions['data']): UniApp.RequestOptions['data'] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const entries = Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as UniApp.RequestOptions['data']
}

/** 发起 uni-app 网络请求，统一处理鉴权头和后端错误。 */
function requestInternal<T = unknown>(options: RequestOptions, allowPublicRetry: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!API_BASE_URL) {
      reject(new ApiRequestError('未配置 VITE_API_BASE_URL，请检查 mini_shop 工程目录环境文件'))
      return
    }

    // 拆出请求层扩展字段：`requestId` 不是 uni-app 原生入参，不能透传给 `uni.request`（其余字段原样下发）
    const { requestId, ...uniOptions } = options
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
    // 幂等键：**调用方显式传入才发送**；未传则一个字节都不发（不自动生成，保持"不传=无幂等"的语义）
    if (requestId) {
      header['X-Request-Id'] = requestId
    }

    uni.request({
      ...uniOptions,
      // 丢弃 undefined 参数，避免被拼成字面量 `undefined` 发给后端（见 omitUndefinedData 注释）
      data: omitUndefinedData(options.data),
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

/**
 * 对外请求入口。公开浏览接口只有在旧 Token 失效时才会无 Token 重试一次。
 * `options.requestId` 为可选的幂等键（请求头 `X-Request-Id`，见 `utils/request-id.ts`）：
 * 游客重试会**沿用同一个 id**（同一次业务动作的重试本就应该幂等）。
 */
export function request<T = unknown>(options: RequestOptions): Promise<T> {
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

/**
 * 下载后端文件（如结算单 CSV 导出），返回**微信临时文件路径**供 `uni.openDocument` / `uni.saveFile` 使用。
 *
 * ⚠️ 为什么必须有它（而不是在页面里直接 `uni.downloadFile`）：
 * `API_BASE_URL` 与 `APP_KEY` 都是**本模块私有**（未导出），而导出类接口**需要鉴权头**
 * （`Authorization` + `X-App-Key`）⇒ 在页面里手拼 URL/头必然漏掉鉴权，表现为 401 或下到一份错误页。
 *
 * ⚠️ 与 `request()` 的区别：这里**不解析响应体**（不是 JSON，是文件流），
 * 只在 HTTP 状态码非 2xx 时按常见情况给出可读提示。
 */
export function downloadFile(url: string): Promise<{ tempFilePath: string }> {
  return new Promise((resolve, reject) => {
    if (!API_BASE_URL) {
      reject(new ApiRequestError('未配置 VITE_API_BASE_URL，请检查 mini_shop 工程目录环境文件'))
      return
    }
    const token = uni.getStorageSync('mini_shop_token')
    const header: Record<string, string> = { 'X-App-Key': APP_KEY }
    if (token) header.Authorization = `Bearer ${token}`
    // ⚠️ 这里**刻意不写 `UniApp.DownloadFileOption` 之类的类型标注**：
    //    mini_shop 是 HBuilderX-only、**没有 node_modules / 没有 TS 类型检查**，
    //    引用可能不存在的全局类型反而会让编译报错（同 `utils/image-compress.ts` 的教训）。
    uni.downloadFile({
      url: `${API_BASE_URL}${url}`,
      header,
      success: (response: { statusCode: number; tempFilePath?: string }) => {
        if (response.statusCode === 401) {
          reject(new ApiRequestError('登录状态已失效，请重新登录后再试'))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new ApiRequestError(`下载失败（HTTP ${response.statusCode}）`))
          return
        }
        if (!response.tempFilePath) {
          reject(new ApiRequestError('下载成功但未返回文件'))
          return
        }
        resolve({ tempFilePath: response.tempFilePath })
      },
      fail: (error: { errMsg?: string }) => {
        reject(new ApiRequestError(error.errMsg || '下载失败'))
      },
    })
  })
}

/**
 * 把后端下发的 OSS Key / 相对路径拼成可访问图片 URL（图片代理三级缓存）。
 * 已是完整 http(s) 地址则原样返回。
 */
export function resolveImageUrl(objectKey: string): string {
  const key = String(objectKey || '').trim()
  if (!key) return ''
  if (/^https?:\/\//.test(key)) return key
  return `${API_BASE_URL}/api/image/${key.replace(/^\/+/, '')}`
}
