<script setup lang="ts">
/**
 * 系统配置管理（平台级可调参数）。
 *
 * 依据：`docs/26/10.09/前端对接说明-商品级抽成与提现口径-2026-10-08.md` §2；
 *       接口权威：`api_doc.json` 的 `/api/admin/sys-config/list` 与 `/api/admin/sys-config/{key}`。
 *
 * ## 这个页面管什么
 * 运营可调的**平台级**参数（初始 5 项：平台默认让利比例 / 用户提现手续费率 / 提现门槛、
 * 每日累计上限、每日次数上限）。后端带**白名单 + 范围校验 + 留痕**（含修改前后值）。
 *
 * ## ⛔ 四条不许做（否则页面会"看起来能用其实不能用"）
 * 1. ⛔ **不在前端写死后端白名单**（不硬编码那 5 个键、也不硬编码 3~20 之类的范围）——
 *    白名单与范围**只认 `list` 返回的内容**；后端加项/改范围，本页自动跟着变。
 * 2. ⛔ 不构造 `list` 之外的 key（非白名单键后端一律拒绝，前端也不该给它入口）。
 * 3. ⛔ 不给读不到的值编默认值：后端没下发就显示「—」，**不做数值/百分比换算**
 *    （提现手续费率那类小数，后端给 `0.05` 就显示 `0.05`；若"贴心地"显示成 `5%`，
 *    运营照着页面填 `5` 就会把费率写成 500%）。
 * 4. ⛔ 不替用户填备注：`remark` 在 DTO 里可选，但每次修改都会**留痕**⇒
 *    本页把它**设为必填**（用户不填就拦下），**绝不**自动编一句"系统修改"之类的假备注。
 *
 * ## 角色
 * 后端：**仅 `SUPER_ADMIN` / `FINANCE` 可写**，其余角色只读（越权 `1004`）。
 * 前端：**不隐藏页面**，而是把输入控件禁用 + 说清原因（"禁用 + 说明"比"页面看着坏了/点不动"诚实）。
 *
 * ## ✅ 真实字段名（2026-10-09 用 dev 超管账号实测确认，详见 `api/sysConfig.ts` 顶部）
 * `key` / `type` / `min` / `max` / `defaultValue`（**number**，如 `3.00`）/
 * `currentValue`（**string**，如 `"3"`）/ `description` / `editable`（boolean）。
 * ⚠️ 一个 number、一个 string ⇒ 本页只经 `api` 层的归一化结果取值（`value` / `defaultValue` 都是
 *    `string | null`），**不在模板里直接对原始对象做算术**，避免 `NaN` / `undefined` 落进输入框。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getSysConfigList, updateSysConfig } from '@/api/sysConfig'
import { useAuthStore } from '@/stores/auth'
import { ROLE_LABELS } from '@/utils/permission'
import type { AdminRole } from '@/types/auth'
import type { SysConfigItem } from '@/types/sysConfig'

const authStore = useAuthStore()

const loading = ref(false)
const saving = ref(false)
const items = ref<SysConfigItem[]>([])
const loadError = ref('')

/** 修改弹窗。 */
const dialogVisible = ref(false)
const editing = ref<SysConfigItem | null>(null)
/**
 * 表单草稿。
 * ⚠️ 数字项与文本项分两个字段存：数字项用 `valueNumber`（才能挂 `:min` / `:max`），
 * 文本项用 `valueText`（原样字符串，不做任何解析）。
 */
const form = reactive<{ valueText: string; valueNumber: number | null; remark: string }>({
  valueText: '',
  valueNumber: null,
  remark: '',
})

/**
 * 当前角色是否可写（**展示层收敛**，与后端一致：超管 / 财务）。
 * ⚠️ 这只是"别给一个点了必然 1004 的按钮"；真正的拦截在后端。
 */
const canWrite = computed(() => authStore.role === 'SUPER_ADMIN' || authStore.role === 'FINANCE')

/** 当前角色中文（用于只读原因）。 */
const roleLabel = computed(() => ROLE_LABELS[authStore.role as AdminRole] || authStore.role || '未知角色')

/** 可写项数量（概览用）。 */
const writableCount = computed(() => items.value.filter((item) => item.writable && item.keyRecognized).length)

