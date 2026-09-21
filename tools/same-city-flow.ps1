# =============================================================================
# LonPin 三条核心业务链路 · 一键复跑脚本
#
# 覆盖：
#   链路 A：商家入驻 → 建门店 → 上架商品 → 接单 → 订单完成
#   链路 B：用户 → 成为骑手 → 接单 → 配送 → 完成 / 异常上报
#   链路 C：用户 → 下单同城配送 → 配送中 → 配送完成 → 订单完成
#
# 说明与注意事项见 docs/三条核心业务链路流程文档-2026-09-21.md。
#
# ⚠️ 本脚本会在 dev 后端**真实造数**（新用户、新品牌、新门店、新商品、新订单、新配送任务）。
#    dev 用户 id 段从 90144 起、门店从 90110 起、品牌从 969 起（每次复跑都会继续增长）。
# ⚠️ 请在 dev 环境运行，不要指向生产。
# ⚠️ 文件刻意保持**纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的 UTF-8 中文按 ANSI 解析，
#    脚本里混中文会导致行号错乱、语法报错。
#
# 用法：
#   pwsh -File tools/same-city-flow.ps1
#   pwsh -File tools/same-city-flow.ps1 -Base http://192.168.1.5:8080
#   pwsh -File tools/same-city-flow.ps1 -SkipExceptionBranch   # 不跑异常上报分支
# =============================================================================
param(
  [string]$Base = 'http://192.168.1.4:8080',
  [string]$AdminUser = 'root',
  [string]$AdminPass = 'root123',
  [string]$Stamp = (Get-Date -Format 'MMddHHmmss'),
  [string]$AppKey = 'jinhua',
  [switch]$SkipExceptionBranch
)

$ErrorActionPreference = 'Stop'
$script:Base = $Base
$script:Fail = 0
$script:Step = 0

function Say([string]$msg) {
  $script:Step++
  Write-Host ("[{0,2}] {1}" -f $script:Step, $msg) -ForegroundColor Cyan
}

# 单入口 HTTP：始终返回原始响应体字符串（含错误体），便于统一判定与打印。
function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body,
    [string]$Token,
    [switch]$WithAppKey
  )
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  if ($WithAppKey) { $headers['X-App-Key'] = $AppKey }
  $p = @{ Uri = ($script:Base + $Path); Method = $Method; Headers = $headers; TimeoutSec = 40; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 12 -Compress }
    $p['Body'] = [System.Text.Encoding]::UTF8.GetBytes($json)
    $p['ContentType'] = 'application/json; charset=utf-8'
  }
  try {
    $resp = Invoke-WebRequest @p
    # PS 5.1 在响应头缺 charset 时按系统 ANSI 解码 -> 中文乱码；这里按 UTF-8 重新读原始流。
    if ($resp.RawContentStream) {
      $resp.RawContentStream.Position = 0
      $sr = New-Object System.IO.StreamReader($resp.RawContentStream, [System.Text.Encoding]::UTF8)
      return $sr.ReadToEnd()
    }
    return $resp.Content
  } catch {
    $r = $_.Exception.Response
    if ($r) {
      try {
        $sr = New-Object System.IO.StreamReader($r.GetResponseStream(), [System.Text.Encoding]::UTF8)
        return $sr.ReadToEnd()
      } catch { return "HTTP $([int]$r.StatusCode)" }
    }
    return "ERR: $($_.Exception.Message)"
  }
}

function As-Obj($text) {
  if (-not $text) { return $null }
  try { return ($text | ConvertFrom-Json) } catch { return $null }
}

# 调用 + 断言 code==0；失败即中止（避免后面步骤连锁产生误导性错误）。
function Call {
  param([string]$Label, [string]$Method, [string]$Path, $Body, [string]$Token, [switch]$WithAppKey, [switch]$AllowFail)
  $resp = Invoke-Api -Method $Method -Path $Path -Body $Body -Token $Token -WithAppKey:$WithAppKey
  $o = As-Obj $resp
  $ok = ($o -and $o.code -eq 0 -and $o.success -ne $false)
  if ($ok) {
    Write-Host ("      OK  " + $Label) -ForegroundColor DarkGray
  } else {
    $script:Fail++
    Write-Host ("      ERR " + $Label + " -> " + $resp) -ForegroundColor Red
    if (-not $AllowFail) { throw "step failed: $Label" }
  }
  return $o
}

# ---------------------------------------------------------------- 0. 登录
Say "登录：申请人 / 顾客 / 骑手 / 中控"
$applyOpenid = "dev-flow-apply-$Stamp"
$custOpenid = "dev-flow-cust-$Stamp"
$riderOpenid = "dev-flow-rider-$Stamp"

