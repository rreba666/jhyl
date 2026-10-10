/**
 * 骑手端「送达门禁」状态：**拍照留存** 或 **联系客户**，二选一即可确认送达。
 *
 * ## 为什么两条腿都是「前端本地状态」（2026-10-10 复核契约后的结论）
 *
 * 后端**没有**送达前的凭证落地点，所以「先拍照才能送达」这条腿**只能在前端拦**：
 * - `POST /api/delivery/tasks/{taskId}/delivered` 的请求体是 `DeliveredBody`，字段只有
 *   `pickupCodeVerified`(deprecated) / `latitude` / `longitude` / `accuracy` / `locationText` /
 *   `requestId` —— **没有任何照片/凭证字段**（`api_doc.json` 与线上 `/v3/api-docs` 一致）；
 * - `POST /api/delivery/tasks/{taskId}/proof` 摘要：「上传送达凭证（照片必传/后补 24h）」——
 *   只能在 `delivered` 之后提交，早传报 `13003 仅送达后可上传凭证`。
 * ⇒ **骑手绕过前端（直接调接口 / 清本地缓存）即可规避这道门禁**。让后端真正强制，
 *   需要「送达前可落地凭证」或「订单级送达前留痕标记」，属**后端需求**，不是已生效的服务端校验。
 *
 * ## 每条腿到底证明了什么（不要夸大）
 * - **照片腿**：必须**图片上传成功拿到 `objectKey`**才算数（即 `/api/common/upload` 成功）；
 *   只是打开相机、或上传失败，都**不**算（绝不伪造"拍过了"）。
 * - **联系腿**：只能证明**拨号面板被拉起过**（`uni.makePhoneCall` 的 success 回调）——
 *   小程序读不到通话记录，**无法证明通话真的发生**，更无法证明对方接听。
 *   若走本页拨号，后端 `GET /api/delivery/tasks/{taskId}/contact` 会留一条**取号日志**（谁/何时/IP，
 *   与 60s 限流），但那只证明「取过号」，**不等于打了电话**。
 *
 * ## 持久化口径
 * 键按 **taskId** 分（`rider-deliver-gate:{taskId}`），存 `uni.setStorageSync` ——
 * 骑手拍完照/打完电话**离开页面再回来（含小程序重启）不会被要求重做**；
 * 而**上传没成功**的照片不会写进来，所以「照片没传上去」时依然会被拦（fail-closed）。
 * ⚠️ 存储写入失败时返回值仍按本次会话生效（照片确实传上去了/拨号确实拉起了），
 * 但**重新进入页面后会丢** —— 宁可让骑手重做一次，也不谎报"已留存"。
 */
import { PROOF_MAX_COUNT } from '@/utils/delivery-proof'

/** 送达门禁的本地状态。 */
export interface DeliveryGateState {
  /** 已上传成功、**待送达后 attach 到 `/proof`** 的 OSS Key（送达前留存的那批）。 */
  photoKeys: string[]
  /** 最近一次照片留存成功的时间（ms）。 */
  photoAt?: number
  /** 最近一次「联系客户」拨号面板被拉起的时间（ms）。 */
  contactAt?: number
}

/** 本地缓存的键前缀（按任务分，避免跨单串味）。 */
const STORAGE_PREFIX = 'rider-deliver-gate:'

/**
 * 一次任务最多留存几张（3 次采集 × `PROOF_MAX_COUNT`）。
 * 只防本地存储无限增长，不参与业务判定。
 */
const MAX_PENDING_KEYS = PROOF_MAX_COUNT * 3

function storageKey(taskId: number | string): string {
  return `${STORAGE_PREFIX}${String(taskId)}`
}

/** 把任意输入收敛成合法状态（读不出/字段坏了都当作"什么都没做过"）。 */
function normalize(raw: unknown): DeliveryGateState {
  const empty: DeliveryGateState = { photoKeys: [] }
  if (!raw) return empty
  let value: Record<string, unknown> | null = null
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return empty
    }
  } else if (typeof raw === 'object') {
    value = raw as Record<string, unknown>
  }
  if (!value) return empty
  const keys = Array.isArray(value.photoKeys)
    ? (value.photoKeys as unknown[]).map((key) => String(key || '')).filter(Boolean)
    : []
  const photoAt = Number(value.photoAt)
  const contactAt = Number(value.contactAt)
  return {
    photoKeys: keys,
    photoAt: Number.isFinite(photoAt) && photoAt > 0 ? photoAt : undefined,
    contactAt: Number.isFinite(contactAt) && contactAt > 0 ? contactAt : undefined,
  }
}

/**
 * 读门禁状态。**读不到/解析失败一律当成"未满足"**（fail-closed：宁可让骑手重做，
 * 也不因为读缓存失败而放行）。
 */
export function readDeliveryGate(taskId: number | string): DeliveryGateState {
  if (taskId === '' || taskId == null) return { photoKeys: [] }
  try {
    return normalize(uni.getStorageSync(storageKey(taskId)))
  } catch {
    return { photoKeys: [] }
  }
}

/** 写门禁状态（增量合并）；返回合并后的状态供页面直接使用。 */
export function writeDeliveryGate(taskId: number | string, patch: Partial<DeliveryGateState>): DeliveryGateState {
  const next: DeliveryGateState = { ...readDeliveryGate(taskId), ...patch }
  try {
    uni.setStorageSync(storageKey(taskId), JSON.stringify(next))
  } catch {
    // 存储不可用（配额/隐私限制）时不影响本次会话，重新进页面会被要求重做
  }
  return next
}

/** 记一笔「照片已留存」（只接受**上传成功**的 objectKey；空列表不记）。 */
export function markProofCaptured(taskId: number | string, objectKeys: string[]): DeliveryGateState {
  const keys = (objectKeys || []).map((key) => String(key || '')).filter(Boolean)
  if (!keys.length) return readDeliveryGate(taskId)
  const current = readDeliveryGate(taskId)
  const merged = [...current.photoKeys]
  for (const key of keys) {
    if (!merged.includes(key)) merged.push(key)
  }
  return writeDeliveryGate(taskId, {
    photoKeys: merged.slice(0, MAX_PENDING_KEYS),
    photoAt: Date.now(),
  })
}

/** 记一笔「已联系客户」（**只在拨号面板真的被拉起后**调用）。 */
export function markCustomerContacted(taskId: number | string): DeliveryGateState {
  return writeDeliveryGate(taskId, { contactAt: Date.now() })
}

/** 清掉待提交的照片 Key（送达后 attach 成功时调用；联系腿的标记保留）。 */
export function clearPendingProofKeys(taskId: number | string): DeliveryGateState {
  return writeDeliveryGate(taskId, { photoKeys: [] })
}

/** 照片腿是否满足：**至少一张照片上传成功**（拿到 objectKey）。 */
export function hasProofPhotoLeg(state: DeliveryGateState): boolean {
  return Boolean(state.photoKeys && state.photoKeys.length)
}

/** 联系腿是否满足：拨号面板被拉起过（**不代表通话发生**，见文件头注释）。 */
export function hasContactedLeg(state: DeliveryGateState): boolean {
  const at = Number(state.contactAt)
  return Number.isFinite(at) && at > 0
}

/** 门禁是否放行（两条腿**任一**满足即可确认送达）。 */
export function isDeliveryGateOpen(state: DeliveryGateState): boolean {
  return hasProofPhotoLeg(state) || hasContactedLeg(state)
}
