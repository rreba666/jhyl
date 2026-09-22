import { request } from '@/utils/request'
// 草稿缓存 key 只有确认订单页在用，统一从 api/order.ts 取，避免两个文件各写一份字面量而失步
import { ADDRESS_DRAFT_KEY } from '@/api/order'

/**
 * 收货地址簿（C 端）接口层。
 *
 * 后端接口（`api_doc.json` tag「收货地址簿」，controller `UserAddressController`）：
 * - GET    /api/user/address/list       地址列表（默认地址在前）
 * - POST   /api/user/address            新增（第一个地址后端自动设为默认）
 * - PUT    /api/user/address/{id}       修改
 * - DELETE /api/user/address/{id}       删除（软删，仅本人）
 * - PUT    /api/user/address/{id}/default  设为默认（取消该用户其它默认）
 */

/**
 * 选中地址广播事件名：地址列表页（`subpkg-order/address/list.vue`）在 `mode=select` 下
 * 点某条地址时广播，供确认订单页的地址编辑页回填表单。
 * 放在接口层而不是页面文件里，避免页面之间互相 import 造成循环依赖。
 */
export const ADDRESS_SELECTED_EVENT = 'address:selected'

/**
 * 返回上一页完成后广播的事件名：`navigateBack` 的 `complete` 回调里触发。
 * 与「选中」事件分开是为了避免提示 toast 在返回动画结束前就被页面切换吞掉。
 */
export const ADDRESS_SELECTED_DONE_EVENT = 'address:selected-ack'

/** 重新导出草稿缓存 key，页面统一从接口层引入（值仍是 `api/order.ts` 里的那一个）。 */
export { ADDRESS_DRAFT_KEY }

/** 地址实体（对应后端 `UserAddressEntity`）。 */
export interface AddressEntity {
  /** 地址 ID（int64）。 */
  id: number
  /** 归属用户 ID（前端不展示）。 */
  userId?: number
  /** 收货人姓名。 */
  receiverName: string
  /** 收货人手机号。 */
  receiverPhone: string
  /** 省。 */
  province?: string
  /** 市。 */
  city?: string
  /** 区/县。 */
  district?: string
  /** 详细地址（街道、门牌号）。 */
  detail: string
  /** 是否默认地址：1=默认，0=非默认。 */
  isDefault?: number
  /** 创建时间。 */
  createTime?: string
  /** 更新时间。 */
  updateTime?: string
}

/** 新增 / 修改地址入参（对应后端 `SaveDTO`，receiverName/receiverPhone/detail 必填）。 */
export interface AddressSaveDTO {
  receiverName: string
  receiverPhone: string
  province?: string
  city?: string
  district?: string
  detail: string
  /** 1 = 设为默认（后端会取消其它默认）。 */
  isDefault?: number
}

/** 查询当前用户地址簿（默认地址在前）。 */
export function getAddressList(): Promise<AddressEntity[]> {
  return request<AddressEntity[]>({ url: '/api/user/address/list', method: 'GET' })
}

/** 新增地址；返回后端落库后的地址实体。 */
export function addAddress(data: AddressSaveDTO): Promise<AddressEntity> {
  return request<AddressEntity>({ url: '/api/user/address', method: 'POST', data })
}

/** 修改指定地址。 */
export function updateAddress(id: number, data: AddressSaveDTO): Promise<void> {
  return request<void>({ url: `/api/user/address/${encodeURIComponent(String(id))}`, method: 'PUT', data })
}

/** 删除指定地址（后端软删，仅允许删本人地址）。 */
export function removeAddress(id: number): Promise<void> {
  return request<void>({ url: `/api/user/address/${encodeURIComponent(String(id))}`, method: 'DELETE' })
}

/** 把指定地址设为默认（后端会同时取消其它默认）。 */
export function setDefaultAddress(id: number): Promise<void> {
  return request<void>({ url: `/api/user/address/${encodeURIComponent(String(id))}/default`, method: 'PUT' })
}

/**
 * 拼接完整地址文案（省市区 + 详细地址），用于列表展示与回填。
 * 后端省市区可能为空串（用户没选地区），此时只返回详细地址，不留下多余空格。
 */
export function formatAddressText(address: Pick<AddressEntity, 'province' | 'city' | 'district' | 'detail'>): string {
  const region = [address.province, address.city, address.district].filter((part) => !!part && String(part).trim())
  return [...region, address.detail].filter((part) => !!part && String(part).trim()).join(' ')
}
