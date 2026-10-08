/**
 * 收货坐标的**来源**白名单（前端唯一真源）。
 *
 * 背景（2026-10-08 P1 履约事故 + 后端回执《配送试算坐标 fail-closed》）：
 * 同城配送的「能不能送」由后端按**收货坐标**判定（LOCAL 渠道不解析 `address` 文本）。
 * 只要请求里有一个"看起来合法"的裸坐标，后端就无从分辨它是**用户在地图上真选的**，
 * 还是前端拿「当前位置 / 发货门店坐标」兜底编出来的 —— 后者必然判为可送，超范围也能下单。
 * ⇒ 后端采纳「方案 A」：`coordinateSource` **必填**，只认下面这两个白名单值
 *   （大小写 / 首尾空白不敏感），**缺失或任何其它值一律 fail-closed**
 *   （试算 `canDelivery=false` + `failCode=NO_COORDINATE`；下单抛 `13026`）。
 *
 * ⛔ 绝不伪造来源：来源必须**如实**描述坐标是哪里来的。
 *   - `MAP_PICK`：用户在小程序里**明确点了地图选点**（`uni.chooseLocation`）；
 *   - `WECHAT_ADDRESS`：微信地址接口**真的返回了坐标**（当前微信原生地址接口不返回经纬度，
 *     所以前端**不会**写这个值；保留在白名单里是为了将来真有坐标时能如实上报）。
 *   ⚠️ 自动定位（`uni.getLocation`）拿到的是"用户当前站在哪"，与用户随后填写的收货地址**无关**
 *      ⇒ 它的来源只能是 `AUTO_LOCATE`，**不在白名单里**，因此**不得**用它的坐标做同城判定。
 *
 * ⛔ 与坐标**同生同灭**（all-or-nothing）：有坐标必须有来源，没有坐标就必须没有来源。
 *   任何一半缺失都按「**没有坐标**」处理（宁可让用户去地图选点，也绝不发无来源坐标）。
 */

/** 地图选点（`uni.chooseLocation`）—— 用户明确选中的收货点。 */
export const COORDINATE_SOURCE_MAP_PICK = 'MAP_PICK'
/** 微信地址（`uni.chooseAddress`）**自带真实坐标**时才可用；当前该接口不返回坐标，故前端不写此值。 */
export const COORDINATE_SOURCE_WECHAT_ADDRESS = 'WECHAT_ADDRESS'

/** 可信来源（与后端白名单一致）。 */
export type CoordinateSource = typeof COORDINATE_SOURCE_MAP_PICK | typeof COORDINATE_SOURCE_WECHAT_ADDRESS

/** 白名单字面量（归一化后比较）。 */
const COORDINATE_SOURCE_WHITELIST: readonly string[] = [
  COORDINATE_SOURCE_MAP_PICK,
  COORDINATE_SOURCE_WECHAT_ADDRESS,
]

/**
 * 归一化坐标来源并做**白名单校验**。
 *
 * @param value 任意来源值（storage 里的旧值、后端回显、用户输入都可能不是白名单值）
 * @returns 命中白名单时返回标准写法；**缺失 / 空串 / 非白名单（如 `AUTO_LOCATE` / `MANUAL_INPUT`）
 *          一律返回 `null`** —— 调用方必须把 `null` 当成「**没有可信坐标**」处理（fail-closed）。
 *
 * 大小写 / 首尾空白不敏感，与后端口径一致（` map_pick ` 也认，避免因序列化差异把真坐标丢掉）。
 */
export function normalizeCoordinateSource(value: unknown): CoordinateSource | null {
  const code = String(value == null ? '' : value).trim().toUpperCase()
  if (!code || !COORDINATE_SOURCE_WHITELIST.includes(code)) return null
  return code as CoordinateSource
}
