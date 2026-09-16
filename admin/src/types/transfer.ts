import type { PaginationResult } from './common'

export interface TransferRecord {
  id: string
  transferNo: string
  fromUserId: string
  fromNickname: string
  toUserId: string
  toNickname: string
  amount: number
  createTime: string
}

export interface TransferPageResult extends PaginationResult<TransferRecord> {
  page: number
  pageSize: number
}

export interface TransferResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
