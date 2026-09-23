<script setup lang="ts">
/**
 * 入驻申请审核（中控后台）。
 *
 * 依据：`api_doc.json` 的 `/api/admin/merchant-apply/**`（2026-09-25 核对）。
 *
 * ## 为什么要有这一页
 * 中控此前只能在「商户管理」里对**品牌**做停用/启用（`/api/admin/merchants/{id}`，
 * `status=2` 即驳回），**看不到入驻申请单本身** —— 而审核恰恰要看申请人交了什么：
 * 门店门头图、营业执照、**身份证正反面照**。这些字段只在
 * `GET /api/admin/merchant-apply/list` 返回的 `AdminMerchantApplyVO` 里
 * （⚠️ **没有详情接口**，`/{applyId}` 只返回 `ResultVoid`）。
 *
 * ## 两条接口注意点
 * - 「驳回」的 `reason` 走 **query**，不是请求体，且**必填**（会展示给申请人）；
 * - 「通过」**不带请求体**。
 *
 * ## 隐私
 * 身份证号与正反面照属**敏感信息**，本页仅供审核核对：不做复制按钮、不做导出，
 * 并在页面上明确标注用途。⚠️ 后端尚未明确「身份证明文还是脱敏」的口径（见 CLAUDE.md §13.8）。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { approveMerchantApply, getMerchantApplyList, rejectMerchantApply } from '@/api/merchantApply'
import type { AdminMerchantApplyVO, MerchantApplyStatus } from '@/api/merchantApply'

const loading = ref(false)
const list = ref<AdminMerchantApplyVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

/** 列表筛选（默认只看待审核 —— 文档建议）。 */
const filters = reactive<{ status: MerchantApplyStatus | ''; keyword: string }>({
  status: 0,
  keyword: '',
})

/** 详情弹窗。 */
const detailVisible = ref(false)
const detail = ref<AdminMerchantApplyVO | null>(null)
/** 操作中的 applyId（禁用按钮，防连点）。 */
const actingId = ref(0)

/** 状态中文（后端 `statusText` 优先，缺失时兜底）。 */
function statusLabel(row: AdminMerchantApplyVO): string {
  if (row.statusText) return row.statusText
  return row.status === 0 ? '待审核' : row.status === 1 ? '已通过' : '已驳回'
}

/** 状态标签色。 */
function statusTagType(row: AdminMerchantApplyVO): 'warning' | 'success' | 'danger' {
  if (row.status === 1) return 'success'
  if (row.status === 2) return 'danger'
  return 'warning'
}

/** 省市区 + 详细地址拼一行。 */
function fullAddress(row: AdminMerchantApplyVO): string {
  const region = [row.province, row.city, row.district].filter(Boolean).join(' ')
  return [region, row.shopAddress].filter(Boolean).join(' ') || '—'
}

/** 加载列表。 */
async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await getMerchantApplyList({
      status: filters.status === '' ? undefined : filters.status,
      keyword: filters.keyword.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = result.list
    total.value = result.total
  } catch (error) {
    list.value = []
    total.value = 0
    ElMessage.error(error instanceof Error ? error.message : '入驻申请查询失败')
  } finally {
    loading.value = false
  }
}

/** 查询（回到第 1 页）。 */
function search(): void {
  page.value = 1
  void load()
}

/** 重置筛选。 */
function reset(): void {
  filters.status = 0
  filters.keyword = ''
  search()
}

/** 打开详情（⚠️ 数据来自列表行，没有详情接口）。 */
function openDetail(row: AdminMerchantApplyVO): void {
  detail.value = row
  detailVisible.value = true
}