/**
 * 已知配置键的**展示提示**（可选、纯文案）。
 * ⚠️ 这只是"按名字加的解释"，**不参与判定可写性/范围/取值**；
 * 未知键（后端将来新增的）走通用渲染 —— 不认识的键照样显示、照样能改。
 */
const KEY_HINTS: Record<string, string> = {
  platform_commission_rate: '平台默认让利比例（%，当前口径 3%）：商户/商品未单独设置时按它结算；只影响之后新下的订单',
  withdraw_fee_rate: '用户提现手续费率。⚠️ 后端用**小数**（如 0.05 = 5%），本页按原值显示、不做百分比换算',
  withdraw_min_amount: '用户单笔提现最低金额（元）',
  withdraw_daily_amount_limit: '用户每日累计提现上限（元）',
  withdraw_daily_count_limit: '用户每日提现次数上限（次）',
  // ---- 释放期天数（2026-10-09 新增 4 项，初始默认 7 / 7 / 3 / 1）----
  // 口径（见 `docs/26/10.09/前端总对接文档-2026-10-09.md` §四）：
  // 释放期天数**只影响新产生的结算/收益**（写入即固化，存量不重算）。
  // ⚠️ 这里只写"这项是什么"，取值与范围仍旧只认后端 `list`（本页不写死任何值/范围）。
  release_logistics_days: '物流单（快递发货）的**资金释放期天数**，初始默认 7。⚠️ 只影响新产生的结算（写入即固化，存量不重算）',
  release_same_city_days: '同城配送·**普通单**的资金释放期天数，初始默认 7。⚠️ 只影响新产生的结算（写入即固化，存量不重算）',
  release_same_city_fresh_days: '同城配送·**生鲜单**的资金释放期天数，初始默认 3。⚠️ 只影响新产生的结算（写入即固化，存量不重算）',
  release_pickup_days: '**自提单**（到店核销）的资金释放期天数，初始默认 1。⚠️ 只影响新产生的结算（写入即固化，存量不重算）',
  // ---- 骑手钱包开关（2026-10-10 新增，初始默认 0 = 关闭）----
  // 依据：`docs/26/10.10/前端对接文档-同城物流风险整改5项-2026-10-10.md` §三。
  // ⚠️ 本页从 `GET /api/admin/sys-config/list` **动态渲染**、白名单只认后端 ⇒ 这里**只加提示文案**，
  //    绝不把该键写进任何列表 / 判定（见文件头「四条不许做」第 1 条）。
  rider_wallet_enabled: '骑手钱包（骑手收入入账与提现）；关闭时骑手收入不写入任何钱包科目，骑手端收入接口返回 13027',
}

/** 取某个键的展示提示（未知键返回空串 ⇒ 通用渲染）。 */
function keyHint(key: string): string {
  return KEY_HINTS[key] || ''
}

/** 数字项判定：后端**同时**给了最小/最大值，且类型或取值看着是数字。 */
function isNumericItem(item: SysConfigItem): boolean {
  if (item.min === null || item.max === null) return false
  const probe = item.value ?? item.defaultValue
  if (probe !== null && probe !== '' && Number.isFinite(Number(probe))) return true
  return /int|decimal|number|float|double|long|short|integer/i.test(item.type)
}

/**
 * 小数位数（从后端给的值里推导：`3.00` → 2；推不出来时退回后端下发的类型）。
 * ⚠️ 实测：`defaultValue` 是 **number**（`3.00`）、`currentValue` 是 **string**（`"3"`）——
 *    JSON 把 `3.00` 解析成 `3`（尾随零丢失）⇒ **光看值**会把 DECIMAL 项推成 0 位小数，
 *    而 `:precision="0"` 会把运营填的 `3.5` 直接四舍五入掉。
 *    类型（`DECIMAL` / `INT`）是后端**下发的事实**，故 DECIMAL 类至少给 2 位小数
 *    （只决定输入框允许几位，**不猜也不改**提交的值）。
 */
function decimalsOf(item: SysConfigItem): number {
  const probes = [item.value, item.defaultValue]
  let decimals = 0
  for (const probe of probes) {
    const text = String(probe ?? '')
    const dot = text.indexOf('.')
    if (dot >= 0) decimals = Math.max(decimals, Math.min(6, text.length - dot - 1))
  }
  if (decimals === 0 && /decimal|double|float/i.test(item.type)) return 2
  return decimals
}