# dev 登录对同一 openid 幂等；openid 必须以 dev- 开头才会自动建号（防误建真实微信用户）。
$apply = (Call 'dev customer login (applicant)' Post '/api/dev/auth/customer' @{ openid = $applyOpenid; nickname = "FlowApply$Stamp" } -WithAppKey).data
$cust = (Call 'dev customer login (customer)' Post '/api/dev/auth/customer' @{ openid = $custOpenid; nickname = "FlowCust$Stamp" } -WithAppKey).data
$rider = (Call 'dev customer login (rider)' Post '/api/dev/auth/customer' @{ openid = $riderOpenid; nickname = "FlowRider$Stamp" } -WithAppKey).data
$adminToken = (Call "admin login ($AdminUser)" Post '/api/admin/auth/login' @{ username = $AdminUser; password = $AdminPass }).data.token
Write-Host "      applyUserId=$($apply.userId) custUserId=$($cust.userId) riderUserId=$($rider.userId)" -ForegroundColor DarkGray

# ------------------------------------------------- 1. 链路 A：入驻 → 门店
Say "提交商家入驻申请（后端会自动建品牌 + 首店）"
$applyBody = @{
  brandName    = "FlowBrand$Stamp"
  contactName  = 'FlowContact'
  contactPhone = '13900000101'
  shop         = @{
    name = "FlowShop$Stamp"; address = '上海市浦东新区测试路2号'
    province = '上海市'; city = '上海市'; district = '浦东新区'
    latitude = 31.212500; longitude = 121.612000; mainBusiness = '餐饮'
  }
  remark       = 'automated flow rehearsal'
}
$applyResp = (Call 'POST /api/merchant/apply' Post '/api/merchant/apply' $applyBody -Token $apply.token -WithAppKey).data
$applyId = $applyResp.applyId
$merchantId = $applyResp.merchantId
$firstShopId = $applyResp.shopId
Write-Host "      applyId=$applyId merchantId(brand)=$merchantId firstShopId=$firstShopId" -ForegroundColor DarkGray

Say "中控审核通过（路径是单数 merchant-apply；通过后品牌与门店一起启用，并下发两个身份）"
Call 'POST /api/admin/merchant-apply/{id}/approve' Post "/api/admin/merchant-apply/$applyId/approve" -Token $adminToken | Out-Null

Say "中控另建第二家门店（门店建/改 DTO 都没有 deliveryEnabled 字段）"
$shop2 = (Call 'POST /api/admin/shop' Post '/api/admin/shop' @{
    merchantId = $merchantId; name = "FlowShop2-$Stamp"; mainBusiness = '餐饮'
    address = '上海市浦东新区测试路3号'; province = '上海市'; city = '上海市'; district = '浦东新区'
    phone = '13900000101'; contactName = 'FlowContact'; contactPhone = '13900000101'
    latitude = 31.213000; longitude = 121.613000
  } -Token $adminToken).data

Say "商家长保存配送规则 —— 这是打开门店同城配送（shop.deliveryEnabled）的**唯一**路径"
Call 'POST /api/merchant/delivery/rules' Post '/api/merchant/delivery/rules' @{
  enabled = 1; maxDistanceKm = 10; feeType = 'FIXED'; feeConfig = '5'; minOrderAmount = 0
  pickupCodeEnabled = 1; proofTypes = 'PHOTO'; estimatedPrepareMinutes = 10; estimatedDeliveryMinutes = 20
} -Token $apply.token -WithAppKey | Out-Null

Say "商家长上架商品"
$prodId = (Call 'POST /api/merchant/products' Post '/api/merchant/products' @{
    title = "FlowGoods-$Stamp"; mainImages = @('https://cdn.example.com/flow-p.jpg')
    description = 'flow rehearsal product'
    skus = @(@{ specName = 'default'; price = 19.90; stock = 100 }); status = 1
  } -Token $apply.token -WithAppKey).data
$prodList = (As-Obj (Invoke-Api -Method Get -Path '/api/merchant/products?page=1&pageSize=5' -Token $apply.token -WithAppKey)).data
$prodRow = $prodList.list | Where-Object { $_.productId -eq $prodId }
$skuId = $prodRow.skus[0].skuId
Write-Host "      productId=$prodId skuId=$skuId" -ForegroundColor DarkGray

