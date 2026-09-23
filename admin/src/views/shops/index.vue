<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import DataTable from '@/components/DataTable.vue'
import { useShopStore } from '@/stores/shop'
import { getMerchantShops, getMerchants } from '@/api/merchant'
import type { Shop } from '@/types/shop'
import type { ShopCreateDTO, ShopStatus } from '@/types/shop'
import { Delete, Edit, RefreshLeft } from '@element-plus/icons-vue'

const store = useShopStore()
const router = useRouter()
const selected = ref<Shop[]>([])
const deletableSelected = computed(() => selected.value.filter((shop) => shop.delFlag !== 1))
const restorableSelected = computed(() => selected.value.filter((shop) => shop.delFlag === 1))
const formVisible = ref(false)
const editingId = ref<string>()
const formRef = ref<FormInstance>()
// latitude/longitude 用交叉类型挂上：后端 DTO 里这两个字段的必填性不稳定，
// 这里统一按「可选」处理，保存时「没填就不传」，避免用 0 覆盖已有坐标。
const form = reactive<ShopCreateDTO & { latitude?: number; longitude?: number }>({ name: '', address: '', phone: '', merchantId: '' })
/**
 * 表单校验规则。
 * ⚠️ 「所属品牌 `merchantId`」**不做硬性必填**：契约写的是「中控为品牌开店时必填；
 * **平台自营单店可空**」（`ShopCreateDTO`），线上也确实存在 `merchantId` 为空的平台自营门店。
 * 漏选品牌会让门店没有归属（商家端商品管理报 `7310`），所以改用**保存时二次确认**兜住误漏，而不是挡住自营门店。
 * 「联系电话 `phone`」必填：订单通知**短信通道**取的就是 `phone`（为空才回退 `contactPhone`），
 * 两个都空会直接记 outbox「商家门店无手机号」——通知发不出去（见后端方案文档 §五）。
 */