/** 审核通过（二次确认；通过后会给申请人自动赋商家身份并绑微信，影响面大）。 */
async function approve(row: AdminMerchantApplyVO): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认通过「${row.brandName}」的入驻申请？\n通过后会启用该品牌及其门店，并给申请人开通商家身份。`,
      '审核通过',
      { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  actingId.value = row.applyId
  try {
    await approveMerchantApply(row.applyId)
    ElMessage.success('已通过')
    detailVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '审核通过失败')
  } finally {
    actingId.value = 0
  }
}

/** 驳回（必须填原因 —— 会展示给申请人，是他们重新提交的唯一依据）。 */
async function reject(row: AdminMerchantApplyVO): Promise<void> {
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(
      `驳回「${row.brandName}」的入驻申请。\n驳回原因会展示给申请人，请写清楚要改什么。`,
      '驳回申请',
      {
        inputPlaceholder: '如：营业执照不清晰，请重新上传',
        inputValidator: (value: string) => (value && value.trim() ? true : '请填写驳回原因'),
        type: 'warning',
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
      },
    )
    reason = result.value.trim()
  } catch {
    return
  }
  actingId.value = row.applyId
  try {
    await rejectMerchantApply(row.applyId, reason)
    ElMessage.success('已驳回')
    detailVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '驳回失败')
  } finally {
    actingId.value = 0
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>入驻申请审核</h1>
        <p>审核商家入驻申请：核对门店门头图、营业执照与身份证信息后通过或驳回。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 140px">
            <el-option label="待审核" :value="0" />
            <el-option label="已通过" :value="1" />
            <el-option label="已驳回" :value="2" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" clearable placeholder="品牌名 / 联系人 / 电话" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="content-card">
      <DataTable
        :data="list"
        :loading="loading"
        :total="total"
        :page="page"
        :page-size="pageSize"
        empty-text="暂无入驻申请"
        @page-change="page = $event; void load()"
        @size-change="pageSize = $event; page = 1; void load()"
      >
        <el-table-column prop="brandName" label="品牌名称" min-width="150" />
        <el-table-column label="联系人" width="150">
          <template #default="{ row }">
            <div>{{ row.contactName || '—' }}</div>
            <small class="sub">{{ row.contactPhone || '' }}</small>
          </template>
        </el-table-column>
        <el-table-column label="首店" min-width="200">
          <template #default="{ row }">
            <div>{{ row.shopName || '—' }}</div>
            <small class="sub">{{ fullAddress(row) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row)">{{ statusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="applyTime" label="提交时间" min-width="170" />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">查看资料</el-button>
            <template v-if="row.status === 0">
              <el-button
                size="small"
                type="success"
                :loading="actingId === row.applyId"
                @click="approve(row)"
              >
                通过
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :loading="actingId === row.applyId"
                @click="reject(row)"
              >
                驳回
              </el-button>
            </template>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 资料详情：⚠️ 数据来自列表行（没有详情接口） -->
    <el-dialog v-model="detailVisible" title="入驻申请资料" width="820px" append-to-body>
      <template v-if="detail">
        <el-alert type="info" :closable="false" class="mb">
          <p class="hint">
            身份证与证照信息<strong>仅用于本次资质审核</strong>，请勿外传或另存。
          </p>
        </el-alert>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="品牌名称">{{ detail.brandName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail)">{{ statusLabel(detail) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="联系人">{{ detail.contactName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ detail.contactPhone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="首店名称">{{ detail.shopName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="主营类目">{{ detail.mainBusiness || '—' }}</el-descriptions-item>
          <el-descriptions-item label="门店地址" :span="2">{{ fullAddress(detail) }}</el-descriptions-item>
          <el-descriptions-item label="经纬度" :span="2">
            <template v-if="detail.latitude != null && detail.longitude != null">
              {{ detail.latitude }}, {{ detail.longitude }}
            </template>
            <template v-else>—</template>
          </el-descriptions-item>
          <el-descriptions-item label="身份证号" :span="2">{{ detail.idCard || '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ detail.applyTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="审核时间">
            {{ detail.auditTime || '—' }}
            <template v-if="detail.auditorName">（{{ detail.auditorName }}）</template>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.remark" label="申请备注" :span="2">{{ detail.remark }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.rejectReason" label="驳回原因" :span="2">
            <span class="reject-text">{{ detail.rejectReason }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>证照与门店照片</el-divider>
        <div class="proof-grid">
          <div class="proof-item">
            <p class="proof-label">门店门头图</p>
            <el-image
              v-if="detail.shopImage"
              :src="detail.shopImage"
              :preview-src-list="[detail.shopImage]"
              fit="contain"
              class="proof-image"
              preview-teleported
            />
            <span v-else class="proof-empty">未上传</span>
          </div>
          <div class="proof-item">
            <p class="proof-label">营业执照<small class="sub">（驳回最常见依据）</small></p>
            <el-image
              v-if="detail.licenseImage"
              :src="detail.licenseImage"
              :preview-src-list="[detail.licenseImage]"
              fit="contain"
              class="proof-image"
              preview-teleported
            />
            <span v-else class="proof-empty">未上传</span>
          </div>
          <div class="proof-item">
            <p class="proof-label">身份证正面（人像面）</p>
            <el-image
              v-if="detail.idCardFrontImage"
              :src="detail.idCardFrontImage"
              :preview-src-list="[detail.idCardFrontImage]"
              fit="contain"
              class="proof-image"
              preview-teleported
            />
            <span v-else class="proof-empty">未上传</span>
          </div>
          <div class="proof-item">
            <p class="proof-label">身份证反面（国徽面）</p>
            <el-image
              v-if="detail.idCardBackImage"
              :src="detail.idCardBackImage"
              :preview-src-list="[detail.idCardBackImage]"
              fit="contain"
              class="proof-image"
              preview-teleported
            />
            <span v-else class="proof-empty">未上传</span>
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <template v-if="detail && detail.status === 0">
          <el-button type="danger" plain :loading="actingId === detail.applyId" @click="reject(detail)">
            驳回
          </el-button>
          <el-button type="success" :loading="actingId === detail.applyId" @click="approve(detail)">
            审核通过
          </el-button>
        </template>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.filter-card { margin-bottom: 16px; }
.sub { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.hint { margin: 0; line-height: 1.7; }
.mb { margin-bottom: 16px; }
.reject-text { color: var(--el-color-danger); }
.proof-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.proof-item { display: flex; flex-direction: column; gap: 6px; }
.proof-label { margin: 0; color: var(--el-text-color-regular); font-size: 13px; font-weight: 600; }
.proof-image { width: 100%; height: 170px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.proof-empty { display: flex; align-items: center; justify-content: center; height: 170px; color: var(--el-text-color-secondary); font-size: 13px; border: 1px dashed var(--el-border-color); border-radius: 6px; }
</style>
