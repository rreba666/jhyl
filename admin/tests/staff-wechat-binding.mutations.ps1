# Mutation harness for admin/tests/staff-wechat-binding.contract.ps1
# REVISION 2 (2026-10-10): the contract was inverted from the old three-key either/or model
# (userId > wechatId > openid, only the winning key submitted) to the two-key "fill it and it is
# sent" model (userId is the identity authority; userId+wechatId together = the backend registers
# the wechat-id on the fly). Every assertion in the contract is mutation-proved here.
#
# Each case: apply a 1-occurrence mutation (or the Nth occurrence / all occurrences) -> the contract
# MUST go red -> restore the ORIGINAL BYTES captured before the edit -> verify with SHA256.
# A case that stays green, or that fails to restore byte-identically, is reported and counted.
#
# ASCII-ONLY SOURCE (PS 5.1 parses BOM-less scripts as ANSI; inlined Chinese would be destroyed
# BEFORE the script runs and would silently report false greens -- the staff-h5 lesson). All Chinese
# anchors are built from code points and written out explicitly as UTF-8 (no BOM).
# The harness self-checks its own non-ASCII byte count and refuses to run if it is not 0.
#
# api_doc.json is gitignored (no git safety net) => it gets an extra temp backup, and its SHA256 is
# re-verified at the end of the run.
$ErrorActionPreference = 'Continue'

$repo = 'E:\work\JJ\LonPin'
$testsDir = Join-Path $repo 'admin\tests'
$contract = Join-Path $testsDir 'staff-wechat-binding.contract.ps1'
$apiDocPath = Join-Path $repo 'api_doc.json'

# ---------------------------------------------------------------- self-checks
$selfPath = Join-Path $repo 'admin\tests\staff-wechat-binding.mutations.ps1'
$selfBytes = [System.IO.File]::ReadAllBytes($selfPath)
$selfNonAscii = 0
foreach ($b in $selfBytes) { if ($b -gt 127) { $selfNonAscii++ } }
Write-Output ("HARNESS-SELFCHECK :: nonAsciiBytes=" + $selfNonAscii)
if ($selfNonAscii -ne 0) { throw 'harness must stay ASCII-only (Chinese anchors are built from code points)' }
if (-not (Test-Path -LiteralPath $contract)) { throw "missing contract: $contract" }
if (-not (Test-Path -LiteralPath $apiDocPath)) { throw "missing contract source: $apiDocPath" }

