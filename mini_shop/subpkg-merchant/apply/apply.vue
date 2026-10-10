<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { getMyMerchantApply, submitMerchantApply, type MerchantApplyVO } from '@/api/merchant'
import { ApiRequestError, uploadFile } from '@/utils/request'
import { validateApplyContactPhone, validateApplyIdCardFloor, validateIdCard } from '@/utils/input-validation'
// ⚠️ 2026-10-01 新增：图片上传前统一压缩，不再指望用户自己把图裁到规定尺寸。
import {
  chooseAndCompressImage,
  CERTIFICATE_IMAGE_COMPRESS,
  SHOP_IMAGE_COMPRESS,
} from '@/utils/image-compress'
// ⚠️ 2026-10 新增：**商户级（品牌级）**让利比例 —— 区间 / 解析 / 校验 / 越界文案**全部**复用
//    `@/utils/product-commission`（同一个后端错误码 13018，本页**不重写**任何 3/20 字面量或文案）；
//    ⛔ 用户可见文案**只用商户级那一套** `MERCHANT_COMMISSION_*`（其值就定义在同一个模块里）：
//    商户级没有可回退的上一级，商品级编辑页那套「未设置」文案搬过来就是错的。
import {
  MERCHANT_COMMISSION_RATE_ERROR_CODE,
  MERCHANT_COMMISSION_RATE_INPUT_PLACEHOLDER,
  MERCHANT_COMMISSION_RATE_OPTIONAL_NOTE,
  MERCHANT_COMMISSION_RATE_RANGE_TEXT,
  MERCHANT_COMMISSION_RATE_SNAPSHOT_NOTE,
  parseMerchantCommissionRateInput,
  validateMerchantCommissionRate,
} from '@/utils/product-commission'

/** 我的申请单（null = 未提交过，展示表单）。 */
const apply = ref<MerchantApplyVO | null>(null)
/** 页面加载 / 提交 / 上传 状态。 */
const loading = ref(true)
const submitting = ref(false)
const uploading = ref(false)
/** 是否展示表单：未申请过 or 已驳回（可重提）。 */
const showForm = ref(true)
/** 品牌名内联错误（7311 品牌已存在）。 */
const brandError = ref('')

/** 表单字段（坐标必填，由微信选点回填）。 */
const form = ref({
  brandName: '',
  contactName: '',
  contactPhone: '',
  shopName: '',
  address: '',
  mainBusiness: '',
  latitude: null as number | null,
  longitude: null as number | null,
  licenseImage: '',
  /**
   * 门店图片（门头/店内照，提交到 `shop.shopImage`）。
   * ⚠️ 2026-09-22 需求：门店本身有图片字段（后端 `ShopCreateDTO.shopImage`，建议 690x345、<2MB），
   * 但**入驻申请的 `ShopPart` 目前没有这个字段** → 需要后端补上并在审核通过建店时映射过去，
   * 否则这里传的值会被后端忽略（前端照传，后端加字段后即自动生效，不会报错）。
   */
  shopImage: '',
  /**
   * 身份证号 + 正反面照。
   * ⚠️ 2026-09-23 按 `api_doc.json` 补：`MerchantApplyDTO` 明确列了 `idCard` / `idCardFrontImage` /
   * `idCardBackImage`（描述："提交时需填写身份证号及身份证正反面照，与提现身份证验证一致"）。
   * ⚠️ 这三个是**申请层**字段，**不在 `shop` 里**；且提现用的是 `idCardFrontUrl`/`idCardBackUrl`，
   * **字段名不同，别混用**。
   */
  idCard: '',
  idCardFrontImage: '',
  idCardBackImage: '',
  /**
   * **商户级（品牌级）让利比例（%）**：**选填**，留空 = 该字段**整个不进请求体** ⇒ 后端按平台默认结算。
   *
   * ⚠️ 这里存的是**输入框原文**（字符串），提交时才解析成数字 ⇒ 「清空输入框」自然回到「不提交」，
   *    谁也没机会给它兜一个 `0`（兜 0 = 伪造数据，本仓库硬红线）。
   * ⚠️ 与商品级比例是**不同层级**（商户级对商户下所有门店生效），文案/常量见 `utils/product-commission.ts`。
   * ⚠️ 入驻是**新建**申请（驳回后重提也是新建一条申请单）⇒ 这里**没有**「不传 = 不修改」的语义：
   *    留空就是留空（= 用平台默认）。
   * ⚠️ 2026-10-09（W16 §2）：后端**已新增回显** `MerchantApplyVO.commissionRate`
   *    （`null` = 当时未填）⇒ `loadApply()` 会把**驳回后重提**时申报过的比例**回填**到这里，
   *    商家**不必重填**；回填值仍是"输入框原文"，提交路径不变（仍然只解析、不兜底）。
   */
  commissionRate: '',
  remark: '',
})

