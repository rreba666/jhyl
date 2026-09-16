import { getSession } from '@/utils/auth'
import type { StaffResponse } from '@/types/staff'

/** 后端地址，去掉尾部斜杠。 */
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
/** 品牌标识（X-App-Key）：读 VITE_APP_KEY，小写 trim；未配置时默认 jinhua（与后端默认品牌一致）。 */
const APP_KEY = String(import.meta.env.VITE_APP_KEY || 'jinhua').trim().toLowerCase()

/** 携带后端错误码的异常对象。 */
export interface RequestError extends Error {
  code?: number
}

/**
 * 统一请求封装：拼接 baseURL、自动注入 Bearer Token 与品牌标识、解析统一响应。
 * code !== 0（或 success === false、HTTP 非 2xx）时抛出带 message 的错误。
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Key': APP_KEY,
    ...(options.headers as Record<string, string> | undefined),
  }
  if (session?.token) headers.Authorization = `Bearer ${session.token}`

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })

  let body: StaffResponse<T> | null = null
  try {
    body = (await response.json()) as StaffResponse<T>
  } catch {
    /* 响应非 JSON 时按 HTTP 状态处理 */
  }

  const ok = response.ok && body != null && (body.code === 0 || body.code === 200) && body.success !== false
  if (!ok) {
    const error = new Error(body?.message || `请求失败（${response.status}）`) as RequestError
    error.code = body?.code ?? response.status
    throw error
  }
  // 走到这里 body 必非空（ok 已校验），显式断言以满足严格模式收窄。
  return (body as StaffResponse<T>).data as T
}

/** 发送 JSON POST 请求。 */
export function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: data == null ? undefined : JSON.stringify(data) })
}
