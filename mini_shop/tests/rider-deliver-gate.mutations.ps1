# Mutation harness for the rider "delivery gate" block of
#   mini_shop/tests/same-city-order-flow.contract.ps1   (section 7, added 2026-10-10)
#
# The gate is FRONT-END ONLY by necessity: POST /api/delivery/tasks/{taskId}/delivered takes
# DeliveredBody (pickupCodeVerified[deprecated] / latitude / longitude / accuracy / locationText /
# requestId) with NO photo field, and POST /proof is only allowed AFTER delivered (otherwise
# 13003). So "photo or call before delivered" can only be blocked client-side and a rider can
# bypass it -- the contract locks in that the code says so honestly instead of pretending.
#
# Every assertion of that block is mutation-proved here:
#   snapshot bytes -> apply exactly one mutation -> the contract MUST go red
#   -> restore the ORIGINAL BYTES -> verify with SHA256 (byte-identical).
#
# ASCII-ONLY SOURCE. Windows PowerShell 5.1 parses a BOM-less .ps1 as ANSI, so an inlined Chinese
# needle would be corrupted BEFORE the script runs (the staff-h5 false-green lesson). All Chinese
# anchors are therefore built from code points via N().
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\mini_shop\tests\rider-deliver-gate.mutations.ps1
# Exit:   0 = every mutation was caught AND every restore was byte-identical, 1 = otherwise.

$ErrorActionPreference = 'Continue'

$repo = 'E:\work\JJ\LonPin'
$testsDir = Join-Path $repo 'mini_shop\tests'
$contract = Join-Path $testsDir 'same-city-order-flow.contract.ps1'
$selfPath = Join-Path $testsDir 'rider-deliver-gate.mutations.ps1'

# ---------------------------------------------------------------- self checks
$selfBytes = [System.IO.File]::ReadAllBytes($selfPath)
$selfNonAscii = 0
foreach ($b in $selfBytes) { if ($b -gt 127) { $selfNonAscii++ } }
Write-Output ("HARNESS-SELFCHECK :: nonAsciiBytes=" + $selfNonAscii)
if ($selfNonAscii -ne 0) { throw 'harness must stay ASCII-only (Chinese anchors are built from code points)' }
if (-not (Test-Path -LiteralPath $contract)) { throw "missing contract: $contract" }

function N([string]$hex) {
  $out = ''
  foreach ($cp in $hex.Split(' ')) { if ($cp) { $out += [char][Convert]::ToInt32($cp, 16) } }
  return $out
}