/** 状态文案。 */
const statusText = computed(() => {
  const item = apply.value
  if (!item) return ''
  if (item.statusText) return item.statusText
  return item.status === 0 ? '待审核' : item.status === 1 ? '已通过' : '已驳回'
})

/** 状态说明（按文档 §5.2 状态机）。 */
const statusHint = computed(() => {
  const item = apply.value
  if (!item) return ''
  if (item.status === 0) return '资料已提交，平台正在审核（1–3 个工作日）。'
  if (item.status === 2) return '申请未通过，请按驳回原因修改后重新提交（同名品牌可直接重提）。'
  // ⚠️ 2026-10-10 改写（对接文档 §一/§二/§八-2，旧文案「商家工号由客服另行发放」已作废）：
  //    审核通过时后端**自动开好两个账号**（核销页 + 商户后台，同名同初始密码）⇒ 不再需要客服发号。
  // ⚠️ 但**不能无条件宣称"账号已开通"**：`backendAccountIssued` 是"账号是否已开通"的权威字段，
  //    为 false 时只可能是**自动开户上线前已通过的存量申请**（对接文档 §九：不追溯补号）
  //    ⇒ 那种情况如实说要补发，绝不编一句"已经开通"（本仓库硬红线：不伪造状态）。
  // ⚠️ 另：审核通过会**同时**授予「商家 MERCHANT_OWNER」与「首店店长 MANAGER」，店长身份**免工号**
  //    ⇒ 通过后立刻就能进小程序「门店管理」，账号只决定能否登 PC 后台 / 核销页，**不阻塞小程序入口**。
  if (!item.backendAccountIssued) {
    return '审核已通过，已开通「门店管理」，可到「我的 → 我的身份」进入；电脑端后台账号未随申请下发（自动开户上线前已通过的存量申请不会追溯补号），可由客服补发，不影响小程序使用。'
  }
  return '审核已通过，电脑端后台的登录名与初始密码已自动开通（见「商家工作台 → 电脑端后台」）；可到「我的 → 我的身份」进入门店管理。'
})

/** 状态栏高度：本页是 navigationStyle: custom，必须自己避开状态栏与右上角胶囊按钮，否则内容会顶头。 */
const statusBarHeight = ref(0)
/** 正文起始位置 = 状态栏 + 导航栏(44px) + 间距。 */
const contentTop = computed(() => statusBarHeight.value + 44 + 8)

onLoad(() => {
  statusBarHeight.value = uni.getSystemInfoSync().statusBarHeight || 0
  void loadApply()
})

/** 下拉刷新：重新查询申请状态（不做高频轮询）。 */
onPullDownRefresh(async () => {
  await loadApply()
  uni.stopPullDownRefresh()
})

/** 加载我的申请单，决定展示表单还是状态卡。 */
async function loadApply(): Promise<void> {
  loading.value = true
  try {
    const result = await getMyMerchantApply()
    apply.value = result
    // 无申请 → 表单；已驳回 → 表单（可重提）；待审核/已通过 → 状态卡
    showForm.value = !result || result.status === 2
    if (result && result.status === 2) {
      form.value.brandName = result.brandName || ''
      form.value.shopName = result.shopName || ''
      // ⚠️ 2026-10-09（W16 §2）：后端已**回显**申请时申报的商户（品牌）级让利比例
      //    （`MerchantApplyVO.commissionRate`）⇒ **驳回后重提不必重填**（这就是该字段的唯一用途）。
      // ⚠️ `null` = 当时**未填**（将按平台默认结算）⇒ 保持空串：提交时该键整个**不进请求体**
      //    （见 submit() 里那处有条件展开），⛔ **绝不**兜成 `0` / 任何猜测值。
      // ⚠️ 非空值**原样回填**（不在这里做范围兜底）：万一后端回了越界值，就让**提交时的本地校验**
      //    用 `13018` 那句话说清楚 —— 若在这里悄悄清空，等于把用户申报过的比例改成"平台默认"，
      //    那才是真正的静默改数据。
      const echoedCommissionRate = result.commissionRate
      form.value.commissionRate = echoedCommissionRate == null ? '' : String(echoedCommissionRate)
    }
  } catch {
    apply.value = null
    showForm.value = true
  } finally {
    loading.value = false
  }
}

