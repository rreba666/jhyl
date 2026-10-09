/**
 * 红包追回失败（中控运维工作台）类型定义。
 *
 * 依据：`docs/26/10.09/前端对接说明-入驻申请让利比例与商家自改-2026-10-09.md` §五；
 *       `docs/26/10.09/前端总对接文档-2026-10-09.md` §八；
 *       接口权威：仓库根 `api_doc.json` 的
 *         `GET  /api/admin/dividend-clawback/list?status=&page=&size=`
 *         `POST /api/admin/dividend-clawback/{id}/handled?remark=`
 *
 * > 术语：英文标识符保持 `dividend*`（与后端一致），**用户可见文案与注释统一写「红包」**
 * > （本项目口径：界面不出现旧业务词，见 `CLAUDE.md` §七）。
 *
 * ## ⚠️⚠️ 这个接口的 200 schema 是 `ResultListMapStringObject` —— 字段名**没有契约**
 *
 * `api_doc.json`（dev 口径，paths 521）里 `list` 的 `data` 是 `array<object>`，
 * `additionalProperties` **为空** ⇒ 既没有字段明细、也没有命名 VO。
 * 文档（§五 / §八）只给了**语义清单**：`id / orderNo / orderId / error / status /
 * handleBy / handleTime / remark / createTime`。
 *
 * 本项目已因「靠文档措辞推断字段名」踩过 P0（同城配送 `failCode`），
 * ⚠️ 而 2026-10-09 用 dev 超管账号实测该接口时 **`data` 是空数组**（表里暂无失败记录）
 * ⇒ **字段名至今未被任何真实行验证过**。所以这里的对策是：
 * 1. **多别名 + 大小写/下划线不敏感**读取（`handle_by` 与 `handleBy` 视为同一个名字）；
 * 2. **原始对象整份保留**在 {@link DividendClawbackRow.raw}，页面「原始数据」折叠区原样展示
 *    —— 字段名一旦与预期不符，运营/开发能当场看到后端真正下发了什么，而不是看着空白猜；
 * 3. **读不到就显示「未识别」并禁止提交**（`idRecognized === false` ⇒ 不给「标记已处理」入口），
 *    绝不替后端编一个值（本项目硬原则：不伪造数据）；
 * 4. 页面**不按字段名做任何"猜"的分支**：值缺失 ⇒ 显示「—」，状态不是 0/1 ⇒ 显示原值 + 「未知状态」。
 */

/** 后端统一响应外壳（与其它模块同形：`code` / `message` / `data` / `success`）。 */
export interface DividendClawbackResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
  traceId?: string
  errorId?: string
}

/**
 * `list` 的原始返回：**每项字段名未知** ⇒ 用 `Record` 接住，再由前端归一化。
 * ⚠️ 无 `total`、无 `pages` —— 这就是"分页信息缺失"的根源（见页面的翻页处理）。
 */
export type DividendClawbackRawList = Array<Record<string, unknown>>

/**
 * 记录状态（后端只有这两个值）。
 * ⚠️ 类型只是"期望值"：真实响应里若出现别的值，页面显示**原值**并标「未知状态」，
 * 而不是把它归到 0/1 里（那会伪造"未处理/已处理"的结论）。
 */
export type DividendClawbackStatus = 0 | 1

/** `list` 查询参数（`status` 不传 = 全部；`page` 从 1 开始；`size` ≤ 100）。 */
export interface DividendClawbackQuery {
  /** 0 = 未处理 / 1 = 已处理；**不传 = 全部**（⚠️ 不要用 0 表示"全部"）。 */
  status?: DividendClawbackStatus
  /** 页码，从 1 开始。 */
  page?: number
  /** 每页条数，最大 100（后端超限按上限截断，前端也限幅）。 */
  size?: number
}

/** 单条失败记录（前端归一化后的形状）。 */
export interface DividendClawbackRow {
  /** 记录 ID（也是 `POST /{id}/handled` 的路径参数）；未识别出时为 `null`。 */
  id: number | null
  /**
   * 是否从后端对象里识别出了 `id`。
   * `false` ⇒ 该行**禁止**提交处理（没有 id 就无从标记，猜一个 id 可能改到别的记录）。
   */
  idRecognized: boolean
  /** 订单号。 */
  orderNo: string | null
  /** 订单 ID。 */
  orderId: number | null
  /** 追回失败的原因/错误信息（后端落库的原文）。 */
  error: string | null
  /** 状态原值：0 = 未处理 / 1 = 已处理；非 0/1 或缺失时保留原值（页面显示「未知状态」）。 */
  status: number | null
  /**
   * 处理人。
   * ⚠️ 文档只写「处理人」，**没写是管理员 ID 还是姓名**（schema 为空）⇒ 这里按原值字符串保留，
   * 页面原样展示，不做"ID → 姓名"的猜测。
   */
  handleBy: string | null
  /** 处理时间。 */
  handleTime: string | null
  /** 处理备注（人工填写的说明；未处理时为 `null`）。 */
  remark: string | null
  /** 记录产生时间。 */
  createTime: string | null
  /** 该行的**原始对象**（原样保留：字段名不符预期时，页面上仍能看到真实数据）。 */
  raw: Record<string, unknown>
}