# ------------------------------------- 2. 链路 C：下单 → 支付 → 接单备货
Say "顾客试算配送费（merchantId 传的是**门店 ID**，不是品牌 ID）"
Call 'POST /api/delivery/quote' Post '/api/delivery/quote' @{
  merchantId = $firstShopId; address = '上海市浦东新区测试路9号'; goodsAmount = 19.90
  receiverLat = 31.213500; receiverLng = 121.613500
} -Token $cust.token -WithAppKey | Out-Null

Say "顾客下单（pickupType=2 同城；merchantId 必须传门店 ID，传品牌 ID 会报 1000）"
$orderNo = (Call 'POST /api/order/create' Post '/api/order/create' @{
    items = @(@{ skuId = $skuId; quantity = 1 })
    receiverName = 'FlowReceiver'; receiverPhone = '13900000303'; receiverAddress = '上海市浦东新区测试路9号'
    receiverLat = 31.213500; receiverLng = 121.613500
    receiverProvince = '上海市'; receiverCity = '上海市'; receiverDistrict = '浦东新区'
    remark = 'flow rehearsal: leave at front desk'
    pickupType = 2; merchantId = $firstShopId
  } -Token $cust.token -WithAppKey).data.orderNo
Write-Host "      orderNo=$orderNo" -ForegroundColor DarkGray

Say "支付（dev 模拟支付）"
Call 'POST /api/dev/pay/paid' Post '/api/dev/pay/paid' @{ orderNo = $orderNo } -Token $cust.token -WithAppKey | Out-Null

Say "商家推进：accept → prepare → ready（deliveryStatus: WAIT_ACCEPT → ACCEPTED → PREPARING → WAIT_ASSIGN）"
foreach ($st in @('accept', 'prepare', 'ready')) {
  Call "POST /api/merchant/orders/{no}/$st" Post "/api/merchant/orders/$orderNo/$st" @{ requestId = "$st-$Stamp" } -Token $apply.token -WithAppKey | Out-Null
}

Say "商家建配送任务（返回的是**裸字符串** taskNo；同店活跃任务上限 5 单，超限报 13002）"
$taskNo = (Call 'POST /api/merchant/delivery/tasks' Post '/api/merchant/delivery/tasks' @{
    orderNo = $orderNo; assignmentType = 'PUBLISH_CLAIM'
  } -Token $apply.token -WithAppKey).data

# ---------------------------------------------- 3. 链路 B：骑手 → 配送
Say "骑手建档（把微信用户变成骑手；返回的是**裸数字** staffId）"
$riderStaffId = (Call 'POST /api/merchant/staff' Post '/api/merchant/staff' @{
    identities = @('RIDER'); name = 'FlowRider'; phone = '13900000404'
    userId = $rider.userId; shopId = $firstShopId
  } -Token $apply.token -WithAppKey).data
Write-Host "      riderStaffId=$riderStaffId" -ForegroundColor DarkGray

Say "骑手看新任务 → 领取 → 取货"
$newList = (As-Obj (Invoke-Api -Method Get -Path '/api/delivery/tasks?tab=NEW&page=1&pageSize=20' -Token $rider.token -WithAppKey)).data
$taskId = ($newList.list | Where-Object { $_.taskNo -eq $taskNo }).id
if (-not $taskId) { throw "rider cannot see task $taskNo" }
Write-Host "      taskId=$taskId" -ForegroundColor DarkGray
Call 'POST /tasks/{id}/claim' Post "/api/delivery/tasks/$taskId/claim" @{ requestId = "clm-$Stamp" } -Token $rider.token -WithAppKey | Out-Null
Call 'POST /tasks/{id}/pickup' Post "/api/delivery/tasks/$taskId/pickup" @{
  latitude = 31.212500; longitude = 121.612000; locationText = 'shop'; requestId = "pck-$Stamp"
} -Token $rider.token -WithAppKey | Out-Null

Say "顾客取收货码 → 骑手核销（门店开启收货码时，未核销不允许送达；错 5 次锁 10 分钟）"
$code = (Call 'GET /api/delivery/orders/{no}/pickup-code' Get "/api/delivery/orders/$orderNo/pickup-code" -Token $cust.token -WithAppKey).data
Write-Host "      pickupCode=$code" -ForegroundColor DarkGray
Call 'POST /tasks/{id}/verify-code' Post "/api/delivery/tasks/$taskId/verify-code" @{ code = "$code"; requestId = "vfy-$Stamp" } -Token $rider.token -WithAppKey | Out-Null

Say "开始配送（PICKED_UP → DELIVERING）"
Call 'POST /tasks/{id}/start' Post "/api/delivery/tasks/$taskId/start" @{
  latitude = 31.213000; longitude = 121.613000; locationText = 'on the way'; requestId = "str-$Stamp"
} -Token $rider.token -WithAppKey | Out-Null