/** 微信选点：回填门店名/地址/经纬度（GCJ-02，与后端配送坐标系一致，无需转换）。 */
function chooseShopLocation(): void {
  uni.chooseLocation({
    success: (res) => {
      if (!form.value.shopName) form.value.shopName = res.name || ''
      form.value.address = res.address || ''
      form.value.latitude = res.latitude
      form.value.longitude = res.longitude
    },
    fail: (error) => {
      const message = String(error?.errMsg || '')
      if (!/cancel/i.test(message)) uni.showToast({ title: '选择位置失败，请检查定位授权', icon: 'none' })
    },
  })
}

/**
 * 营业执照：选图 → **自动压缩** → 上传（`/api/common/upload`）→ 回填 `licenseImage`。
 *
 * ⚠️ 2026-10-01 修：原实现写的是 `uni.chooseImage({ count: 1 })` —— **连 `sizeType` 都没传**，
 * 也就是把手机相册里的**原图直接上传**（随手一拍就可能十几 MB）。
 * 现改走 `chooseAndCompressImage()`（统一压缩到长边 ≤1600、≤1000 KB）。
 */
async function chooseLicense(): Promise<void> {
  const picked = await chooseAndCompressImage(CERTIFICATE_IMAGE_COMPRESS)
  if (!picked) return // 用户取消选择
  uploading.value = true
  try {
    form.value.licenseImage = await uploadFile(picked.path)
    uni.showToast({ title: '营业执照已上传', icon: 'success' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

/**
 * 门店图片（门头/店内照）：选图 → **自动压缩** → 上传（`/api/common/upload`）→ 回填 `shopImage`。
 *
 * ⚠️ 2026-10-01 修：原注释写的是「尺寸由商户自己把握」—— **这正是问题所在**：
 *    后端 `ShopCreateDTO.shopImage` 要求 **690×345、<2MB**，而 `sizeType:['compressed']`
 *    是微信自带压缩，**不保证尺寸/体积/比例** ⇒ 用户随手拍的大图照样能传上去。
 *    现改走 `chooseAndCompressImage(SHOP_IMAGE_COMPRESS)`：
 *    **保持原图比例不裁剪**，长边压到 ≤1280、体积压到 ≤800 KB（远低于后端 2MB 上限）。
 */
async function chooseShopImage(): Promise<void> {
  const picked = await chooseAndCompressImage(SHOP_IMAGE_COMPRESS)
  if (!picked) return // 用户取消选择
  uploading.value = true
  try {
    form.value.shopImage = await uploadFile(picked.path)
    uni.showToast({ title: '门店图片已上传', icon: 'success' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

/**
 * 身份证正/反面照：选图 → **自动压缩** → 上传（`/api/common/upload`）→ 回填对应字段。
 *
 * 后端字段是**申请层**的 `idCardFrontImage` / `idCardBackImage`
 * （不是门店层，也不是提现的 `idCardFrontUrl`）。
 * ⚠️ 2026-10-01：压缩策略用 `CERTIFICATE_IMAGE_COMPRESS`（长边 ≤1600、≤1000 KB）
 * —— 证件要能看清文字，所以比门店图放宽一档。
 */
async function chooseIdCardImage(side: 'front' | 'back'): Promise<void> {
  const picked = await chooseAndCompressImage(CERTIFICATE_IMAGE_COMPRESS)
  if (!picked) return // 用户取消选择
  uploading.value = true
  try {
    const url = await uploadFile(picked.path)
    if (side === 'front') form.value.idCardFrontImage = url
    else form.value.idCardBackImage = url
    uni.showToast({ title: side === 'front' ? '身份证正面已上传' : '身份证反面已上传', icon: 'success' })
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : '上传失败', icon: 'none' })
  } finally {
    uploading.value = false
  }
}

/** 提交入驻申请。 */
async function submit(): Promise<void> {
  brandError.value = ''
  if (!form.value.brandName.trim()) { uni.showToast({ title: '请输入品牌名称', icon: 'none' }); return }
  if (!form.value.shopName.trim()) { uni.showToast({ title: '请输入门店名称', icon: 'none' }); return }
  if (form.value.latitude == null || form.value.longitude == null) {
    uni.showToast({ title: '请先选择门店位置（必须选点）', icon: 'none' })
    return
  }
  // 联系电话（2026-10-10 新增必填 + 底线校验，对接文档 §五 的审核前置条件）：
  // 后端 `approve` 会用**申请单**的 `contactPhone` / `idCard` 生成初始密码 ⇒
  // 「去掉非数字后不足 4 位」时**审核直接失败并整场回滚**（品牌/门店/账号/绑定都不落库）。
  // ⚠️ 这里**只卡后端的底线**（≥4 位数字），不加严成"必须 11 位手机号" ——
  //    加严会拦下后端本来会收的申请（§五 只要求"有联系电话且够 4 位"）。
  if (!form.value.contactPhone.trim()) {
    uni.showToast({ title: '请输入联系电话', icon: 'none' })
    return
  }
  const phoneResult = validateApplyContactPhone(form.value.contactPhone)
  if (!phoneResult.ok) {
    uni.showToast({ title: phoneResult.message || '联系电话格式不正确', icon: 'none' })
    return
  }
  // 门店图片必填（2026-09-22 需求）：审核方要能看到门店实际长什么样，光有地址与坐标不够
  if (!form.value.shopImage) {
    uni.showToast({ title: '请上传门店图片', icon: 'none' })
    return
  }
  // 身份证：号 + 正反面照（2026-09-23 按 api_doc 补）。
  // ⚠️ 后端 `required` 只列了 `brandName`/`shop`，不传接口**不会**拒；但审核方要据此核验身份，
  // 且接口描述明确写了"提交时需填写身份证号及身份证正反面照"⇒ 前端按必填处理。
  // ⚠️ 两道校验，顺序固定（2026-10-10）：
  //    ① `validateApplyIdCardFloor`＝后端**审核前置条件**（§五：去空格后 ≥ 4 位，不够则审核必失败并回滚）；
  //    ② `validateIdCard`＝我们**自家更严**的规则（18 位 + 出生日期 + 校验位）。
  //    先过底线再收紧：万一将来有人把 ② 换宽松（或整段换掉），① 仍保证提交值不低于后端底线。
  const idCardFloor = validateApplyIdCardFloor(form.value.idCard)
  if (!idCardFloor.ok) {
    uni.showToast({ title: idCardFloor.message || '请输入身份证号', icon: 'none' })
    return
  }
  const idCardResult = validateIdCard(form.value.idCard)
  if (!idCardResult.ok) {
    uni.showToast({ title: idCardResult.message || '身份证号格式不正确', icon: 'none' })
    return
  }
  if (!form.value.idCardFrontImage || !form.value.idCardBackImage) {
    uni.showToast({ title: '请上传身份证正反面照片', icon: 'none' })
    return
  }
  // 商户级让利比例（选填）：越界**在本地就拦**，用后端 13018 同一句话（文案单一出口在 utils）。
  const commissionError = validateMerchantCommissionRate(form.value.commissionRate)
  if (commissionError) {
    uni.showToast({ title: commissionError, icon: 'none' })
    return
  }
  // 只有「解析出有效值」才会把这个键放进请求体（留空 ⇒ unset ⇒ 不加键 ⇒ 后端用平台默认）。
  const commissionParsed = parseMerchantCommissionRateInput(form.value.commissionRate)
  submitting.value = true
  try {
    apply.value = await submitMerchantApply({
      brandName: form.value.brandName.trim(),
      contactName: form.value.contactName.trim() || undefined,
      // ⚠️ 2026-10-10：提交**规范化后的纯数字**（`validateApplyContactPhone` 的返回值）——
      //    后端 §四 本来就会"去除非数字后取后 4 位"生成初始密码，前端先把同一个值算好，
      //    保证「前端认为够 4 位」与「后端拿来推导的串」是同一个（不是两次不同的清洗）。
      contactPhone: phoneResult.value,
      shop: {
        name: form.value.shopName.trim(),
        address: form.value.address.trim() || undefined,
        latitude: form.value.latitude,
        longitude: form.value.longitude,
        mainBusiness: form.value.mainBusiness.trim() || undefined,
        // 门店图片（需后端在 ShopPart 补该字段并在建店时映射到 ShopCreateDTO.shopImage，见 MerchantApplyShopDTO 注释）
        shopImage: form.value.shopImage || undefined,
      },
      licenseImage: form.value.licenseImage || undefined,
      // 身份证（**申请层**字段，不在 `shop` 里）：号用校验后的规范值（去空格、末位 X 大写）
      idCard: idCardResult.value,
      idCardFrontImage: form.value.idCardFrontImage,
      idCardBackImage: form.value.idCardBackImage,
      // 商户级让利比例：**有条件地**加这个键 —— 留空时展开的是 `{}`，请求体里**没有** commissionRate
      // （后端按平台默认结算）。⛔ 绝不给它兜底成 `0` / `null` —— 那是伪造数据。
      ...(commissionParsed.kind === 'value' ? { commissionRate: commissionParsed.value } : {}),
      remark: form.value.remark.trim() || undefined,
    })
    showForm.value = false
    uni.showToast({ title: '已提交，请等待审核', icon: 'success' })
    await loadApply()
  } catch (error) {
    const code = error instanceof ApiRequestError ? error.code : undefined
    // ⚠️ 2026-10-10（对接文档 §六）：**审核**接口的四种报错（缺资料回滚 / 该商户已有后台账号 /
    //    登录名撞名 / 重复审核幂等）都发生在 `approve` 上，而那个入口在**中控后台**（本小程序不调它）
    //    ⇒ 本页不可能是它们的展示面（真实展示面 = 中控，不属本次改动范围）。
    //    这里遵守同一条原则：**只对契约写明的"提交类"错误码给本地文案**
    //    （7315 已有审核中 / 7316 微信已属其它商家 / 13018 让利比例越界 / 7311 品牌重名），
    //    其余一律把后端 `message` **原样**透出 —— ⛔ 不按码改写、不吞掉详情
    //    （§六 那种"报错里带已存在登录名"的信息正是靠这条原样透出才不会被吃掉）。
    const message = error instanceof Error ? error.message : '提交失败'
    if (code === 7315) {
      // 已有审核中的申请：直接刷新为状态卡，不报错弹窗
      uni.showToast({ title: '已有审核中的申请', icon: 'none' })
      await loadApply()
    } else if (code === 7316) {
      uni.showModal({ title: '无法入驻', content: '该微信已属于其它商家，如需变更请联系客服。', showCancel: false })
    } else if (code === MERCHANT_COMMISSION_RATE_ERROR_CODE) {
      // 后端 13018：与本地校验同一句话（文案单一出口在 utils/product-commission.ts，不在这里重写）
      uni.showToast({ title: MERCHANT_COMMISSION_RATE_RANGE_TEXT, icon: 'none' })
    } else if (code === 7311) {
      brandError.value = message || '品牌名已存在，请更换'
    } else {
      uni.showToast({ title: message, icon: 'none' })
    }
  } finally {
    submitting.value = false
  }
}

/** 返回上一页：审核通过后用户可在「我的身份」进入门店管理（**不依赖后台账号是否已开通**）。 */
function goBack(): void {
  uni.navigateBack()
}
</script>

<template>
  <view class="page" :style="{ paddingTop: contentTop + 'px' }">
    <!-- 自定义导航栏：本页用 navigationStyle: custom，需自行避开状态栏与右上角胶囊 -->
    <view class="nav" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">商家入驻</text>
      </view>
    </view>

    <view v-if="loading" class="tip">加载中…</view>

    <template v-else>
      <!-- 状态卡：待审核 / 已通过 -->
      <view v-if="apply && !showForm" class="card">
        <view class="card-head">
          <text class="card-title">申请状态</text>
          <text class="status" :class="`status-${apply.status}`">{{ statusText }}</text>
        </view>
        <view class="row"><text class="label">品牌名称</text><text class="value">{{ apply.brandName || '—' }}</text></view>
        <view class="row"><text class="label">首店名称</text><text class="value">{{ apply.shopName || '—' }}</text></view>
        <!-- 登录名（工号）：审核通过后由后端**自动生成**（规则 = M + 商户ID，见 utils/merchant-console.ts），
             不再由客服口头告知 ⇒ 拿到就显示，没拿到就不显示（⛔ 不编一个工号）。 -->
        <view class="row" v-if="apply.accountUsername"><text class="label">登录名（工号）</text><text class="value">{{ apply.accountUsername }}</text></view>
        <view class="row" v-if="apply.applyTime"><text class="label">提交时间</text><text class="value">{{ apply.applyTime }}</text></view>
        <view class="row" v-if="apply.auditTime"><text class="label">审核时间</text><text class="value">{{ apply.auditTime }}</text></view>

        <!-- 上次驳回原因（驳回后重新提交、待审核状态仍展示） -->
        <view v-if="apply.status === 0 && apply.previousRejectReason" class="reject-box">
          <text class="reject-title">上次驳回原因</text>
          <text class="reject-text">{{ apply.previousRejectReason }}</text>
        </view>

        <text class="hint">{{ statusHint }}</text>
        <!-- 审核通过即可进门店管理（走店长身份、**免工号**）；后台账号只影响"能不能登电脑端/核销页"，
             不作为小程序入口的前置条件（详见 statusHint 的两种分支说明）。 -->
        <button v-if="apply.status === 1" class="btn" @click="goBack">去「我的身份」进入门店管理</button>
      </view>

      <!-- 表单：未申请过 / 已驳回重提 -->
      <view v-else class="card">
        <text class="card-title">商家入驻申请</text>
        <!-- ⚠️ 2026-10-10 改写（对接文档 §八-2）：旧句「商家工号（登录 PC 控制台用）由客服另行发放」
             的前提**已消失** —— 审核通过时后端**自动**开好核销页与商户后台两个账号（同名同初始密码）。
             ⚠️ 这里**不复述规则**（登录名 = M + 商户ID、密码怎么推）：规则单一来源在
                utils/merchant-console.ts，本页只指路，避免两处文案各自漂移（契约也钉住了这一点）。 -->
        <text class="hint">提交后由平台客服审核。审核通过后，系统会自动生成电脑端后台的登录名与初始密码（登录地址与规则见「商家工作台 → 电脑端后台」），并可到「我的 → 我的身份」进入门店管理。</text>

        <!-- 驳回后重提：显示上次驳回原因 -->
        <view v-if="apply && apply.status === 2" class="reject-box">
          <text class="reject-title">驳回原因</text>
          <text class="reject-text">{{ apply.auditRemark || '请按平台要求修改后重新提交' }}</text>
        </view>

        <label class="field">
          <text class="field-label">品牌名称 *</text>
          <input v-model="form.brandName" class="field-input" placeholder="如：金花优（全局唯一）" @input="brandError = ''" />
          <text v-if="brandError" class="field-error">{{ brandError }}</text>
        </label>
        <label class="field"><text class="field-label">首店名称 *</text><input v-model="form.shopName" class="field-input" placeholder="如：金花优张江店" /></label>

        <!-- 门店位置：必须微信选点（后端坐标必填） -->
        <view class="field">
          <text class="field-label">门店位置 *（必须选点，用于配送范围与骑手取货）</text>
          <button class="location-btn" @click="chooseShopLocation">{{ form.latitude == null ? '选择门店位置' : '重新选择位置' }}</button>
          <text v-if="form.latitude != null" class="location-text">已选：{{ form.address || form.shopName }}（{{ form.latitude.toFixed(6) }}, {{ form.longitude?.toFixed(6) }}）</text>
          <text v-else class="field-error">尚未选择位置，提交前必须选点</text>
        </view>

        <label class="field"><text class="field-label">门店地址</text><input v-model="form.address" class="field-input" placeholder="选点后自动回填，可微调" /></label>
        <label class="field"><text class="field-label">主营类目</text><input v-model="form.mainBusiness" class="field-input" placeholder="如：餐饮 / 便利店" /></label>
        <label class="field"><text class="field-label">联系人</text><input v-model="form.contactName" class="field-input" placeholder="请输入联系人姓名" /></label>
        <!-- 联系电话（2026-10-10 改为**必填**，对接文档 §五）：后端审核通过时用它 + 身份证号生成
             两个账号的初始密码 ⇒ 没有它（或去非数字后不足 4 位）时**审核会直接失败并回滚**。
             ⚠️ 提交前的底线校验在 `submit()`（`validateApplyContactPhone`）；这里**不复述密码规则**
                （规则单一来源在 utils/merchant-console.ts），只说明这个号码被用在哪。
             ⚠️ `maxlength` 放宽到 20：§五 的底线只是"去除非数字后 ≥ 4 位数字"，
                写死 11 会把固话（如 0571-88889999）挡在门外 —— 那是加严，不是对接文档的要求。 -->
        <label class="field">
          <text class="field-label">联系电话 *</text>
          <input v-model="form.contactPhone" class="field-input" type="number" maxlength="20" placeholder="请输入联系电话" />
          <text class="field-hint">用于平台联系你，也用于生成电脑端后台的初始密码</text>
        </label>

        <!-- 门店图片（2026-09-22 需求）：有门店就必须上传，审核方据此核对门店真实性 -->
        <view class="field">
          <text class="field-label">门店图片 *</text>
          <view class="license-row">
            <image v-if="form.shopImage" class="license-img" :src="form.shopImage" mode="aspectFit" @click="chooseShopImage" />
            <button class="license-btn" :disabled="uploading" @click="chooseShopImage">{{ uploading ? '上传中…' : (form.shopImage ? '重新上传' : '上传门店图片') }}</button>
          </view>
          <text class="field-hint">门头或店内实拍，建议 690×345、小于 2MB</text>
        </view>

        <view class="field">
          <text class="field-label">营业执照</text>
          <view class="license-row">
            <image v-if="form.licenseImage" class="license-img" :src="form.licenseImage" mode="aspectFit" @click="chooseLicense" />
            <button class="license-btn" :disabled="uploading" @click="chooseLicense">{{ uploading ? '上传中…' : (form.licenseImage ? '重新上传' : '上传营业执照') }}</button>
          </view>
        </view>

        <!-- 身份证（2026-09-23 按 api_doc 补）：号 + 正反面照。审核方据此核验身份，故前端标必填 -->
        <label class="field">
          <text class="field-label">身份证号 *</text>
          <input v-model="form.idCard" class="field-input" maxlength="18" placeholder="请输入 18 位身份证号" />
        </label>
        <view class="field">
          <text class="field-label">身份证正面照 *（人像面）</text>
          <view class="license-row">
            <image v-if="form.idCardFrontImage" class="license-img" :src="form.idCardFrontImage" mode="aspectFit" @click="chooseIdCardImage('front')" />
            <button class="license-btn" :disabled="uploading" @click="chooseIdCardImage('front')">{{ uploading ? '上传中…' : (form.idCardFrontImage ? '重新上传' : '上传人像面') }}</button>
          </view>
        </view>
        <view class="field">
          <text class="field-label">身份证反面照 *（国徽面）</text>
          <view class="license-row">
            <image v-if="form.idCardBackImage" class="license-img" :src="form.idCardBackImage" mode="aspectFit" @click="chooseIdCardImage('back')" />
            <button class="license-btn" :disabled="uploading" @click="chooseIdCardImage('back')">{{ uploading ? '上传中…' : (form.idCardBackImage ? '重新上传' : '上传国徽面') }}</button>
          </view>
          <text class="field-hint">仅用于平台资质核验</text>
        </view>

        <!-- 商户级让利比例（选填）：留空 ⇒ 该字段整个不提交 ⇒ 后端按平台默认结算（不是 0，也不是"不参与结算"） -->
        <label class="field">
          <text class="field-label">让利比例（%）</text>
          <input v-model="form.commissionRate" class="field-input" type="digit" :placeholder="MERCHANT_COMMISSION_RATE_INPUT_PLACEHOLDER" />
          <text class="field-hint">{{ MERCHANT_COMMISSION_RATE_OPTIONAL_NOTE }}</text>
          <text class="field-hint">{{ MERCHANT_COMMISSION_RATE_SNAPSHOT_NOTE }}</text>
        </label>

        <label class="field"><text class="field-label">申请备注</text><input v-model="form.remark" class="field-input" placeholder="可选，如：希望尽快审核" /></label>

        <button class="btn" :disabled="submitting" @click="submit">{{ submitting ? '提交中…' : '提交申请' }}</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
/* 自定义导航栏：固定顶部，标题靠左（右侧留给微信胶囊按钮，避免遮挡） */
.nav { position: fixed; top: 0; right: 0; left: 0; z-index: 20; background: #f6f7f9; }
.nav-inner { display: flex; align-items: center; height: 44px; padding: 0 24rpx; }
.nav-back { width: 56rpx; color: #1d2129; font-size: 46rpx; line-height: 1; }
.nav-title { color: #1d2129; font-size: 34rpx; font-weight: 600; }
.page { min-height: 100vh; padding: 24rpx; box-sizing: border-box; background: #f6f7f9; }
.tip { padding: 80rpx 0; color: #86909c; font-size: 28rpx; text-align: center; }
.card { padding: 32rpx; border-radius: 20rpx; background: #fff; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { color: #1d2129; font-size: 34rpx; font-weight: 700; }
.status { font-size: 28rpx; font-weight: 600; }
.status-0 { color: #ff9500; }
.status-1 { color: #12a150; }
.status-2 { color: #e0432a; }
.hint { display: block; margin: 20rpx 0 8rpx; color: #86909c; font-size: 25rpx; line-height: 38rpx; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 20rpx 0; border-bottom: 1rpx solid #f2f4f7; }
.row:last-of-type { border-bottom: none; }
.label { color: #86909c; font-size: 26rpx; }
.value { color: #1d2129; font-size: 28rpx; }
.reject-box { margin: 20rpx 0 8rpx; padding: 20rpx 24rpx; border-radius: 16rpx; background: #fff2f0; }
.reject-title { display: block; margin-bottom: 8rpx; color: #e0432a; font-size: 26rpx; font-weight: 600; }
.reject-text { color: #e0432a; font-size: 26rpx; line-height: 38rpx; }
.field { display: block; margin-top: 24rpx; }
.field-label { display: block; margin-bottom: 10rpx; color: #4e5969; font-size: 26rpx; }
.field-input { width: 100%; height: 88rpx; padding: 0 24rpx; box-sizing: border-box; border: 1rpx solid #e5e6eb; border-radius: 16rpx; background: #fafbfc; color: #1d2129; font-size: 28rpx; }
.field-error { display: block; margin-top: 8rpx; color: #e0432a; font-size: 24rpx; }
.location-btn { margin: 0; border-radius: 16rpx; background: #f2f3f5; color: #1d2129; font-size: 28rpx; line-height: 80rpx; }
.location-text { display: block; margin-top: 12rpx; color: #12a150; font-size: 25rpx; line-height: 36rpx; }
.license-row { display: flex; align-items: center; gap: 20rpx; }
.license-img { width: 180rpx; height: 180rpx; border-radius: 16rpx; background: #f2f3f5; }
.license-btn { margin: 0; border-radius: 16rpx; background: #f2f3f5; color: #1d2129; font-size: 28rpx; line-height: 80rpx; }
/* 上传项的辅助说明（尺寸建议等），比主标签弱一档 */
.field-hint { display: block; margin-top: 12rpx; color: #86909c; font-size: 24rpx; line-height: 34rpx; }
.btn { margin-top: 40rpx; border-radius: 44rpx; background: linear-gradient(135deg, #ffb341 0%, #ff5500 100%); color: #fff; font-size: 30rpx; line-height: 88rpx; }
.btn[disabled] { opacity: .6; }
</style>
