param([Parameter(Mandatory=$true)][int]$Transport)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'toolchain/python/python.exe') -X utf8 (Join-Path $PSScriptRoot 'install.py') --transport $Transport
if ($LASTEXITCODE -ne 0) { throw 'Install failed; no app was launched.' }
