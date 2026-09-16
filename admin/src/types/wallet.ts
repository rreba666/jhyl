import type { PaginationResult } from './common'

export interface WalletRecord {
  id: string
  userId: string
  balance: number
  version: number
  createTime: string
  updateTime: string
}

export interface WalletBalanceSaveDTO {
  balance: number
}

export interface WalletPageResult extends PaginationResult<WalletRecord> {
  page: number
  pageSize: number
}

export interface WalletResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
