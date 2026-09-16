/** Backend permits soft deletion only for terminal order states. */
const deletableOrderStatuses = new Set([4, 5, 7])

export function isDeletableOrderStatus(status: number): boolean {
  return deletableOrderStatuses.has(status)
}

/** 自提订单是否已核销：后端不单独返回核销状态，核销后订单状态流转为 8（已核销）。 */
export function isVerifiedStatus(status: number): boolean {
  return Number(status) === 8
}

