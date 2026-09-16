import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { getAuditLogs, getVerifyLogs } from '@/api/log'
import type { AuditLog, AuditLogQueryParams, LogPageResult, VerifyLog, VerifyLogQueryParams } from '@/types/log'

export const useLogStore = defineStore('log', () => {
  const verifyList = ref<VerifyLog[]>([])
  const verifyTotal = ref(0)
  const verifyLoading = ref(false)
  const verifyPage = ref(1)
  const verifyPageSize = ref(10)
  const verifyFilters = reactive<Omit<VerifyLogQueryParams, 'page' | 'pageSize'>>({ startTime: '', endTime: '', staffId: '', orderNo: '' })
  const auditList = ref<AuditLog[]>([])
  const auditTotal = ref(0)
  const auditLoading = ref(false)
  const auditPage = ref(1)
  const auditPageSize = ref(10)
  const auditFilters = reactive<Omit<AuditLogQueryParams, 'page' | 'pageSize'>>({ operation: '', operatorType: '', startTime: '', endTime: '' })

  /** 加载核销日志。 */
  async function fetchVerifyLogs(): Promise<void> {
    verifyLoading.value = true
    try {
      const result: LogPageResult<VerifyLog> = await getVerifyLogs({ ...verifyFilters, page: verifyPage.value, pageSize: verifyPageSize.value })
      verifyList.value = result.list
      verifyTotal.value = result.total
    } finally {
      verifyLoading.value = false
    }
  }

  /** 加载操作追溯日志。 */
  async function fetchAuditLogs(): Promise<void> {
    auditLoading.value = true
    try {
      const result: LogPageResult<AuditLog> = await getAuditLogs({ ...auditFilters, page: auditPage.value, pageSize: auditPageSize.value })
      auditList.value = result.list
      auditTotal.value = result.total
    } finally {
      auditLoading.value = false
    }
  }

  /** 清空日志筛选并回到第一页。 */
  function resetVerifyFilters(): void { Object.assign(verifyFilters, { startTime: '', endTime: '', staffId: '', orderNo: '' }); verifyPage.value = 1 }
  function resetAuditFilters(): void { Object.assign(auditFilters, { operation: '', operatorType: '', startTime: '', endTime: '' }); auditPage.value = 1 }

  return { verifyList, verifyTotal, verifyLoading, verifyPage, verifyPageSize, verifyFilters, auditList, auditTotal, auditLoading, auditPage, auditPageSize, auditFilters, fetchVerifyLogs, fetchAuditLogs, resetVerifyFilters, resetAuditFilters }
})