const rules: FormRules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  address: [{ required: true, message: '请输入门店地址', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入门店联系电话（订单短信通知用）', trigger: 'blur' }],
}

// ===== 品牌（商户）维度 =====
/** 品牌下拉数据（`GET /api/admin/merchants/list`）。 */
const brandOptions = ref<Array<{ id: string; name: string }>>([])
/** 当前品牌筛选（空=全部品牌）。 */
const brandFilter = ref('')
/** 品牌筛选命中的门店（走 `GET /api/admin/merchants/{id}/shops`，服务端按品牌查全量）。 */
const brandShops = ref<Shop[]>([])
/** 是否处于"按品牌查看"模式。 */
const brandMode = computed(() => Boolean(brandFilter.value))
/** 表格数据：按品牌查看时用品牌下门店，否则用分页列表。 */
const visibleList = computed<Shop[]>(() => (brandMode.value ? brandShops.value : store.list))
/** 表格总数：按品牌查看时用品牌下门店数（该接口不分页，一次给全）。 */
const visibleTotal = computed(() => (brandMode.value ? brandShops.value.length : store.total))
/** 表格分页参数：按品牌查看时只有一页。 */
const visiblePage = computed(() => (brandMode.value ? 1 : store.page))
const visiblePageSize = computed(() => (brandMode.value ? Math.max(brandShops.value.length, 10) : store.pageSize))

/** 门店 → 品牌名（后端 ShopVO.merchantName；为空表示平台自营单店）。 */
function brandNameOf(shop: Shop): string {
  return shop.merchantName || (shop.merchantId ? `商户${shop.merchantId}` : '平台自营')
}

// ===== 通知可达性（后端方案文档 §五 / §八-3：引导补齐「门店手机号」与「绑定微信」）=====

/**
 * 门店可用手机号：优先 `phone`，为空**回退**经营联系人 `contactPhone`
 * —— 与后端短信取号口径完全一致（后端方案文档 §五）。
 */
function shopPhoneOf(shop: Shop): string {
  return (shop.phone || shop.contactPhone || '').trim()
}

/**
 * 当前列表里通知**可能送不到**的门店。
 *
 * 订单通知走两条通道，任一断掉都会少一条触达路径：
 * - **短信**：需要门店至少有一个手机号（`phone`，空则回退 `contactPhone`）；
 * - **微信订阅消息**：需要该门店有人绑定微信（`boundUserCount > 0`）。
 *
 * 两条都断时只剩「铃铛红点」（红点与 openid 无关、恒可用），
 * 商家很容易以为「没新订单」。所以这里主动提示补齐。
 */
const notifyRiskShops = computed<Shop[]>(() => visibleList.value.filter(
  (shop) => !shopPhoneOf(shop) || !shop.boundUserCount,
))

/** 加载品牌下拉（失败静默，不影响门店列表）。 */
async function loadBrands(): Promise<void> {
  try {
    const result = await getMerchants(1, 200)
    brandOptions.value = (result.list || []).map((item) => ({ id: String(item.id), name: item.brandName || `品牌${item.id}` }))
  } catch {
    brandOptions.value = []
  }
}

/** 切换品牌：选中品牌走品牌下门店接口（服务端全量），清空回到分页列表。 */
async function onBrandChange(): Promise<void> {
  selected.value = []
  if (!brandFilter.value) {
    brandShops.value = []
    void loadList()
    return
  }
  try {
    const list = (await getMerchantShops(brandFilter.value)) as Shop[]
    brandShops.value = list.map((shop) => ({ ...shop, id: String(shop.id || '') }))
  } catch (error) {
    brandShops.value = []
    ElMessage.error(error instanceof Error ? error.message : '品牌下门店查询失败')
  }
}

/**
 * 高德地图 JS API Key（Web端）。⚠️ 这里用 **v1.4.15**：该版本不需要 `securityJsCode`，
 * 只需一个 Key；若控制台把 Key 强绑到 2.0，会报 INVALID_USER_SCODE —— 那时需再补安全密钥并升到 2.0。
 */
const AMAP_KEY = '62b0a892c14c6e067b5b09a0d1e54b5b'

/** 地图选点弹窗状态。 */
const mapVisible = ref(false)
const mapMessage = ref('')
/** 搜索框内容（高德 AutoComplete 会直接写这个 input，这里只用于 v-model 占位与清空）。 */
const mapKeyword = ref('')
/** 弹窗内回显"解析出的地址"，让用户能立刻确认自动填写生效了。 */
const pickedAddress = ref('')
let amapMap: any = null
let amapMarker: any = null

/** 动态注入高德脚本：只在首次打开选点弹窗时加载，不增加打包体积。 */
function loadAmap(): Promise<any> {
  const w = window as unknown as { AMap?: any }
  if (w.AMap) return Promise.resolve(w.AMap)
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    // ⚠️ Geocoder（逆地理编码）是插件，必须在这里声明，否则 AMap.Geocoder 不可用
    el.src = `https://webapi.amap.com/maps?v=1.4.15&key=${AMAP_KEY}&plugin=AMap.Geocoder,AMap.Autocomplete,AMap.PlaceSearch,AMap.Geolocation`
    el.onload = () => (w.AMap ? resolve(w.AMap) : reject(new Error('高德脚本已加载但 AMap 未就绪')))
    el.onerror = () => reject(new Error('高德地图脚本加载失败：请检查 Key 是否为「Web端(JS API)」以及域名白名单'))
    document.head.appendChild(el)
  })
}

/** 打开选点弹窗（真正的初始化放到 @opened，确保地图容器已挂载）。 */
function openMapPicker(): void {
  mapMessage.value = ''
  pickedAddress.value = ''
  mapKeyword.value = ''
  mapVisible.value = true
}