/** 步进值：按小数位推导（2 位小数 ⇒ 0.01），纯交互便利，**不改变提交的值**。 */
function stepOf(item: SysConfigItem): number {
  const decimals = decimalsOf(item)
  return decimals > 0 ? Number((1 / 10 ** decimals).toFixed(decimals)) : 1
}

/** 范围文案（后端给什么写什么；没给就说没给 —— 不猜）。 */
function rangeText(item: SysConfigItem): string {
  if (item.min === null && item.max === null) return '—（后端未给出范围）'
  if (item.min === null) return `≤ ${item.max}`
  if (item.max === null) return `≥ ${item.min}`
  return `${item.min} ~ ${item.max}`
}

/** 值展示（`null` ⇒ 「—」，并标注后端未下发）。 */
function valueText(value: string | null): string {
  return value === null ? '—' : value
}

/**
 * 当前值 → 修改弹窗里的**输入框文本**（number / string 混用下的唯一入口）。
 *
 * ⚠️ 后端 `defaultValue` 是 number、`currentValue` 是 string（2026-10-09 实测）；
 *    两者在 `api` 层已被统一成 `string | null`，这里再兜一层：拿不到就留**空串**（显示为空），
 *    **绝不**回退成 `"0"` / `"NaN"` —— 输入框里的每个字符都会被当作运营的输入提交给后端。
 */
function inputTextOf(item: SysConfigItem): string {
  return item.value === null ? '' : String(item.value)
}

/** 当前值是否与默认值不同（提醒"这项被改过"；后端没给默认值时不下结论）。 */
function isChanged(item: SysConfigItem): boolean {
  if (item.value === null || item.defaultValue === null) return false
  return item.value !== item.defaultValue
}

/** 拉取白名单配置项。 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    items.value = await getSysConfigList()
  } catch (error) {
    // ⚠️ 失败**不渲染成"没有可配置项"**（那是两种完全不同的结论）
    items.value = []
    loadError.value = error instanceof Error ? error.message : '系统配置查询失败'
  } finally {
    loading.value = false
  }
}

/** 打开修改弹窗（⚠️ 后端 `writable` 与当前角色可写**两者都要满足**）。 */
function openEdit(item: SysConfigItem): void {
  if (!item.keyRecognized || !item.writable || !canWrite.value) return
  editing.value = item
  // ⚠️ 草稿只回填**当前值**，拿不到就留空（**不回填默认值**）——
  //    把默认值预填进输入框等于替后端"猜"一个当前值：运营一路点保存就会把它写进去，
  //    而后端留痕里会记成"运营主动改成了该值"（本项目硬原则：不伪造数据）。
  // ⚠️ 文本与数字两个控件都从**同一个** `inputTextOf` 结果派生 ⇒ 不会出现"文本框有值、数字框 NaN"。
  const base = inputTextOf(item)
  form.valueText = base
  form.valueNumber = base !== '' && Number.isFinite(Number(base)) ? Number(base) : null
  form.remark = ''
  dialogVisible.value = true
}

/**
 * 提交修改。
 * - `value` 按**字符串**提交（`api_doc` 的 `UpdateBody.value` 就是 string）；数字项按推导出的小数位格式化；
 * - `remark` 前端必填（DTO 里可选 ⇒ 填了才传，不填就拦下，**不编造**）。
 */
async function submitEdit(): Promise<void> {
  const target = editing.value
  if (!target) return
  if (!target.keyRecognized || !target.key) {
    ElMessage.warning('该行未识别出配置键，无法提交（请让后端确认 list 的字段名）')
    return
  }
  const remark = form.remark.trim()
  if (!remark) {
    ElMessage.warning('请填写变更原因：每次修改都会留痕（含修改前后值），原因会写入审计')
    return
  }
  let value: string
  if (isNumericItem(target)) {
    if (form.valueNumber === null || !Number.isFinite(form.valueNumber)) {
      ElMessage.warning('请填写新的数值')
      return
    }
    value = form.valueNumber.toFixed(decimalsOf(target))
  } else {
    value = form.valueText.trim()
    if (!value) {
      ElMessage.warning('请填写新的值（留空不等于"清除"，后端只接受具体值）')
      return
    }
  }

  saving.value = true
  try {
    await updateSysConfig(target.key, { value, remark })
    ElMessage.success(`已保存：${target.key} = ${value}`)
    dialogVisible.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '配置项保存失败')
  } finally {
    saving.value = false
  }
}

