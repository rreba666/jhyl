/**
 * 系统配置管理（平台级可调参数）类型定义。
 *
 * 依据：`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §2；
 *       接口权威：仓库根 `api_doc.json` 的 `/api/admin/sys-config/list`、`/api/admin/sys-config/{key}`。
 *
 * ## ⚠️⚠️ 这个接口的 schema 是**空的**（`List<Map<String,Object>>`）—— 字段名没有契约
 * `api_doc.json` 里两个端点的出参都是 `Map<String,Object>`（`additionalProperties` 为空），
 * 文档只给了**语义**（key / 类型 / 最小值 / 最大值 / 默认值 / 当前值 / 说明 / 是否可写），
 * **没有给字段名**。本项目已因"靠文档措辞推断字段名"踩过 P0（同城配送 `failCode` / `quoteFailCode`），
 * ⇒ 这里的对策是：
 * 1. **多别名兜底读取**（camelCase / snake_case 都认，大小写与下划线不敏感）；
 * 2. **原始对象整份保留**在 {@link SysConfigItem.raw}，页面上以「原始数据」折叠区原样展示
 *    —— 字段名一旦与预期不符，运营/开发能当场看到后端真正下发了什么，而不是看着空白猜；
 * 3. **读不到就显示"未知/—"并禁止编辑**，绝不替后端编一个值（本项目硬原则：不伪造数据）。
 */

/** 后端统一响应外壳（与其它模块同形：`code` / `message` / `data` / `success`）。 */
export interface SysConfigResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
  traceId?: string
  errorId?: string
}

/**
 * 写接口的请求体（对应 `api_doc.json` 的 `UpdateBody`）。
 *
 * ⚠️ `value` 是**字符串**（数字按 key 的类型给，如 `"3.00"`）—— 不要为了好看把它转成 number：
 * `0.10` 一旦变成 number 再序列化就可能变成 `0.1`，后端按类型校验时会不一致。
 * ⚠️ `remark` 在 DTO 里是**可选**的（后端只标注"建议填写，便于审计"），
 * 所以这里也保持可选 —— 页面上"要求填写"是**前端交互**，不是伪造默认值：
 * 用户不填就是 `null`，绝不替它编一句"系统自动修改"之类的假备注。
 */
export interface SysConfigUpdate {
  value: string
  remark?: string | null
}

/**
 * 单个配置项（前端归一化后的形状）。
 *
 * 归一化只做**取字段**这一件事：值一律**按字符串原样保留**，不做单位换算
 * （例如 `withdraw_fee_rate` 后端给的是小数 `0.05`，前端**不得**自作主张显示成 `5%`，
 * 否则运营照着页面填 `5` 就会把费率写成 500%）。
 */
export interface SysConfigItem {
  /** 配置键（也是 PUT 的路径参数）；未识别出时为**空串**。 */
  key: string
  /** 是否从后端对象里识别出了 `key`（false ⇒ 该行只读展示 + 明确提示，**不允许提交**）。 */
  keyRecognized: boolean
  /** 值类型原文（后端下发什么就显示什么，前端不翻译成自己的枚举）。 */
  type: string
  /** 下限；后端没给就是 `null`（⇒ 不给数字控件、不猜一个范围）。 */
  min: number | null
  /** 上限；同 `min`。 */
  max: number | null
  /** 默认值原文（用于对照"当前值是改过的还是默认的"）。 */
  defaultValue: string | null
  /** 当前值原文。 */
  value: string | null
  /** 说明（后端给的运营提示）。 */
  description: string
  /** **后端**给的可写标记（⚠️ 与"当前登录角色可写"是两件事，两者都要满足才能编辑）。 */
  writable: boolean
  /** 该行的**原始对象**（原样保留：字段名不符预期时，页面上仍能看到真实数据）。 */
  raw: Record<string, unknown>
}

/** 配置项列表原始返回类型（每项字段名未知 ⇒ 用 `Record` 接住，再由前端归一化）。 */
export type SysConfigRawList = Array<Record<string, unknown>>