/** 地图挂载完成后初始化：以当前坐标为中心，点击地图即落点。 */
async function onMapOpened(): Promise<void> {
  try {
    const AMap = await loadAmap()
    const hasPoint = typeof form.latitude === 'number' && typeof form.longitude === 'number'
    // 中心：优先门店已有坐标；没有就先用一个中性默认值，随后尝试浏览器定位纠正
    const center: [number, number] = hasPoint ? [form.longitude as number, form.latitude as number] : [116.397428, 39.90923]
    amapMap = new AMap.Map('shop-map-picker', { zoom: 15, center })
    amapMap.on('click', (e: { lnglat: { getLng: () => number; getLat: () => number } }) => {
      applyMapPoint(e.lnglat.getLng(), e.lnglat.getLat())
    })
    amapMarker = new AMap.Marker({ position: center, map: amapMap })

    // 关键字搜索：输入门店名/路名 → 选中结果即定位并落点（比手拖地图快得多）
    if (AMap.Autocomplete && AMap.PlaceSearch) {
      const auto = new AMap.Autocomplete({ input: 'shop-map-search', city: '全国' })
      auto.on('select', (e: { poi?: { location?: { lng: number; lat: number } } }) => {
        const loc = e?.poi?.location
        if (!loc) return
        amapMap.setCenter(loc)
        amapMap.setZoom(16)
        applyMapPoint(loc.lng, loc.lat)
      })
    }

    // 没选过点时才自动定位（避免覆盖已有坐标）；失败静默，保持默认中心
    if (!hasPoint && AMap.Geolocation) {
      const geolocation = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000 })
      geolocation.getCurrentPosition((status: string, result: { position?: { getLng: () => number; getLat: () => number } }) => {
        if (status !== 'complete' || !result?.position) return
        const pos = result.position
        amapMap.setCenter(pos)
        applyMapPoint(pos.getLng(), pos.getLat())
      })
    }
  } catch (error) {
    mapMessage.value = error instanceof Error ? error.message : '地图加载失败'
  }
}

/**
 * 逆地理编码：坐标 → 可读地址，自动填入「门店地址」。
 * 用 `formattedAddress`（如「江西省九江市柴桑区水葵路XX号」），与后端 address 字段语义一致。
 * ⚠️ 失败静默：只保留坐标，不打断选点。
 */
function resolveAddress(lng: number, lat: number): void {
  const AMap = (window as unknown as { AMap?: any }).AMap
  if (!AMap || !AMap.Geocoder) return
  const geocoder = new AMap.Geocoder({ radius: 200, extensions: 'all' })
  geocoder.getAddress([lng, lat], (status: string, result: { regeocode?: { formattedAddress?: string } }) => {
    if (status !== 'complete') return
    const formatted = result?.regeocode?.formattedAddress
    if (formatted) {
      form.address = formatted
      pickedAddress.value = formatted
    }
  })
}

/** 落点：写回表单、同步地图标记，并反解出地址。坐标系 GCJ-02，与后端同义。 */
function applyMapPoint(lng: number, lat: number): void {
  form.longitude = Number(lng)
  form.latitude = Number(lat)
  if (amapMarker) amapMarker.setPosition([lng, lat])
  // 选点即覆盖地址：用户点地图就是要改位置，地址必须跟着坐标走，否则两者不一致
  resolveAddress(Number(lng), Number(lat))
}

/** 清空已选坐标（允许门店先不填定位）。 */
function clearMapPoint(): void {
  form.latitude = undefined
  form.longitude = undefined
  if (amapMarker) amapMarker.setMap(null)
  amapMarker = null
}

/** 清空并打开门店编辑表单（编辑时回显所属品牌，便于改归属）。 */
function openForm(shop?: Shop): void {
  editingId.value = shop?.id
  Object.assign(form, {
    name: shop?.name || '',
    address: shop?.address || '',
    phone: shop?.phone || '',
    // merchantId 为 null 表示平台自营单店 → 下拉按空串处理
    merchantId: shop?.merchantId ? String(shop.merchantId) : '',
    // 经纬度回显（后端 ShopVO 已返回）；没有就保持 undefined，保存时不提交
    latitude: typeof shop?.latitude === 'number' ? shop.latitude : undefined,
    longitude: typeof shop?.longitude === 'number' ? shop.longitude : undefined,
  })
  formVisible.value = true
}

/** 校验并保存门店。 */
async function submitForm(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  // 新增但没选品牌：**允许**（= 平台自营单店，契约里 `merchantId` 本就「平台自营单店可空」），
  // 但必须二次确认 —— 绝大多数情况下是「漏选」，漏了会让门店没归属（商家端商品管理报 7310）。
  if (!editingId.value && !form.merchantId) {
    try {
      await ElMessageBox.confirm(
        '未选择「所属品牌」，将按平台自营单店创建（无品牌归属，商家端看不到该店商品）。确认继续吗？',
        '确认门店归属',
        { type: 'warning', confirmButtonText: '按平台自营创建', cancelButtonText: '返回选择品牌' },
      )
    } catch {
      return
    }
  }
  try {
    // 编辑时「不传 merchantId = 不改归属」：只有真的选了品牌才带上，避免冲掉已有归属
    const payload: ShopCreateDTO = { name: form.name, address: form.address, phone: form.phone }
    // 经纬度：两个都有才提交（GCJ-02，与后端/小程序同坐标系，不做转换）
    if (typeof form.latitude === 'number' && typeof form.longitude === 'number') {
      payload.latitude = form.latitude
      payload.longitude = form.longitude
    }
    if (form.merchantId) payload.merchantId = form.merchantId
    await store.save(editingId.value, payload)
    formVisible.value = false
    ElMessage.success(editingId.value ? '门店已更新' : '门店已新增')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '门店保存失败') }
}