# Run the contract from a BOM copy placed NEXT TO the original (the contract derives $root from
# $PSScriptRoot) under a unique zzbom- name, then delete the copy.
function Run-Contract {
  $tmp = Join-Path $testsDir ('zzbom-' + [guid]::NewGuid().ToString('N') + '-same-city-order-flow.contract.ps1')
  [System.IO.File]::WriteAllText($tmp, [System.IO.File]::ReadAllText($contract, [Text.Encoding]::UTF8), (New-Object System.Text.UTF8Encoding($true)))
  try {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  $msg = (($out -split "`n") | Where-Object { $_ -match 'missing:|must NOT|must be|must|PASS' } | Select-Object -First 1)
  return [pscustomobject]@{ Code = $code; Msg = ("" + $msg).Trim() }
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
$GATE_TITLE = N '9001 8FBE 524D 8BF7 5148 5B8C 6210 4E00 9879'                  # modal title
$GENERIC_FAIL = N '64CD 4F5C 5931 8D25'                                          # a generic "operation failed"
$BAR_PHOTO = N '62CD 7167 7559 5B58 9001 8FBE 7167 7247'                          # bar copy: photo leg
$PHOTO_SHORT = N '62CD 7167'                                                      # photo (shortened copy)
$HINT_CALL = N '5DF2 62E8 53F7 8054 7CFB 5BA2 6237'                              # honest hint: dialled
$OVERCLAIM = N '5DF2 6838 5B9E 8054 7CFB 5BA2 6237'                              # over-claim wording
$BYPASS_NOTE = N '7ED5 8FC7 524D 7AEF'                                            # bypass honest note
$PLAIN_FRONTEND = N '524D 7AEF'
$NO_PROOF_CALL = N '65E0 6CD5 8BC1 660E 901A 8BDD 771F 7684 53D1 751F'            # "cannot prove the call happened"
$NO_PROOF_SHORT = N '65E0 6CD5 8BC1 660E 901A 8BDD'
$STALE_SKIP = N '8DF3 8FC7 4E4B 540E 53EF 5728 672C 9875'                        # stale "you may skip" comment
$GATE_SKIP_HINT = N '9001 8FBE 524D 9700 5148 7559 5B58 7167 7247 FF0C 6216 6539 7528 300C 8054 7CFB 5BA2 6237 300D'

$U = 'mini_shop\utils\delivery-gate.ts'
$D = 'mini_shop\subpkg-delivery\rider\detail.vue'

$mutations = @(
  # ---- the local gate state must really persist, per task ----
  @{ Name = 'G01 util stops exporting readDeliveryGate'; File = $U; Old = 'export function readDeliveryGate('; New = 'function readDeliveryGate(' },
  @{ Name = 'G02 storage key loses its task suffix separator'; File = $U; Old = "const STORAGE_PREFIX = 'rider-deliver-gate:'"; New = "const STORAGE_PREFIX = 'rider-deliver-gate'" },
  @{ Name = 'G03 state is written nowhere (no persistence)'; File = $U; Old = 'uni.setStorageSync(storageKey(taskId), JSON.stringify(next))'; New = 'uni.removeStorageSync(storageKey(taskId))' },
  @{ Name = 'G04 the bypass honesty note is deleted'; File = $U; Old = $BYPASS_NOTE; New = $PLAIN_FRONTEND },
  @{ Name = 'G05 the "no proof of a call" note is deleted'; File = $U; Old = $NO_PROOF_CALL; New = $NO_PROOF_SHORT },
  @{ Name = 'G06 a failed read defaults to SATISFIED (fail-open)'; File = $U; Old = 'return { photoKeys: [] }'; New = 'return { photoKeys: [' + "'x'" + '] }'; All = $true },
  # ---- the gate must actually block ----
  @{ Name = 'D01 the gate check is disabled'; File = $D; Old = 'if (!deliverGateSatisfied.value) {'; New = 'if (false) {' },
  @{ Name = 'D02 re-entry no longer re-reads the gate state'; File = $D; Old = 'gate.value = readDeliveryGate(taskId.value)'; New = 'gate.value = { photoKeys: [] }' },
  @{ Name = 'D03 the gate is hard-wired open'; File = $D; Old = 'const deliverGateSatisfied = computed(() => isDeliveryGateOpen(gate.value))'; New = 'const deliverGateSatisfied = computed(() => true)' },
  # ---- what counts as satisfying a leg ----
  @{ Name = 'D04 an empty/failed capture is recorded as a photo leg'; File = $D; Old = 'if (!keys.length) return'; New = 'if (false) return'; Index = 1 },
  @{ Name = 'D17 the gate drops its own skip hint (misleading "you can add it later")'; File = $D; Old = ("const keys = await captureProofImages('" + $GATE_SKIP_HINT + "')"); New = 'const keys = await captureProofImages()' },
  @{ Name = 'D05 the contact leg is marked outside the dialler success'; File = $D; Old = 'success: () => {'; New = 'complete: () => {' },
  # ---- the modal must say WHAT to do, and route to both legs ----
  @{ Name = 'D06 the gate modal goes back to a generic failure title'; File = $D; Old = ("    title: '" + $GATE_TITLE + "',"); New = ("    title: '" + $GENERIC_FAIL + "',") },
  @{ Name = 'D07 the gate bar photo button is unwired'; File = $D; Old = '@click="takeProofPhoto"'; New = '@click="noopHandler"' },
  @{ Name = 'D08 the gate bar call button is unwired'; File = $D; Old = '@click="callCustomer"'; New = '@click="noopHandler"'; All = $true },
  @{ Name = 'D09 the gate bar copy drops what to do (photo)'; File = $D; Old = $BAR_PHOTO; New = $PHOTO_SHORT },
  @{ Name = 'D10 the gate bar loses its open/closed state'; File = $D; Old = "deliverGateSatisfied ? 'is-open' : 'is-closed'"; New = "'is-open'" },
  # ---- honesty of the UI copy ----
  @{ Name = 'D11 the release hint over-claims (verified contact)'; File = $D; Old = $HINT_CALL; New = $OVERCLAIM },
  @{ Name = 'D12 the stale "photo may be skipped" comment comes back'; File = $D; Old = 'const proofKeys = pendingProofKeys.value.length ? [] : await captureProofImages()'; New = ('    // ' + $STALE_SKIP + " 24h`n" + '    const proofKeys = pendingProofKeys.value.length ? [] : await captureProofImages()') },
  # ---- existing behaviour must survive ----
  @{ Name = 'D13 pre-delivery photo keys are dropped from the attach'; File = $D; Old = 'const proofKeysToAttach = [...pendingProofKeys.value, ...proofKeys]'; New = 'const proofKeysToAttach = [...proofKeys]' },
  @{ Name = 'D14 the 24h proof re-upload entry disappears'; File = $D; Old = 'async function uploadProof('; New = 'async function uploadProofRemoved(' },
  @{ Name = 'D15 delivered stops carrying a location'; File = $D; Old = 'collectNodeLocation(true, true)'; New = 'collectNodeLocation(false, true)' },
  @{ Name = 'D16 the delivery call is renamed (ordering anchor goes dead)'; File = $D; Old = 'await deliverTask(taskId.value, body)'; New = 'await deliverTaskRenamed(taskId.value, body)' }
)

$ok = 0
$bad = 0
$restoreFailed = 0
$skipped = 0

Write-Output ('BASELINE :: ' + (Run-Contract).Msg)

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

Write-Output ('FINAL :: ' + (Run-Contract).Msg)
Write-Output ("MUTATION-SUMMARY :: total={0} :: ok={1} :: bad={2} :: restoreFailed={3} :: skipped={4}" -f $mutations.Count, $ok, $bad, $restoreFailed, $skipped)
if ($bad -gt 0 -or $restoreFailed -gt 0) { exit 1 }
exit 0
