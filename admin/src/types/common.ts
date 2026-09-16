export interface ApiResponse<T> {
  code: number
  data: T
  message: string
  success?: boolean
}

export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginationResult<T> {
  list: T[]
  total: number
}