/** 切换门店状态，失败时重新加载服务端状态。 */
async function changeStatus(shop: Shop, value: boolean | string | number): Promise<void> {
  const next: ShopStatus = value ? 1 : 0
  try {
    await ElMessageBox.confirm(`确认${next ? '启用' : '禁用'}门店“${shop.name}”吗？`, '门店状态确认')
    await store.setStatus(shop, next)
    ElMessage.success(next ? '门店已启用' : '门店已禁用')
  } catch (error) {
    shop.status = next ? 0 : 1
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店状态更新失败')
  }
}

/** 判断门店是否已经软删除。 */
function isDeleted(shop: Shop): boolean {
  return shop.delFlag === 1
}

/** 删除单个门店，并在确认后刷新列表。 */
async function removeShop(shop: Shop): Promise<void> {
  if (isDeleted(shop)) return
  try {
    await ElMessageBox.confirm(`确认删除门店“${shop.name}”吗？`, '删除门店确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    await store.remove(shop.id)
    selected.value = []
    ElMessage.success('门店已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店删除失败')
  }
}

/** 批量软删除当前页选中的正常门店。 */
async function removeSelected(): Promise<void> {
  if (!deletableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${deletableSelected.value.length} 个门店吗？`, '批量删除门店确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' })
    const result = await store.removeBatch(deletableSelected.value.map((shop) => shop.id))
    selected.value = []
    if (result.failedIds.length) ElMessage.warning(`删除成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    else ElMessage.success(`已删除 ${result.successIds.length} 个门店`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

/** 恢复单个已删除门店。 */
async function restoreShop(shop: Shop): Promise<void> {
  if (!isDeleted(shop)) return
  try {
    await ElMessageBox.confirm(`确认恢复门店“${shop.name}”吗？`, '恢复门店确认', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    await store.restore(shop.id)
    selected.value = []
    ElMessage.success('门店已恢复')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '门店恢复失败')
  }
}

/** 批量恢复当前页选中的已删除门店。 */
async function restoreSelected(): Promise<void> {
  if (!restorableSelected.value.length) return
  try {
    await ElMessageBox.confirm(`确认恢复选中的 ${restorableSelected.value.length} 个门店吗？`, '批量恢复门店确认', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    const result = await store.restoreBatch(restorableSelected.value.map((shop) => shop.id))
    selected.value = []
    if (result.failedIds.length) ElMessage.warning(`恢复成功 ${result.successIds.length} 个，失败 ${result.failedIds.length} 个`)
    else ElMessage.success(`已恢复 ${result.successIds.length} 个门店`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量恢复失败')
  }
}

async function loadList(): Promise<void> {
  try { await store.fetchList() } catch (error) { ElMessage.error(error instanceof Error ? error.message : '门店列表查询失败') }
}

/** 按关键词搜索门店（ID/名称），回车或点击触发；品牌模式下在品牌门店内过滤。 */
function searchShops(): void {
  store.page = 1
  if (brandMode.value) void onBrandChange()
  else void loadList()
}

/** 跳转「店员管理」并按本门店过滤（商户管理员查看本店人员/店长/骑手）。 */
function goStaff(shop: Shop): void {
  router.push({ path: '/staff', query: { shopId: shop.id, shopName: shop.name } })
}

onMounted(() => {
  void loadBrands()
  void loadList()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading"><div><h1>门店管理</h1><p>维护自提门店的基础信息和营业状态；列表按【所属品牌】展示，可切换品牌只看该品牌门店。</p></div><el-button type="primary" @click="openForm()">新增门店</el-button></div>
    <el-card shadow="never" class="content-card">
      <div class="toolbar"><div><strong>门店列表</strong><span class="toolbar-count">共 {{ visibleTotal }} 条</span></div><div class="toolbar-actions"><el-select v-model="brandFilter" clearable filterable placeholder="全部品牌" style="width: 200px" @change="onBrandChange"><el-option v-for="brand in brandOptions" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select><el-input v-model="store.keyword" placeholder="门店ID/名称" clearable class="search-input" @keyup.enter="searchShops" @clear="searchShops" /><el-button type="primary" @click="searchShops">搜索</el-button><span v-if="selected.length" class="selection-tip">已选择 {{ selected.length }} 项</span><el-button size="small" type="danger" plain :disabled="!deletableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="removeSelected"><el-icon><Delete /></el-icon>批量删除</el-button><el-button size="small" type="success" plain :disabled="!restorableSelected.length || store.actionLoading" :loading="store.actionLoading" @click="restoreSelected"><el-icon><RefreshLeft /></el-icon>批量恢复</el-button><el-button :loading="store.loading" @click="loadList">刷新</el-button></div></div>
      <!-- 通知可达性引导（后端方案文档 §八-3）：两条通道任一断掉都主动提示，避免商家以为「没新订单」 -->
      <el-alert
        v-if="notifyRiskShops.length"
        class="notify-alert"
        type="warning"
        :closable="false"
        show-icon
        :title="`当前列表有 ${notifyRiskShops.length} 家门店的通知可能送不到`"
        description="订单通知走「微信订阅消息 + 短信」两条通道：门店需至少填一个手机号（联系电话，为空回落经营联系人电话），且该门店需有人绑定微信；两条都断时只剩铃铛红点。点「编辑」补齐手机号，绑定微信在「店员管理」里做。"
      />
      <p v-if="brandMode" class="muted brand-tip">按品牌查看：数据来自「品牌下门店」接口（该品牌全部门店，不分页）；要回到全部门店请清空品牌。</p>
      <DataTable :data="visibleList" :loading="store.loading" :total="visibleTotal" :page="visiblePage" :page-size="visiblePageSize" empty-text="暂无门店数据" @selection-change="selected = $event" @page-change="store.page = $event; selected = []; void loadList()" @size-change="store.pageSize = $event; store.page = 1; selected = []; void loadList()">
        <el-table-column label="所属品牌" min-width="170">
          <template #default="{ row }">
            <el-tag v-if="row.merchantName" type="warning" effect="light">{{ row.merchantName }}</el-tag>
            <el-tag v-else type="info" effect="plain">{{ brandNameOf(row) }}</el-tag>
            <span v-if="row.merchantId" class="muted brand-id">{{ row.merchantId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="门店 ID" min-width="180" />
        <el-table-column prop="name" label="门店名称" min-width="180" />
        <el-table-column prop="address" label="地址" min-width="260" />
        <el-table-column prop="phone" label="联系电话" width="140" />
        <el-table-column label="通知可达性" min-width="190">
          <template #default="{ row }">
            <div class="notify-cell">
              <el-tag :type="shopPhoneOf(row) ? 'success' : 'danger'" effect="light" size="small">{{ shopPhoneOf(row) ? '手机号已填' : '缺手机号' }}</el-tag>
              <el-tag :type="row.boundUserCount ? 'success' : 'danger'" effect="light" size="small">{{ row.boundUserCount ? '已绑微信' : '无人绑微信' }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="人员（店长/骑手/已绑微信）" min-width="190">
          <template #default="{ row }">
            <span v-if="row.managerCount != null || row.riderCount != null || row.boundUserCount != null">
              {{ row.managerCount ?? 0 }} / {{ row.riderCount ?? 0 }} / {{ row.boundUserCount ?? 0 }}
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag v-if="isDeleted(row)" type="info">已删除</el-tag><el-switch v-else :model-value="row.status === 1" :loading="store.actionLoading" @change="changeStatus(row, $event)" /></template></el-table-column>
        <el-table-column prop="createTime" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="250" fixed="right"><template #default="{ row }"><div class="operator-actions"><el-button v-if="isDeleted(row)" size="small" type="success" :loading="store.actionLoading" @click="restoreShop(row)"><el-icon><RefreshLeft /></el-icon>恢复</el-button><template v-else><el-button size="small" @click="goStaff(row)">查看人员</el-button><el-button size="small" type="primary" @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button><el-button size="small" type="danger" :loading="store.actionLoading" @click="removeShop(row)"><el-icon><Delete /></el-icon>删除</el-button></template></div></template></el-table-column>
      </DataTable>
    </el-card>
    <el-dialog v-model="formVisible" :title="editingId ? '编辑门店' : '新增门店'" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px"><el-form-item label="所属品牌" prop="merchantId"><el-select v-model="form.merchantId" clearable filterable placeholder="请选择所属品牌" style="width: 100%"><el-option v-for="brand in brandOptions" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select><div class="field-hint">品牌即入驻商户。<b>留空 = 平台自营单店</b>（无品牌归属，保存时会二次确认）；漏选品牌会让商家端商品管理报 7310。编辑时留空 = 不改归属。</div></el-form-item><el-form-item label="门店名称" prop="name"><el-input v-model="form.name" /></el-form-item><el-form-item label="门店地址" prop="address"><el-input v-model="form.address" /></el-form-item><el-form-item label="门店定位"><div class="map-pick-row"><el-button size="small" @click="openMapPicker">地图选点</el-button><el-button v-if="form.latitude != null && form.longitude != null" size="small" text type="danger" @click="clearMapPoint">清除</el-button><span v-if="form.latitude != null && form.longitude != null" class="map-coord">已选：{{ form.longitude }}, {{ form.latitude }}</span><span v-else class="map-coord map-coord--empty">未选点（同城配送按门店坐标算距离，建议填写）</span></div><div class="field-hint">在地图上点一下即可定位，并**自动填写门店地址**；坐标系为 GCJ-02（高德原生，与小程序端一致），不做转换。</div></el-form-item><el-form-item label="联系电话" prop="phone"><el-input v-model="form.phone" /><div class="field-hint">订单通知的短信通道发到该号码（后端取号：本字段 → 为空回退经营联系人电话）。</div></el-form-item></el-form>
      <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="store.saving" @click="submitForm">保存</el-button></template>
    </el-dialog>
    <!-- 地图选点（动态加载高德脚本，初始化在 @opened 里做） -->
    <el-dialog v-model="mapVisible" title="选择门店位置" width="720px" append-to-body @opened="onMapOpened">
      <input id="shop-map-search" v-model="mapKeyword" class="map-search-input" placeholder="搜索门店名 / 路名定位，例如：水葵路" />
      <div id="shop-map-picker" class="shop-map" />
      <p v-if="pickedAddress" class="map-picked">已解析地址：{{ pickedAddress }}</p>
      <p v-if="mapMessage" class="map-error">{{ mapMessage }}</p>
      <p v-else class="map-tip">点击地图任意位置落点；当前：{{ form.longitude ?? '—' }}, {{ form.latitude ?? '—' }}</p>
      <template #footer><el-button type="primary" @click="mapVisible = false">确定</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.operator-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.operator-actions :deep(.el-button) { margin-left: 0; padding: 5px 8px; }
.operator-actions :deep(.el-icon) { margin-right: 4px; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; }
.search-input { width: 200px; }
.muted { color: var(--el-text-color-secondary); }
.selection-tip { color: var(--el-text-color-secondary); font-size: 13px; }
/* 品牌维度 */
.brand-tip { margin: 0 0 10px; font-size: 13px; }
.brand-id { margin-left: 6px; font-size: 12px; }
.field-hint { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
/* 通知可达性引导 */
.notify-alert { margin-bottom: 12px; }
.notify-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
/* 地图选点（2026-09-23 新增门店需传经纬度） */
.map-pick-row { display: flex; align-items: center; gap: 8px; }
.map-coord { color: var(--vben-text-secondary, #4e5969); font-size: 13px; }
.map-coord--empty { color: var(--vben-muted, #86909c); }
.shop-map { width: 100%; height: 420px; border-radius: 6px; background: #f5f6f7; }
.map-search-input { width: 100%; height: 34px; margin-bottom: 8px; padding: 0 12px; box-sizing: border-box; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 14px; outline: none; }
.map-search-input:focus { border-color: #409eff; }
.map-picked { margin: 8px 0 0; color: #1d2129; font-size: 13px; }
.map-tip { margin: 8px 0 0; color: #86909c; font-size: 12px; }
.map-error { margin: 8px 0 0; color: #e1251b; font-size: 13px; }
</style>
