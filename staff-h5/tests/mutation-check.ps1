# ASCII-only mutation-test harness for the staff-h5 contract suite.
#
# Why ASCII-only + JSON data file:
#   This script must contain NO non-ASCII characters. Windows PowerShell 5.1 parses a
#   .ps1 without a UTF-8 BOM as ANSI, which corrupts any Chinese literal *before* the
#   script runs (that silently turned several mutations into "needle not found" no-ops).
#   The mutation table therefore lives in first-login-change-password.mutations.json and is
#   read with [System.IO.File]::ReadAllText(..., UTF8) so Chinese needles always survive.
#
# For each mutation:
#   snapshot bytes -> apply exactly -> run contract (expect FAIL)
#   -> restore original bytes byte-identically -> verify SHA256 -> run contract again (expect PASS).
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\staff-h5\tests\mutation-check.ps1
# Exit:   0 = every mutation was caught AND every restore was byte-identical, 1 = otherwise.

$ErrorActionPreference = 'Stop'

$root = 'E:\work\JJ\LonPin\staff-h5'
$here = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($here)) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not (Test-Path (Join-Path $root 'src'))) { $root = Split-Path -Parent $here }

$runner = Join-Path $here 'run-contract.ps1'
$table = Join-Path $here 'first-login-change-password.mutations.json'

if (-not (Test-Path $table)) { throw "mutation table not found: $table" }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$mutations = ([System.IO.File]::ReadAllText($table, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).mutations
if (-not $mutations -or $mutations.Count -eq 0) { throw "mutation table is empty: $table" }

function Get-Sha([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
  finally { $sha.Dispose() }
}

function Invoke-Contract {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $runner 2>&1
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
}

# Rebuild the bundle (needed for the dist-artifact assertion).
# Vite prints a benign INEFFECTIVE_DYNAMIC_IMPORT *notice* on stderr; with
# $ErrorActionPreference = 'Stop' PowerShell would treat that as a terminating error,
# so relax the preference for the duration of the build and restore it afterwards.
function Invoke-Rebuild {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Push-Location $root
    try { & pnpm build 2>&1 | Out-Null } finally { Pop-Location }
  } finally {
    $ErrorActionPreference = $previous
  }
}

$results = @()
foreach ($m in $mutations) {
  $path = Join-Path $root $m.File
  if (-not (Test-Path $path)) {
    Write-Output ("SKIP  {0}  (file not found: {1})" -f $m.Name, $m.File)
    $results += [pscustomobject]@{ Name = $m.Name; Mutated = 'NO-FILE'; Restored = 'n/a'; HashOk = 'n/a' }
    continue
  }

  $original = [System.IO.File]::ReadAllBytes($path)
  $hashBefore = Get-Sha $original
  $text = [System.Text.Encoding]::UTF8.GetString($original)

  $applied = $false
  if ($m.Regex) {
    $mutatedText = [regex]::Replace($text, $m.Old, $m.New, 1)
    $applied = ($mutatedText -ne $text)
  } elseif ($text.Contains($m.Old)) {
    $mutatedText = $text.Replace($m.Old, $m.New)
    $applied = $true
  } else {
    $mutatedText = $text
  }

  if (-not $applied) {
    Write-Output ("SKIP  {0}  (needle not found)" -f $m.Name)
    $results += [pscustomobject]@{ Name = $m.Name; Mutated = 'NOT-FOUND'; Restored = 'n/a'; HashOk = 'n/a' }
    continue
  }

  [System.IO.File]::WriteAllText($path, $mutatedText, $utf8)
  if ($m.Rebuild) { Invoke-Rebuild }
  $mutated = Invoke-Contract

  [System.IO.File]::WriteAllBytes($path, $original)
  $hashAfter = Get-Sha ([System.IO.File]::ReadAllBytes($path))
  $hashOk = ($hashAfter -eq $hashBefore)
  # rebuild from the restored source so the dist-artifact check reflects the real code again
  if ($m.Rebuild) { Invoke-Rebuild }
  $clean = Invoke-Contract

  Write-Output ("{0,-6} {1}" -f $(if ($mutated.Code -ne 0) { 'OK' } else { 'BAD' }), $m.Name)
  $results += [pscustomobject]@{
    Name     = $m.Name
    Mutated  = $(if ($mutated.Code -ne 0) { 'FAIL(as expected)' } else { 'PASS(!!) NOT CAUGHT' })
    Restored = ('exit=' + $clean.Code)
    HashOk   = $hashOk
  }
}

Write-Output ''
Write-Output '===== SUMMARY ====='
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output

$notCaught = @($results | Where-Object { $_.Mutated -ne 'FAIL(as expected)' })
$hashBad = @($results | Where-Object { $_.HashOk -ne $true })
Write-Output ("mutations={0} not-caught={1} hash-mismatch={2}" -f $results.Count, $notCaught.Count, $hashBad.Count)
if ($notCaught.Count -gt 0 -or $hashBad.Count -gt 0) { exit 1 }
exit 0
