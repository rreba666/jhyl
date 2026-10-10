# Mutation harness for staff-wechat-binding.contract.ps1 (ASCII-only; Chinese built from code points).
# Each case: apply a 1-occurrence mutation -> contract MUST go red -> restore the ORIGINAL BYTES
# (captured before the edit) -> verify the restore with SHA256. A case that stays green, or that
# fails to restore byte-identically, is reported as a problem.
$ErrorActionPreference = 'Continue'
$repo = 'E:\work\JJ\LonPin\admin'
$contract = Join-Path $repo 'tests\staff-wechat-binding.contract.ps1'

function Run-Contract {
  $dir = Join-Path $repo 'tests'
  $tmp = Join-Path $dir ("zzbom-" + [guid]::NewGuid().ToString('N') + ".contract.ps1")
  [System.IO.File]::WriteAllText($tmp, [System.IO.File]::ReadAllText($contract, [Text.Encoding]::UTF8), (New-Object System.Text.UTF8Encoding($true)))
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item $tmp -Force
  $msg = (($out -split "`n") | Where-Object { $_ -match 'missing|unexpected|did not match|matched:|expected ' } | Select-Object -First 1)
  if (-not $msg) { $msg = (($out -split "`n") | Where-Object { $_ -match 'PASS' } | Select-Object -First 1) }
  return [pscustomobject]@{ Code = $code; Msg = ("" + $msg).Trim() }
}

$wx = ([string][char]0x5FAE) + ([char]0x4FE1) + ([char]0x53F7)

$mutations = @(
  @{ Name = 'M1 priority order shuffled';         File = 'src\utils\staffWechat.ts';  Old = "['userId', 'wechatId', 'openid']"; New = "['userId', 'openid', 'wechatId']" },
  @{ Name = 'M2 wechatId submitted AS openid';    File = 'src\utils\staffWechat.ts';  Old = 'payload.wechatId = value';          New = 'payload.openid = value' },
  @{ Name = 'M3 view funnels value into openid';  File = 'src\views\staff\index.vue'; Old = '...(needWechat.value ? wechatResolution.value.payload : {}),'; New = '...(needWechat.value && form.wechatOpenid.trim() ? { openid: form.wechatOpenid.trim() } : {}),' },
  @{ Name = 'M4 registration save unwired';       File = 'src\views\users\index.vue'; Old = '@click="saveWechatId"';              New = '@click="noopHandler()"' },
  @{ Name = 'M5 wechatId label becomes combined'; File = 'src\utils\staffWechat.ts';  Old = ("  wechatId: '" + $wx + "',"); New = ("  wechatId: '" + $wx + " or openid',") }
)

$problems = 0
foreach ($m in $mutations) {
  $path = Join-Path $repo $m.File
  $orig = [System.IO.File]::ReadAllBytes($path)
  $shaBefore = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  try {
    $text = [System.IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    $hits = ([regex]::Matches($text, [regex]::Escape($m.Old))).Count
    if ($hits -ne 1) {
      Write-Output ("{0} :: SETUP-FAILED (needle occurrences = {1})" -f $m.Name, $hits)
      $problems++
      continue
    }
    $mutated = $text.Replace($m.Old, $m.New)
    [System.IO.File]::WriteAllBytes($path, (New-Object System.Text.UTF8Encoding($false)).GetBytes($mutated))
    $r = Run-Contract
    $verdict = if ($r.Code -ne 0) { 'RED-as-expected' } else { 'GREEN-TOOTHLESS' }
    if ($r.Code -eq 0) { $problems++ }
    Write-Output ("{0} :: exit={1} :: {2} :: {3}" -f $m.Name, $r.Code, $verdict, $r.Msg)
  } finally {
    [System.IO.File]::WriteAllBytes($path, $orig)
    $shaAfter = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    $restored = if ($shaBefore -eq $shaAfter) { 'RESTORED-IDENTICAL' } else { 'RESTORE-MISMATCH' }
    if ($shaBefore -ne $shaAfter) { $problems++ }
    Write-Output ("{0} :: restore :: {1} :: sha256={2}" -f $m.Name, $restored, $shaAfter)
  }
}

Write-Output ("MUTATION-SUMMARY :: cases={0} :: problems={1}" -f $mutations.Count, $problems)
