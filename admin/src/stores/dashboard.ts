import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { getSalesRecords } from '@/api/dashboard'
import { aggregateSales, filterSalesByTimeRange, getSalesProductName } from '@/utils/dashboardAnalytics'
import type { DashboardTimeRange, SalesRecord } from '@/types/dashboard'

export const useDashboardStore = defineStore('dashboard', () => {
  const allRecords = ref<SalesRecord[]>([])
  const page = ref(1)
  const pageSize = ref(10)
  const loading = ref(false)
  const filters = reactive({ productName: '' })
  const timeRange = ref<DashboardTimeRange>('all')
  const selectedProductName = ref('')
  const tableKeyword = ref('')

  /** 依据时间选项过滤全量记录，时间筛选不重新请求后端。 */
  const filteredRecords = computed(() => filterSalesByTimeRange(allRecords.value, timeRange.value))
  /** 商品购买记录表格的本地搜索结果。 */
  const tableRecords = computed(() => {
    const keyword = tableKeyword.value.trim().toLowerCase()
    return keyword
      ? filteredRecords.value.filter((record) => [record.orderNo, record.productName, record.nickname].some((value) => value.toLowerCase().includes(keyword)))
      : filteredRecords.value
  })
  /** 全量记录的本地分页结果，切页不重新请求后端。 */
  const list = computed(() => {
    const start = (page.value - 1) * pageSize.value
    return tableRecords.value.slice(start, start + pageSize.value)
  })
  const total = computed(() => filteredRecords.value.length)
  const tableTotal = computed(() => tableRecords.value.length)
  const analytics = computed(() => aggregateSales(filteredRecords.value))
  const pageQuantity = computed(() => list.value.reduce((sum, row) => sum + row.quantity, 0))
  const pageAmount = computed(() => list.value.reduce((sum, row) => sum + row.subtotal, 0))
  const pageAveragePrice = computed(() => pageQuantity.value ? pageAmount.value / pageQuantity.value : 0)

  /** 全量销售指标和图表数据。 */
  const totalQuantity = computed(() => analytics.value.totalQuantity)
  const totalAmount = computed(() => analytics.value.totalAmount)
  const averagePrice = computed(() => analytics.value.averagePrice)
  const productSales = computed(() => analytics.value.productSales)
  const dailySales = computed(() => analytics.value.dailySales)
  const productNames = computed(() => productSales.value.map((item) => item.name))
  const selectedProductRecords = computed(() => {
    if (!selectedProductName.value) return []
    return filteredRecords.value.filter((record) => getSalesProductName(record.productName) === selectedProductName.value)
  })
  const selectedProductAnalytics = computed(() => aggregateSales(selectedProductRecords.value))
  const selectedProductSales = computed(() => selectedProductAnalytics.value.productSales[0] || null)
  const selectedProductDailySales = computed(() => selectedProductAnalytics.value.dailySales)

  /** 按商品名称加载全量后台购买记录。 */
  async function fetchSalesRecords(): Promise<void> {
    loading.value = true
    try {
      const records = await getSalesRecords({ productName: filters.productName })
      allRecords.value = records
      const lastPage = Math.max(1, Math.ceil(tableRecords.value.length / pageSize.value))
      page.value = Math.min(page.value, lastPage)
    } finally {
      loading.value = false
    }
  }

  /** 清空商品筛选并回到第一页。 */
  function resetFilters(): void {
    filters.productName = ''
    timeRange.value = 'all'
    selectedProductName.value = ''
    tableKeyword.value = ''
    page.value = 1
  }

  /** 切换本地时间范围并回到第一页。 */
  function setTimeRange(value: DashboardTimeRange): void {
    timeRange.value = value
    page.value = 1
  }

  /** 设置购买记录表格的本地搜索词并回到第一页。 */
  function setTableKeyword(value: string): void {
    tableKeyword.value = value
    page.value = 1
  }

  return {
    allRecords,
    list,
    total,
    page,
    pageSize,
    loading,
    filters,
    timeRange,
    selectedProductName,
    tableKeyword,
    pageQuantity,
    pageAmount,
    pageAveragePrice,
    tableTotal,
    totalQuantity,
    totalAmount,
    averagePrice,
    productSales,
    dailySales,
    productNames,
    selectedProductSales,
    selectedProductDailySales,
    fetchSalesRecords,
    resetFilters,
    setTimeRange,
    setTableKeyword,
  }
})