# ------------------------------------------------- 4. 异常上报分支（可选，必须在送达前）
if (-not $SkipExceptionBranch) {
  Say "异常上报 → 商家恢复（EXCEPTION → 回到上一状态）：旁支链路只在**送达前**有意义"
  $r = Call 'POST /tasks/{id}/exception' Post "/api/delivery/tasks/$taskId/exception" @{
    type = 'CUSTOMER_UNREACHABLE'; remark = 'flow rehearsal: customer unreachable'; requestId = "exc-$Stamp"
  } -Token $rider.token -WithAppKey -AllowFail
  if ($r -and $r.code -eq 0) {
    Call 'POST /api/merchant/delivery/tasks/{id}/resume' Post "/api/merchant/delivery/tasks/$taskId/resume" @{
      reason = 'flow rehearsal resume'; requestId = "rsm-$Stamp"
    } -Token $apply.token -WithAppKey | Out-Null
    # ⚠️ 实测（2026-09-21）：resume 是**回到"上一状态"**，不是固定回 PICKED_UP ——
    # 从 DELIVERING 上报异常，恢复后就还是 DELIVERING（此时再调 start 会报 13003）。
    # 所以先查一次真实状态，只有停在 PICKED_UP 时才补 start。
    $after = (As-Obj (Invoke-Api -Method Get -Path "/api/delivery/tasks/$taskId" -Token $rider.token -WithAppKey)).data
    Write-Host "      status after resume = $($after.status)" -ForegroundColor DarkGray
    if ($after.status -eq 'PICKED_UP') {
      Call 'POST /tasks/{id}/start (after resume)' Post "/api/delivery/tasks/$taskId/start" @{
        latitude = 31.213000; longitude = 121.613000; requestId = "str2-$Stamp"
      } -Token $rider.token -WithAppKey | Out-Null
    }
  }
}

Say "送达 → 上传凭证（凭证**必须**在送达之后，提前传报 13003）"
Call 'POST /tasks/{id}/delivered' Post "/api/delivery/tasks/$taskId/delivered" @{
  pickupCodeVerified = $true; latitude = 31.213500; longitude = 121.613500; locationText = 'drop point'; requestId = "dlv-$Stamp"
} -Token $rider.token -WithAppKey | Out-Null
Call 'POST /tasks/{id}/proof' Post "/api/delivery/tasks/$taskId/proof" @{
  proofType = 'PHOTO'; objectKey = "flow/proof-$Stamp.jpg"; receiverName = 'FlowReceiver'; requestId = "prf-$Stamp"
} -Token $rider.token -WithAppKey | Out-Null

# ------------------------------------------------- 5. 收口：确认收货 → 完成
Say "用户确认收货 —— **骑手送达 ≠ 订单完成**，必须显式确认才 status=4"
Call 'POST /api/delivery/orders/{no}/confirm-receive' Post "/api/delivery/orders/$orderNo/confirm-receive" -Token $cust.token -WithAppKey | Out-Null

Say "核对终态"
$detail = (As-Obj (Invoke-Api -Method Get -Path "/api/order/detail-by-no/$orderNo" -Token $cust.token -WithAppKey)).data
$mOrder = (As-Obj (Invoke-Api -Method Get -Path "/api/merchant/orders/$orderNo" -Token $apply.token -WithAppKey)).data
Write-Host ("      C 端: status=" + $detail.status + " (" + $detail.statusDesc + ") pickupType=" + $detail.pickupType + " deliveryStatus=" + $detail.deliveryStatus) -ForegroundColor Green
Write-Host ("      商家: status=" + $mOrder.status + " deliveryStatus=" + $mOrder.deliveryStatus + " 骑手=" + $mOrder.deliveryPersonName) -ForegroundColor Green

Write-Host ""
Write-Host "===================== 复跑完成 =====================" -ForegroundColor Yellow
Write-Host "brand=$merchantId firstShop=$firstShopId shop2=$shop2 product=$prodId sku=$skuId"
Write-Host "orderNo=$orderNo taskId=$taskId taskNo=$taskNo pickupCode=$code riderStaffId=$riderStaffId"
Write-Host "失败步骤数 = $script:Fail"
Write-Host "下一步：把这些值填进 docs/三条核心业务链路流程文档-2026-09-21.md 的复跑记录，"
Write-Host "       或对照 §七 问题清单核对本次是否复现同样的现象。"
if ($script:Fail -gt 0) { exit 1 }
