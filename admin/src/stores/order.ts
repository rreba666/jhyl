import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { deleteOrder, getOrderDetail, getOrderTrace, getOrders, manualVerifyOrder, refundOrder, restoreOrder, shipOrder, updateOrderAddress } from '@/api/order'
import type { ExpressTrace, ManualVerifyDTO, OrderAddressUpdateDTO, OrderDetail, OrderPageResult, OrderPickupType, OrderQueryParams, OrderRefundDTO, OrderShipDTO, OrderStatus } from '@/types/order'
import { runBatch } from '@/utils/runBatch'

export const useOrderStore = defineStore('order', () => {
  const list = ref<OrderPageResult['list']>([])
  const total = ref(0)
  const loading = ref(false)
  const detailLoading = ref(false)
  const shipping = ref(false)
  const deleting = ref(false)
  const restoring = ref(false)
  const verifying = ref(false)
  const refunding = ref(false)
  const traceLoading = ref(false)
  const detail = ref<OrderDetail | null>(null)
  const trace = ref<ExpressTrace | null>(null)
  const page = ref(1)
  const pageSize = ref(10)
  const filters = reactive<{ status: '' | OrderStatus; pickupType: OrderPickupType; startTime: string; endTime: string; orderNo: string; wxShippingStatus: '' | number }>({ status: '', pickupType: 0, startTime: '', endTime: '', orderNo: '', wxShippingStatus: '' })

  /** 查询订单列表，并只发送 OpenAPI 明确支持的参数。 */
  async function fetchList(): Promise<void> {
    loading.value = true
    try {
      const params: OrderQueryParams = {
        page: page.value,
        pageSize: pageSize.value,
        pickupType: filters.pickupType,
        ...(filters.status === '' ? {} : { statuses: [filters.status] }),
        ...(filters.startTime ? { startTime: filters.startTime } : {}),
        ...(filters.endTime ? { endTime: filters.endTime } : {}),
        ...(filters.orderNo.trim() ? { orderNo: filters.orderNo.trim() } : {}),
        // 微信发货上报状态（铃铛「微信发货上报失败」跳转用；不传=全部）
        ...(filters.wxShippingStatus === '' ? {} : { wxShippingStatus: filters.wxShippingStatus }),
      }
      const result = await getOrders(params)
      list.value = result.list
      total.value = result.total
    } finally {
      loading.value = false
    }
  }

  /** 修改订单收货地址并刷新当前详情。 */
  async function updateAddress(orderId: string, payload: OrderAddressUpdateDTO): Promise<void> {
    await updateOrderAddress(orderId, payload)
    await fetchDetail(orderId)
    await fetchList()
  }

  /** 查询订单详情并缓存当前弹窗数据。 */
  async function fetchDetail(orderId: string): Promise<void> {
    detailLoading.value = true
    detail.value = null
    try {
      detail.value = await getOrderDetail(orderId)
    } finally {
      detailLoading.value = false
    }
  }

  /** 提交发货信息后重新加载列表和详情。 */
  async function ship(orderId: string, payload: OrderShipDTO): Promise<void> {
    shipping.value = true
    try {
      await shipOrder(orderId, payload)
      await fetchList()
      if (detail.value?.id === orderId) await fetchDetail(orderId)
    } finally {
      shipping.value = false
    }
  }

  /** 提交人工退款后刷新列表和当前订单详情。 */
  async function refund(orderId: string, payload: OrderRefundDTO): Promise<void> {
    refunding.value = true
    try {
      await refundOrder(orderId, payload)
      await fetchList()
      if (detail.value?.id === orderId) await fetchDetail(orderId)
    } finally {
      refunding.value = false
    }
  }

  /** 查询物流轨迹；后端返回 null 时保留真实空数据。 */
  async function fetchTrace(orderId: string): Promise<void> {
    traceLoading.value = true
    trace.value = null
    try {
      trace.value = await getOrderTrace(orderId)
    } finally {
      traceLoading.value = false
    }
  }

  /** 批量发货，复用单条接口并在全部任务结束后统一刷新列表。 */
  async function shipOrders(orderIds: string[], payload: OrderShipDTO): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(orderIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    shipping.value = true
    try {
      const result = await runBatch(ids, (id) => shipOrder(id, payload), 3)
      await fetchList()
      return {
        successIds: result.succeeded,
        failedIds: result.failed.map(({ item }) => item),
      }
    } finally {
      shipping.value = false
    }
  }

  /** 删除单个终态订单并刷新列表。 */
  async function removeOrder(orderId: string): Promise<void> {
    deleting.value = true
    try {
      await deleteOrder(orderId)
      if (list.value.length <= 1 && page.value > 1) page.value -= 1
      await fetchList()
    } finally {
      deleting.value = false
    }
  }

  /** 批量删除终态订单，单条失败不影响其他订单。 */
  async function removeOrders(orderIds: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(orderIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    deleting.value = true
    try {
      const result = await runBatch(ids, (id) => deleteOrder(id), 3)
      if (result.succeeded.length >= list.value.length && page.value > 1) page.value -= 1
      await fetchList()
      return {
        successIds: result.succeeded,
        failedIds: result.failed.map(({ item }) => item),
      }
    } finally {
      deleting.value = false
    }
  }

  /** 恢复单个软删除订单并刷新当前列表。 */
  async function restoreOne(orderId: string): Promise<void> {
    restoring.value = true
    try {
      await restoreOrder(orderId)
      await fetchList()
    } finally {
      restoring.value = false
    }
  }

  /** 批量恢复软删除订单，复用单条恢复接口并汇总结果。 */
  async function restoreOrders(orderIds: string[]): Promise<{ successIds: string[]; failedIds: string[] }> {
    const ids = [...new Set(orderIds)]
    if (!ids.length) return { successIds: [], failedIds: [] }
    restoring.value = true
    try {
      const result = await runBatch(ids, (id) => restoreOrder(id), 3)
      await fetchList()
      return {
        successIds: result.succeeded,
        failedIds: result.failed.map(({ item }) => item),
      }
    } finally {
      restoring.value = false
    }
  }

  /** 使用自提码核销订单并刷新当前列表和详情。 */
  async function verify(orderId: string, payload: ManualVerifyDTO): Promise<void> {
    verifying.value = true
    try {
      await manualVerifyOrder(orderId, payload)
      await fetchList()
      if (detail.value?.id === orderId) await fetchDetail(orderId)
    } finally {
      verifying.value = false
    }
  }

  /** 清空订单状态筛选并回到第一页。 */
  function resetFilters(): void {
    filters.status = ''
    filters.pickupType = 0
    filters.startTime = ''
    filters.endTime = ''
    filters.orderNo = ''
    filters.wxShippingStatus = ''
    page.value = 1
  }

  return { list, total, loading, detailLoading, shipping, deleting, restoring, verifying, refunding, traceLoading, trace, detail, page, pageSize, filters, fetchList, fetchDetail, updateAddress, ship, refund, fetchTrace, shipOrders, removeOrder, removeOrders, restoreOne, restoreOrders, verify, resetFilters }
})
