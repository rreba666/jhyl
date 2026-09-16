export type CategoryStatus = 0 | 1

/** 后台分类列表数据。字段与 AdminCategoryListVO 对齐。 */
export interface AdminCategory {
  id: string
  parentId: string
  name: string
  icon: string
  sortOrder: number
  enabled: CategoryStatus
  children?: AdminCategory[]
}

/** 后台分类新增和修改请求。enabled 对齐后端 AdminCategorySaveDTO 字段名。 */
export interface AdminCategorySaveDTO {
  name: string
  parentId: string
  icon: string
  sortOrder: number
  enabled: CategoryStatus
}

export interface CategoryResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
