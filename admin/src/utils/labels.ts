/**
 * 跨模块的枚举中文映射（配送域之外的那些）。
 * 配送相关（订单配送状态 / 配送任务状态 / 指派方式 / 配送事件 / 计费方式 / 退款单）在 `deliveryStatus.ts`。
 *
 * ⚠️ 约定：**未知枚举一律原样回显**（不显示"未知"），方便发现后端新增状态；若某个枚举长期显示英文，
 * 说明后端还没有中文口径 —— 请登记到《后端需求汇总》里让后端补 description/enum。
 */

/**
 * 操作方类型（审计日志 / 配送事件的 `operatorType`）。
 * 平台级留痕（留痕台账）会下发 `SUPER_ADMIN` / `MERCHANT` / `DELIVERY_PERSON` / `PLATFORM`，一并收录。
 */
export const OPERATOR_TYPE_LABELS: Record<string, string> = {
  STAFF: '店员',
  ADMIN: '管理员',
  SUPER_ADMIN: '超级管理员',
  MERCHANT: '商家',
  MERCHANT_PC: '商家 PC',
  USER: '用户',
  DELIVERY_PERSON: '配送员',
  PLATFORM: '平台/系统代理',
  SYSTEM: '系统',
  SELF: '本人',
}

/** 操作方类型 → 中文；未知原样回显。 */
export function operatorTypeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return OPERATOR_TYPE_LABELS[key] || key
}

/**
 * 操作追溯的操作码（`AuditLogVO.operation`）。
 * 依据 OpenAPI 描述里的示例枚举 + 实际常见值；未收录的原样回显。
 */
export const AUDIT_OPERATION_LABELS: Record<string, string> = {
  LOGIN: '登录',
  LOGOUT: '退出登录',
  VERIFY: '核销',
  CREATE_STAFF: '新增人员',
  EDIT_STAFF: '编辑人员',
  DISABLE_STAFF: '禁用人员',
  RESET_PASSWORD: '重置密码',
  ISSUE_ACCOUNT: '发号',
  CHANGE_IDENTITY: '修改身份',
  BIND_WECHAT: '绑定微信',
  UNBIND_WECHAT: '解绑微信',
  ACCEPT_ORDER: '接单',
  REJECT_ORDER: '拒单',
  PREPARE_ORDER: '开始备货',
  READY_ORDER: '备货完成',
  CREATE_TASK: '创建配送任务',
  REASSIGN_TASK: '改派骑手',
  ROLLBACK_TASK: '回退任务节点',
  UNLOCK_PICKUP_CODE: '解锁收货码',
  CANCEL_TASK: '取消配送任务',
  PAUSE_TASK: '暂停配送任务',
  RESUME_TASK: '恢复配送任务',
  AUDIT_ADDRESS: '审核地址变更',
  AUDIT_CANCEL: '审核取消申请',
  WITHDRAW_APPROVE: '提现审核通过',
  WITHDRAW_REJECT: '提现审核驳回',
  MERCHANT_AUDIT: '商户入驻审核',
  EXPORT: '导出',
}

/** 操作码 → 中文；未知原样回显。 */
export function auditOperationLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return AUDIT_OPERATION_LABELS[key] || key
}

/**
 * 操作目标类型（`AuditLogVO.targetType` / 留痕台账 `AuditRecordView.targetType`）。
 * 留痕的 12 种实测目标类型（`PRODUCT_SKU`/`WAYBILL`/`SCHEMA`/`FINANCE_FLOW`…）已一并收录。
 */
export const AUDIT_TARGET_TYPE_LABELS: Record<string, string> = {
  ORDER: '订单',
  STAFF: '人员',
  ADMIN: '管理员',
  SHOP: '门店',
  PRODUCT: '商品',
  PRODUCT_SKU: '商品 SKU',
  USER: '用户',
  COUPON: '优惠券',
  MERCHANT: '商户',
  MERCHANT_APPLY: '商户入驻申请',
  WITHDRAW: '提现',
  AFTER_SALE: '售后',
  DELIVERY_TASK: '配送任务',
  WAYBILL: '运单',
  SCHEMA: '数据库迁移',
  FINANCE_FLOW: '资金流水',
  SYSTEM: '系统',
  EXPORT: '导出',
}

/** 目标类型 → 中文；未知原样回显。 */
export function auditTargetTypeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return AUDIT_TARGET_TYPE_LABELS[key] || key
}

/** 门店营业「手动模式」（`manualMode`）。 */
export const MANUAL_MODE_LABELS: Record<string, string> = {
  OPEN: '手动营业',
  REST: '手动休息',
  AUTO: '按规则自动',
}

/** 手动模式 → 中文；未知原样回显。 */
export function manualModeLabel(value?: string | null): string {
  const key = String(value ?? '').trim()
  if (!key) return '—'
  return MANUAL_MODE_LABELS[key] || key
}
