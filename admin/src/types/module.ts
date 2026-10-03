/**
 * 功能模块开关（V2 模块配置）类型定义。
 *
 * 契约来源：`api_doc.json`
 *  - `ModuleConfigEntity`  —— `GET /api/admin/v2/modules` 出参
 *  - `ModuleConfigSaveDTO` —— `PUT /api/admin/v2/modules/{key}` 入参
 *
 * ⚠️⚠️ **读写字段名不一致，这是本模块最容易踩的坑**：
 *  - **读**（Entity）：`moduleKey` / `moduleName` / `enabled` / `sortOrder` / `pathPatterns`
 *  - **写**（SaveDTO）：`name` / `enabled` / `sort`
 *  ⇒ 把「读」的字段名（`moduleName` / `sortOrder`）拿去「写」，后端会当成未知字段
 *    **静默忽略**（HTTP 200、不报错，但值没改），排查起来极其费时。
 */

/** 模块配置（管理端出参，含停用项）。 */
export interface ModuleConfigEntity {
  id?: number
  /** 模块标识（小程序端按它匹配，如 `delivery` / `pickup` / `merchant`）。 */
  moduleKey: string
  /** 模块名称（后台展示用）。 */
  moduleName: string
  /** 0=停用 / 1=启用。 */
  enabled: 0 | 1
  /** 排序权重，越小越靠前。 */
  sortOrder: number
  /**
   * ⚠️ 该模块**拦截的后端接口路径**（逗号分隔，Ant 风格通配）。
   * 停用模块 ≠ 只隐藏前端入口 —— 后端 `RoleGuardInterceptor` 会按这些 pattern **拦请求**。
   * 例：`delivery` = `/api/delivery/**,/api/merchant/**,/api/merchant/delivery/**`
   * ⇒ 误关 `delivery` 会把**商家端接口**一起打死。页面必须把它显示出来并给警告。
   */
  pathPatterns?: string
  /** 备注（后端可选字段）。 */
  remark?: string
  createTime?: string
  updateTime?: string
}

/**
 * 模块配置保存入参。
 * ⚠️ 字段名与 `ModuleConfigEntity` **不同**（写 `name`/`sort`，读 `moduleName`/`sortOrder`）。
 */
export interface ModuleConfigSaveDTO {
  /** 模块名称。 */
  name?: string
  /** 0=停用 / 1=启用（`basic` 为必买模块，不可停用）。 */
  enabled?: 0 | 1
  /** 排序权重，越小越靠前。 */
  sort?: number
}

/** 统一响应包装（与项目其它 api 模块同构）。 */
export interface ModuleResponse<T> {
  code: number
  message?: string
  data?: T
  success?: boolean
  traceId?: string
}