function Run-Contract {
  $tmp = Join-Path $testsDir ("zzbom-" + [guid]::NewGuid().ToString('N') + ".contract.ps1")
  [System.IO.File]::WriteAllText($tmp, [System.IO.File]::ReadAllText($contract, [Text.Encoding]::UTF8), (New-Object System.Text.UTF8Encoding($true)))
  try {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  $msg = (($out -split "`n") | Where-Object { $_ -match 'missing|unexpected|did not match|matched:|expected |must ' } | Select-Object -First 1)
  if (-not $msg) { $msg = (($out -split "`n") | Where-Object { $_ -match 'PASS' } | Select-Object -First 1) }
  return [pscustomobject]@{ Code = $code; Msg = ("" + $msg).Trim() }
}

function N([string]$hex) {
  $out = ''
  foreach ($cp in $hex.Split(' ')) { if ($cp) { $out += [char][Convert]::ToInt32($cp, 16) } }
  return $out
}

function Replace-Target([string]$text, [string]$old, [string]$new, [int]$index, [bool]$all) {
  if ($all) { return $text.Replace($old, $new) }
  $pos = -1
  for ($i = 0; $i -lt $index; $i++) {
    $pos = $text.IndexOf($old, $pos + 1, [StringComparison]::Ordinal)
    if ($pos -lt 0) { return $null }
  }
  return $text.Substring(0, $pos) + $new + $text.Substring($pos + $old.Length)
}

# ---------------------------------------------------------------- Chinese anchors (code points)
$WX_ID = N '5FAE 4FE1 53F7'                                              # wechat-id
$USER_ID = N '5FAE 4FE1 7528 6237 0049 0044'                             # wechat user ID
$AUTO_REGISTER = N '987A 624B 767B 8BB0'                                 # registered on the fly
$REGISTER = N '767B 8BB0'                                                # register
$NO_OVERWRITE_QUOTE = N '4E0D 8986 76D6 3001 4E0D 731C'                  # not overwritten / not guessed
$OVERWRITE_QUOTE = N '8986 76D6 3001 4E0D 731C'
$NO_CODE_MAP = N '524D 7AEF 002A 002A 4E0D 6309 0020 0063 006F 0064 0065 0020 6620 5C04 002A 002A'
$CODE_MAP_INSTEAD = N '524D 7AEF 002A 002A 4F1A 6309 0020 0063 006F 0064 0065 0020 6620 5C04 002A 002A'
$MUST_BIND = N '5E97 957F 0020 002F 0020 9A91 624B 5FC5 987B 7ED1 5B9A 5FAE 4FE1 7528 6237'
$MUST_BIND_SHORT = N '5E97 957F 0020 002F 0020 9A91 624B 5FC5 987B 7ED1 5B9A 5FAE 4FE1'
$BOTH_RECOMMENDED = N '4E24 4E2A 90FD 586B 662F 63A8 8350 505A 6CD5'
$BOTH_OPTIONAL = N '4E24 4E2A 90FD 586B 662F 53EF 9009 505A 6CD5'
$REPORTED_WECHAT = N '7528 6237 62A5 7ED9 4F60 7684 5FAE 4FE1 53F7'
$PLAIN_WECHAT = N '7528 6237 7684 5FAE 4FE1 53F7'
$WX_UNREGISTERED = N '5FAE 4FE1 53F7 672A 767B 8BB0'
$UNREGISTERED = N '672A 767B 8BB0'
$FILL_ONE_OK = N '586B 4E00 4E2A 5373 53EF'
$KEY_PAIR = (N '6216 300C') + '${STAFF_WECHAT_LABELS.wechatId}' + (N '300D')
$SAVE_FAIL_CALL = "staffWechatErrorText(error, '" + (N '4FDD 5B58 5931 8D25') + "')"
$SAVE_FAIL_PLAIN = "error instanceof Error ? error.message : '" + (N '4FDD 5B58 5931 8D25') + "'"
$CUSER_ID_DESC = N '0043 7AEF 7528 6237 0049 0044 FF08 0077 0078 005F 0075 0073 0065 0072 002E 0069 0064 FF09'
$WX_ID_DESC_SEMI = N '5FAE 4FE1 53F7 FF08 4EBA 5DE5 767B 8BB0 503C FF1B 4E0E 0020 0075 0073 0065 0072 0049 0064 0020 4E8C 9009 4E00 FF0C 4F18 5148 0020 0075 0073 0065 0072 0049 0064 FF09'
$WX_ID_DESC_SHORT = N '5FAE 4FE1 53F7 FF08 4EBA 5DE5 767B 8BB0 503C FF09'
$WX_USER_ID_DESC = N '5FAE 4FE1 7528 6237 0049 0044 FF08 5E97 957F 002F 9A91 624B 5FC5 586B FF09'
$WX_USER_ID_ONLY = N '5FAE 4FE1 7528 6237 0049 0044'
$NO_OVERWRITE_SENTENCE = N '4E0D 4E00 81F4 5219 62A5 0020 0031 0030 0030 0030 FF08 4E0D 8986 76D6 FF09'
$OVERWRITE_SENTENCE = N '4E0D 4E00 81F4 5219 62A5 0020 0031 0030 0030 0030 FF08 8986 76D6 FF09'
$ADMIN_DESC_TAIL = N 'FF0C 0032 0030 0032 0036 002D 0031 0030 002D 0031 0030 0020 8D77 FF09 FF1B 5FAE 4FE1 53F7 662F'
$THREE_CHOOSE_ONE = N '4E09 9009 4E00'
$OLD_OPENID_LABEL_ATTR = 'label="' + $WX_ID + ' ' + (N '6216') + ' openid"'
$COMBINED_LABEL = $WX_ID + ' ' + (N '6216') + ' openid'
$JSON_BIND_USERID_BLOCK = '          "userId": {' + "`n" + '            "type": "integer",' + "`n" + '            "format": "int64",' + "`n" + '            "description": "' + $CUSER_ID_DESC + '",'

$U = 'admin\src\utils\staffWechat.ts'
$V = 'admin\src\views\staff\index.vue'
$T = 'admin\src\types\staff.ts'
$AU = 'admin\src\api\user.ts'
$UV = 'admin\src\views\users\index.vue'
$J = 'api_doc.json'

$mutations = @(
  # ---- the routing authority: two keys, no openid ----
  @{ Name = 'U01 union drops the wechatId key'; File = $U; Old = "export type StaffWechatKey = 'userId' | 'wechatId'"; New = "export type StaffWechatKey = 'userId'" },
  @{ Name = 'U02 key order shuffled (wechatId first)'; File = $U; Old = "['userId', 'wechatId']"; New = "['wechatId', 'userId']" },
  @{ Name = 'U03 userId label weakened'; File = $U; Old = "  userId: '$USER_ID',"; New = ("  userId: '" + (N '7528 6237 0049 0044') + "',") },
  @{ Name = 'U04 wechatId label becomes the old combined label'; File = $U; Old = "  wechatId: '$WX_ID',"; New = "  wechatId: '$COMBINED_LABEL'," },
  @{ Name = 'U05 an openid label is re-added'; File = $U; Old = "  wechatId: '$WX_ID',"; New = ("  wechatId: '$WX_ID'," + "`n" + "  openid: 'openid',") },
  # ---- "fill it and it is sent": both keys written behind their own check ----
  @{ Name = 'U06 wechatId is submitted AS openid'; File = $U; Old = '    payload.wechatId = trimmed(input.wechatId)'; New = '    payload.openid = trimmed(input.wechatId)' },
  @{ Name = 'U07 wechatId sent only when it wins'; File = $U; Old = "  if (filled.includes('wechatId')) {"; New = "  if (key === 'wechatId') {" },
  @{ Name = 'U08 userId sent only when it wins'; File = $U; Old = "  if (filled.includes('userId')) {"; New = "  if (key === 'userId') {" },
  @{ Name = 'U09 a third payload key is written'; File = $U; Old = '    payload.wechatId = trimmed(input.wechatId)'; New = ('    payload.wechatId = trimmed(input.wechatId)' + "`n" + '    payload.extra = value') },
  @{ Name = 'U10 auto-register state is dropped'; File = $U; Old = "    autoRegister: filled.includes('userId') && filled.includes('wechatId'),"; New = '    autoRegister: false,' },
  @{ Name = 'U11 identity authority taken from the LAST key'; File = $U; Old = '  const key = filled[0] ?? null'; New = '  const key = filled[filled.length - 1] ?? null' },
  # ---- no silent downgrade + the documented rules ----
  @{ Name = 'U12 no-overwrite rule documented away'; File = $U; Old = $NO_OVERWRITE_QUOTE; New = $OVERWRITE_QUOTE },
  @{ Name = 'U13 the ignored-keys model is re-introduced'; File = $U; Old = 'export interface StaffWechatResolution {'; New = ('export interface StaffWechatResolution {' + "`n" + '  /** ignored */') },
  @{ Name = 'U14 malformed userId downgrades to a wechatId-only payload'; File = $U; Old = '      return { key, payload: {}, filled, autoRegister: false, invalid: true }'; New = '      return { key, payload, filled, autoRegister: false, invalid: true }' },
  @{ Name = 'U15 the error helper stops returning the backend message'; File = $U; Old = '  return sanitizeBonusText(raw).trim() || fallback'; New = '  return fallback' },
  @{ Name = 'U16 the error helper maps a business code again'; File = $U; Old = '  return sanitizeBonusText(raw).trim() || fallback'; New = ('  if (code === 2000) return fallback' + "`n" + '  return sanitizeBonusText(raw).trim() || fallback') },
  @{ Name = 'U17 the no-code-mapping rule documented away'; File = $U; Old = $NO_CODE_MAP; New = $CODE_MAP_INSTEAD; All = $true },
  # ---- the view: openid plumbing gone, both keys are submitted ----
  @{ Name = 'V18 the submit funnels the value into openid again'; File = $V; Old = '        ...(needWechat.value ? wechatResolution.value.payload : {}),'; New = '        ...(needWechat.value && form.wechatOpenid.trim() ? { openid: form.wechatOpenid.trim() } : {}),' },
  @{ Name = 'V19 the old openid state field is restored'; File = $V; Old = ("  wechatUserId: ''," + "`n" + "  wechatId: ''," + "`n" + '})'); New = ("  wechatUserId: ''," + "`n" + "  wechatId: ''," + "`n" + "  wechatOpenid: ''," + "`n" + '})') },
  @{ Name = 'V20 the old openid input row is restored'; File = $V; Old = 'v-model="form.wechatId"'; New = ('v-model="form.wechatId" />' + "`n" + '          </el-form-item>' + "`n" + '          <el-form-item :label="STAFF_WECHAT_LABELS.openid">' + "`n" + '            <el-input v-model="form.wechatOpenid"') },
  @{ Name = 'V21 an openid input is restored in the bind dialog'; File = $V; Old = 'v-model="bindForm.wechatId"'; New = 'v-model="bindForm.wechatId" /><el-input v-model="bindForm.openid"' },
  @{ Name = 'V22 the bind action shape-routes the value again'; File = $V; Old = 'await store.bindWechat(row.id, bindResolution.value.payload)'; New = 'await store.bindWechat(row.id, /^\d+$/.test(bindForm.userId) ? { userId: bindForm.userId } : { wechatId: bindForm.wechatId })' },
  @{ Name = 'V23 the bind dialog loses its confirm handler'; File = $V; Old = '@click="confirmBind"'; New = '@click="noopHandler"' },
  @{ Name = 'V24 only one of the two bind cleanups survives'; File = $V; Old = "Object.assign(bindForm, { userId: '', wechatId: '' })"; New = "Object.assign(bindForm, { userId: '', wechatId: '', openid: '' })"; Index = 2 },
  @{ Name = 'V25 the wechat-user-ID input key drifts'; File = $V; Old = 'v-model="form.wechatUserId"'; New = 'v-model="form.wechatUserIds"' },
  # ---- the copy the operator reads ----
  @{ Name = 'V26 the recommended-path copy is weakened'; File = $V; Old = $BOTH_RECOMMENDED; New = $BOTH_OPTIONAL; All = $true },
  @{ Name = 'V27 the spec hint wording is gone from one dialog'; File = $V; Old = $REPORTED_WECHAT; New = $PLAIN_WECHAT; Index = 1 },
  @{ Name = 'V28 the old one-is-enough promise comes back'; File = $V; Old = 'v-model="bindForm.wechatId"'; New = ('<span class="muted">' + $FILL_ONE_OK + '</span><el-input v-model="bindForm.wechatId"') },
  @{ Name = 'V29 the requirement message stops naming the wechatId key'; File = $V; Old = $KEY_PAIR; New = '' },
  @{ Name = 'V30 the requirement message loses its required wording'; File = $V; Old = $MUST_BIND; New = $MUST_BIND_SHORT },
  # ---- error copy is the backend message ----
  @{ Name = 'V31 the create path stops surfacing the backend message'; File = $V; Old = $SAVE_FAIL_CALL; New = $SAVE_FAIL_PLAIN },
  # ---- the operator can obtain userId ----
  @{ Name = 'V32 the search result drops the registration state'; File = $V; Old = $WX_UNREGISTERED; New = $UNREGISTERED; All = $true },
  @{ Name = 'V33 the remote user search stops asking for users'; File = $V; Old = 'getUsers(1, 20, query)'; New = 'getUsers(1, 10, keyword)' },
  @{ Name = 'V34 the search helper loses its async contract'; File = $V; Old = 'async function searchBindUsers(keyword: string): Promise<void> {'; New = 'function searchBindUsers(keyword: string): Promise<void> {' },
  @{ Name = 'V35 the old combined label attribute comes back'; File = $V; Old = 'v-model="form.wechatId"'; New = ($OLD_OPENID_LABEL_ATTR + ' v-model="form.wechatId"') },
  # ---- types: two live keys in, display fields kept ----
  @{ Name = 'T35 openid returns to StaffBindDTO'; File = $T; Old = ("  userId?: number | string" + "`n" + "  wechatId?: string" + "`n" + '}'); New = ("  userId?: number | string" + "`n" + "  openid?: string" + "`n" + "  wechatId?: string" + "`n" + '}') },
  @{ Name = 'T36 the display-side openid field is deleted'; File = $T; Old = 'boundOpenidMasked?: string'; New = 'boundOpenidMaskedRemoved?: string' },
  # ---- the wechat-id path stays reachable ----
  @{ Name = 'A37 the user search endpoint is renamed'; File = $AU; Old = "'/api/admin/user/list'"; New = "'/api/admin/user/lists'" },
  @{ Name = 'W38 the wechat-id registration button is unwired'; File = $UV; Old = '@click="saveWechatId"'; New = '@click="noopHandler()"' },
  # ---- api_doc.json: the authoritative contract itself ----
  @{ Name = 'J39 api_doc: openid is re-added to StaffBindWechatDTO'; File = $J; Old = $JSON_BIND_USERID_BLOCK; New = ('          "openid": {' + "`n" + '            "type": "string"' + "`n" + '          },' + "`n" + $JSON_BIND_USERID_BLOCK) },
  @{ Name = 'J40 api_doc: wechatId description loses its either/or rule'; File = $J; Old = $WX_ID_DESC_SEMI; New = $WX_ID_DESC_SHORT },
  @{ Name = 'J41 api_doc: userId description stops requiring riders'; File = $J; Old = $WX_USER_ID_DESC; New = $WX_USER_ID_ONLY },
  @{ Name = 'J42 api_doc: merchant bind drops the auto-register rule'; File = $J; Old = $AUTO_REGISTER; New = $REGISTER; Index = 1 },
  @{ Name = 'J43 api_doc: admin bind drops the auto-register rule'; File = $J; Old = $AUTO_REGISTER; New = $REGISTER; Index = 2 },
  @{ Name = 'J44 api_doc: admin bind says the value IS overwritten'; File = $J; Old = $NO_OVERWRITE_SENTENCE; New = $OVERWRITE_SENTENCE },
  @{ Name = 'J45 api_doc: admin bind offers a three-way choice again'; File = $J; Old = $ADMIN_DESC_TAIL; New = ($THREE_CHOOSE_ONE + $ADMIN_DESC_TAIL) },
  @{ Name = 'J46 api_doc: the merchant PC bind path disappears'; File = $J; Old = '"/api/merchant/staff/{id}/bind": {'; New = '"/api/merchant/staff/{id}/bind-renamed": {' }
)

# ---------------------------------------------------------------- api_doc safety net
$apiOrigBytes = [System.IO.File]::ReadAllBytes($apiDocPath)
$apiOrigSha = (Get-FileHash -LiteralPath $apiDocPath -Algorithm SHA256).Hash
$apiBackup = Join-Path ([System.IO.Path]::GetTempPath()) ('zzbom-api_doc-' + [guid]::NewGuid().ToString('N') + '.json')
[System.IO.File]::WriteAllBytes($apiBackup, $apiOrigBytes)
Write-Output ("API-DOC-BACKUP :: sha256=" + $apiOrigSha + " :: temp=" + $apiBackup)

$ok = 0
$bad = 0
$restoreFailed = 0
$skipped = 0

foreach ($m in $mutations) {
  $path = Join-Path $repo $m.File
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Output ("{0} :: SKIPPED (file missing: {1})" -f $m.Name, $m.File)
    $skipped++
    continue
  }
  $index = 1
  if ($m.ContainsKey('Index')) { $index = [int]$m.Index }
  $all = $false
  if ($m.ContainsKey('All')) { $all = [bool]$m.All }

  $orig = [System.IO.File]::ReadAllBytes($path)
  $shaBefore = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  $text = [System.IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  $hits = ([regex]::Matches($text, [regex]::Escape($m.Old))).Count
  $mutated = Replace-Target $text $m.Old $m.New $index $all
  if ($null -eq $mutated) {
    Write-Output ("{0} :: SETUP-FAILED (needle occurrences = {1}, needed the {2}. one)" -f $m.Name, $hits, $index)
    $bad++
    continue
  }

  $code = -1
  $msg = ''
  $ran = $false
  $restored = 'RESTORE-MISMATCH'
  try {
    [System.IO.File]::WriteAllBytes($path, (New-Object System.Text.UTF8Encoding($false)).GetBytes($mutated))
    $r = Run-Contract
    $ran = $true
    $code = $r.Code
    $msg = $r.Msg
  } catch {
    $msg = 'HARNESS-ERROR: ' + $_.Exception.Message
  } finally {
    [System.IO.File]::WriteAllBytes($path, $orig)
    $shaAfter = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($shaBefore -eq $shaAfter) { $restored = 'RESTORED-IDENTICAL' } else { $restoreFailed++ }
  }

  if ($restored -ne 'RESTORED-IDENTICAL') {
    Write-Output ("{0} :: restore :: {1}" -f $m.Name, $restored)
    continue
  }
  if (-not $ran) {
    $bad++
    Write-Output ("{0} :: HARNESS-ERROR :: {1}" -f $m.Name, $msg)
    continue
  }
  if ($code -ne 0) {
    $ok++
    Write-Output ("{0} :: exit={1} :: RED-as-expected :: {2}" -f $m.Name, $code, $msg)
  } else {
    $bad++
    Write-Output ("{0} :: exit=0 :: GREEN-TOOTHLESS (the contract did not notice) :: {1}" -f $m.Name, $msg)
  }
}

# ---------------------------------------------------------------- api_doc integrity
$apiNowSha = (Get-FileHash -LiteralPath $apiDocPath -Algorithm SHA256).Hash
if ($apiNowSha -eq $apiOrigSha) {
  Write-Output ("API-DOC-INTEGRITY :: RETAINED-IDENTICAL :: sha256=" + $apiNowSha)
} else {
  [System.IO.File]::WriteAllBytes($apiDocPath, $apiOrigBytes)
  $apiFixSha = (Get-FileHash -LiteralPath $apiDocPath -Algorithm SHA256).Hash
  $state = if ($apiFixSha -eq $apiOrigSha) { 'RESTORED-FROM-BACKUP' } else { 'RESTORE-FAILED' }
  $restoreFailed++
  Write-Output ("API-DOC-INTEGRITY :: " + $state + " :: sha256=" + $apiFixSha)
}
Remove-Item -LiteralPath $apiBackup -Force -ErrorAction SilentlyContinue

Write-Output ("MUTATION-SUMMARY :: total={0} :: ok={1} :: bad={2} :: restoreFailed={3} :: skipped={4}" -f $mutations.Count, $ok, $bad, $restoreFailed, $skipped)
