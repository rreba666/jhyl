export type CategoryStatus = 0 | 1

/**
 * 后台分类列表数据（对齐 `AdminCategoryListVO`）。
 *
 * ⚠️ **2026-09-30 扁平化**：后端已确认「分类是**扁平一层**、**实测无 `parent_id`**」
 *    （《前端统一报告-2026-09-30》§五-8 明确要求前端去掉树形/父级假设）。
 *    ⇒ 已删除原先臆造的 `parentId` 与 `children` 字段。
 *    ⚠️ 它们此前是**填了也不生效**的假字段：后端既不返回、也不接收
 *    （契约 `AdminCategorySaveDTO` 只有 name / icon / sortOrder / enabled）
 *    ⇒ 后台那个「父级 ID」列与「父级分类」下拉**一直在误导运营**。
 */
export interface AdminCategory {
  id: string
  name: string
  icon: string
  sortOrder: number
  enabled: CategoryStatus
}

/** 后台分类新增和修改请求（对齐后端 `AdminCategorySaveDTO`：只有这 4 个字段）。 */
export interface AdminCategorySaveDTO {
  name: string
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
