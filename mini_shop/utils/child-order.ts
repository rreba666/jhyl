/**
 * 跨商拆单（P3）的**子订单**通用工具：判定、状态文案、让用户选子单。
 *
 * ## 为什么要有这个文件
 * 订单**详情页**与**订单列表页**都要遵守 P3 §2.3：「售后/秒退**只能对子单**申请，
 * 对**父单**会被后端拒（`code=1000`）」⇒ 两页都需要「判定有没有子单 + 弹窗让用户选一个」。
 * 这段逻辑与业务无关（纯判空 + ActionSheet）⇒ 抽出来共用，避免两页各写一份（先例见 `after-sale-submit.ts`）。
 *
 * ## ✅ 后端契约缺口已修复（2026-10-03）
 * 此前 `ChildOrderVO` **只有 `orderNo`、没有 `id`** ⇒ 前端拿不到子单 ID 就无法提交售后。
 * 后端已在 jar `870f9d98…` 补齐 `id`（**数字类型**，见 `api/order.ts`）⇒
 * 本文件的「无 `id` 则不给选」分支**保留为防御性兜底**（万一后端回滚或数据异常），
 * 正常情况下**不会**触发。
 */
import type { ChildOrderVO } from '@/api/order'

/** 是否**有子订单**（= 这是跨商拆单的**父单**）。⚠️ `children` 可能为 `null`（子单自身 / 单商订单）。 */
export function hasChildOrders(children: ChildOrderVO[] | null | undefined): boolean {
  return Array.isArray(children) && children.length > 0
}

/**
 * 子单状态 → 中文。
 *
 * ⚠️ 为什么不复用父单的 `statusDesc`：`ChildOrderVO` **只有数字 `status`、没有 `statusDesc`**
 * （见 `api/order.ts`），后端不下发子单状态文案 ⇒ 前端必须自己映射。
 * 码值来自 `api_doc.json` 的 `ChildOrderVO.status` 注释，与父单状态码同表。
 */
export function childStatusText(status?: number | null): string {
  const map: Record<number, string> = {
    0: '待支付',
    1: '已支付',
    2: '已发货',
    3: '已收货',
    4: '已完成',
    5: '已关闭',
    6: '退款中',
    7: '已退款',
    8: '已核销',
  }
  return map[Number(status)] || '—'
}

/** 子单在 ActionSheet 里的展示文案（带子单号与应付金额，便于用户区分）。 */
export function childOrderOptionText(child: ChildOrderVO): string {
  return `${child.orderNo}　应付 ¥${Number(child.payAmount || 0).toFixed(2)}`
}

/**
 * 让用户从 `children[]` 里**选一个子订单**。
 *
 * @param children 订单详情里的 `children`（列表页需先自行拉详情获取）
 * @param actionLabel 动作名（ActionSheet 标题用，如「申请售后」）
 * @returns 选中的子单；用户取消 / 无处可选时返回 `null`
 */
export function pickChildOrder(
  children: ChildOrderVO[] | null | undefined,
  actionLabel: string,
): Promise<ChildOrderVO | null> {
  const list = Array.isArray(children) ? children : []
  // ✅ 后端已补齐 `id`（2026-10-03）⇒ 正常情况下 `selectable` 就是全量；
  //    这里的过滤是**防御性兜底**（万一后端回滚或某条数据异常），保留不删。
  const selectable = list.filter((child) => child.id != null)
  if (!selectable.length) {
    if (list.length) {
      uni.showToast({ title: '暂不支持按子订单提交，请联系客服处理', icon: 'none', duration: 3000 })
    }
    return Promise.resolve(null)
  }
  return new Promise<ChildOrderVO | null>((resolve) => {
    uni.showActionSheet({
      title: `请选择要${actionLabel}的子订单`,
      itemList: selectable.map((child) => childOrderOptionText(child)),
      success: (res: { tapIndex: number }) => resolve(selectable[res.tapIndex] || null),
      fail: () => resolve(null),
    })
  })
}

/**
 * 解析「本次退款/售后要作用在哪个订单上」——**三个入口统一走它**
 * （秒退 / 用户自助退款 / 售后申请都要遵守 P3 §2.3）。
 *
 * @param fallbackOrderId 非父单（无子单）时使用的订单自身 ID
 * @param children 订单详情里的 `children`
 * @param actionLabel 动作名
 * @returns 目标订单 ID；用户取消或无法操作时返回 `null`（调用方直接 return）
 */
export async function resolveTargetOrderId(
  fallbackOrderId: number | string | null | undefined,
  children: ChildOrderVO[] | null | undefined,
  actionLabel: string,
): Promise<number | string | null> {
  if (!hasChildOrders(children)) return fallbackOrderId ?? null
  const child = await pickChildOrder(children, actionLabel)
  return child?.id ?? null
}
