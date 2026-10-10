# ASCII-only launcher for the staff-h5 first-login-change-password contract.
#
# Why this file exists:
#   tests/first-login-change-password.contract.ps1 is UTF-8 *without* BOM and contains Chinese text.
#   Windows PowerShell 5.1 parses such a file as ANSI -> mojibake / parse errors.
#   This launcher is pure ASCII, so PS 5.1 parses it correctly; it then makes a
#   BOM-prefixed copy with a UNIQUE file name in %TEMP%, runs that copy, and deletes it.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\staff-h5\tests\run-contract.ps1
# Exit code: 0 = all assertions passed, 1 = at least one failed.

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($here)) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$staffRoot = Split-Path -Parent $here
$source = Join-Path $here 'first-login-change-password.contract.ps1'

if (-not (Test-Path $source)) { throw "contract not found: $source" }

$temp = Join-Path $env:TEMP ('flcp-' + [guid]::NewGuid().ToString('N') + '.ps1')
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($temp, [System.IO.File]::ReadAllText($source), $utf8Bom)

try {
  $env:STAFF_H5_ROOT = $staffRoot
  & powershell -NoProfile -ExecutionPolicy Bypass -File $temp
  $code = $LASTEXITCODE
} finally {
  Remove-Item $temp -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\STAFF_H5_ROOT -ErrorAction SilentlyContinue
}

exit $code