/** 「原始数据」折叠区内容：`list` 的原样返回（字段名与预期不符时的唯一真相）。 */
const rawJson = computed(() => JSON.stringify(items.value.map((item) => item.raw), null, 2))

/** 是否存在"未识别出 key"的行（有就提示，别让运营对着空白猜）。 */
const hasUnrecognized = computed(() => items.value.some((item) => !item.keyRecognized))

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="page-container page-enter">
    <div class="page-heading">
      <div>
        <h1>系统配置管理</h1>
        <p>
          平台级可调参数（平台默认让利比例、用户提现手续费率与提现门槛等）。
          每次修改后端都会<strong>校验范围</strong>并<strong>留痕</strong>（含修改前后值）。
        </p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 读权限说明：只读不是"页面坏了"，而是后端只允许超管/财务写入 -->
    <el-alert v-if="!canWrite" type="warning" :closable="false" show-icon class="block">
      <template #title>当前角色（{{ roleLabel }}）在本页只能查看，不能修改</template>
      <p class="hint">
        后端约定：<strong>仅「平台管理员」与「财务」可以修改配置项</strong>（其余角色写入会返回 <code>1004</code>）。
        所以这里的输入控件是<strong>禁用</strong>的（而不是把页面藏起来）—— 你能看到当前值与默认值，
        需要调整时请让超管或财务操作。修改会记入审计留痕。
      </p>
    </el-alert>

    <!-- 接口报错：不渲染成"没有可配置项" -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="block">
      <template #title>查询失败，本次结果不可用</template>
      <p class="hint">{{ loadError }}</p>
      <p class="hint">这不等于"平台没有可配置项"—— 请确认后端版本是否已包含 <code>GET /api/admin/sys-config/list</code>。</p>
    </el-alert>

    <template v-if="!loadError">
      <el-card shadow="never" class="block">
        <div class="summary">
          <span>白名单配置项：<strong>{{ items.length }}</strong> 项</span>
          <span>其中可写：<strong>{{ writableCount }}</strong> 项</span>
          <span class="hint inline">只渲染后端白名单返回的项；非白名单键后端一律拒绝</span>
        </div>
        <p v-if="hasUnrecognized" class="hint danger-text">
          有配置项没识别出<strong>配置键</strong>（见下表「配置项」列的提示）—— 这类行只读展示，不提供修改入口。
          后端 `list` 的字段名没有契约（出参是 <code>Map</code>），请对照页底「原始数据」让后端确认字段名。
        </p>
        <p class="hint">
          ⚠️ 值与默认值都<strong>按后端原样显示</strong>（不做百分比/单位换算）：
          例如手续费率后端给的是小数 <code>0.05</code>（= 5%），页面上就显示 <code>0.05</code>。
        </p>
      </el-card>

      <el-card shadow="never" class="block">
        <el-table v-loading="loading" :data="items" row-key="key" border stripe>
          <el-table-column label="配置项" min-width="300">
            <template #default="{ row }">
              <div class="cfg-cell">
                <div class="cfg-key">
                  <code v-if="row.keyRecognized">{{ row.key }}</code>
                  <el-tag v-else type="danger" size="small">未识别出配置键</el-tag>
                  <el-tag v-if="row.type" size="small" effect="plain">{{ row.type }}</el-tag>
                  <el-tag v-if="isChanged(row)" size="small" type="warning">已改过（≠ 默认值）</el-tag>
                </div>
                <div v-if="row.description" class="cfg-desc">{{ row.description }}</div>
                <div v-if="keyHint(row.key)" class="cfg-hint">{{ keyHint(row.key) }}</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="取值范围" min-width="140">
            <template #default="{ row }">{{ rangeText(row) }}</template>
          </el-table-column>
          <el-table-column label="默认值" min-width="110">
            <template #default="{ row }">{{ valueText(row.defaultValue) }}</template>
          </el-table-column>
          <el-table-column label="当前值" min-width="110">
            <template #default="{ row }"><strong>{{ valueText(row.value) }}</strong></template>
          </el-table-column>
          <el-table-column label="是否可写" min-width="150">
            <template #default="{ row }">
              <el-tag v-if="!row.writable" type="info" size="small">后端标记为不可写</el-tag>
              <el-tag v-else-if="!canWrite" type="warning" size="small">后端可写，当前角色只读</el-tag>
              <el-tag v-else type="success" size="small">可写</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <!-- ⚠️ 非写入角色：**渲染禁用按钮**并给出原因（而不是把按钮藏掉）——
                   "藏掉"会让运营以为平台没提供这项功能；"禁用 + 说明"才是诚实的表达。 -->
              <template v-if="row.writable && row.keyRecognized">
                <el-button size="small" type="primary" :disabled="!canWrite" @click="openEdit(row)">修改</el-button>
                <span v-if="!canWrite" class="cell-muted readonly-note">只读</span>
              </template>
              <span v-else class="cell-muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !items.length" description="后端白名单里没有可配置项" />
      </el-card>

      <!-- 原始数据：字段名与预期不符时的唯一真相（不做任何加工） -->
      <el-card shadow="never" class="block">
        <el-collapse>
          <el-collapse-item name="raw" title="原始数据（GET /api/admin/sys-config/list 原样返回）">
            <p class="hint">
              本接口出参是 <code>Map&lt;String,Object&gt;</code>（api_doc 里 <strong>schema 为空</strong>），
              字段名没有契约 ⇒ 前端按多别名读取，并把原始对象原样展示在这里。
              若某行显示「未识别出配置键」，请以本区为准与后端核对字段名（不要在页面上手填键名）。
            </p>
            <pre class="raw-json">{{ rawJson }}</pre>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </template>

    <!-- 修改弹窗 -->
    <el-dialog v-model="dialogVisible" title="修改配置项" width="560px" append-to-body>
      <template v-if="editing">
        <el-form label-width="96px">
          <el-form-item label="配置项">
            <code>{{ editing.key }}</code>
            <el-tag v-if="editing.type" size="small" effect="plain" class="ml">{{ editing.type }}</el-tag>
          </el-form-item>
          <el-form-item v-if="editing.description" label="说明">
            <span>{{ editing.description }}</span>
          </el-form-item>
          <el-form-item label="取值范围">
            <span>{{ rangeText(editing) }}</span>
            <span class="hint inline">（后端校验；越界会返回参数错误）</span>
          </el-form-item>
          <el-form-item label="当前值">
            <span><strong>{{ valueText(editing.value) }}</strong>（默认值 {{ valueText(editing.defaultValue) }}）</span>
          </el-form-item>
          <el-form-item label="新值">
            <!-- 数字项：范围**取自后端**（不写死）；文本项：原样字符串 -->
            <el-input-number
              v-if="isNumericItem(editing)"
              v-model="form.valueNumber"
              :min="editing.min ?? undefined"
              :max="editing.max ?? undefined"
              :precision="decimalsOf(editing)"
              :step="stepOf(editing)"
              controls-position="right"
              class="value-input"
            />
            <el-input v-else v-model="form.valueText" class="value-input" clearable />
            <p class="hint">
              提交时按<strong>字符串</strong>原值传给后端（不换算单位）。
              手续费率一类的小数请直接填小数（如 <code>0.05</code> = 5%）。
            </p>
          </el-form-item>
          <el-form-item label="变更原因">
            <el-input v-model="form.remark" placeholder="必填：本次修改的原因（写入审计留痕）" clearable maxlength="100" show-word-limit />
            <p class="hint">
              接口文档里 `remark` 是<strong>可选</strong>的，但每次修改都会留痕（含修改前后值），
              所以本页<strong>要求填写</strong>：不会替你编一句默认原因。
            </p>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; }
.ml { margin-left: 8px; }
.hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.hint.inline { margin: 0; }
.danger-text { color: var(--el-color-danger); }
.summary { display: flex; flex-wrap: wrap; gap: 22px; align-items: baseline; font-size: 13px; }
.cfg-cell { display: flex; flex-direction: column; gap: 4px; line-height: 1.6; }
.cfg-key { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.cfg-desc { color: var(--el-text-color-regular); font-size: 13px; }
.cfg-hint { color: var(--el-text-color-secondary); font-size: 12px; }
.cell-muted { color: var(--el-text-color-secondary); }
.readonly-note { margin-left: 8px; font-size: 12px; }
.value-input { width: 240px; }
.raw-json {
  max-height: 320px;
  margin: 8px 0 0;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
}
</style>
