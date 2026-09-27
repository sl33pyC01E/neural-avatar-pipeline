$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'toolchain/python/python.exe') -X utf8 (Join-Path $PSScriptRoot 'install.py') --verify
if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed.' }
