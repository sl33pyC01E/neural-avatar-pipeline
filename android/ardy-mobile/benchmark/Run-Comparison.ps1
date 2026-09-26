param(
    [ValidateSet('gemma-litert-cpu','gemma-litert-gpu')][string]$Engine='gemma-litert-gpu',
    [ValidateSet('idle','full')][string]$Load='full',
    [int]$Transport=1,
    [switch]$AllCases
)
# User launches this script. The coding agent does not run phone tests.
$mobileRoot=Split-Path -Parent $PSScriptRoot
$adbPath=Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$caseLimit=if($AllCases){0}else{3}
Write-Host 'Warm Together with Benchmark workload enabled in tab 6.'
if($Load -eq 'idle'){Write-Host 'Then press Stop all, leaving the warm app visible.'}
else{Write-Host 'Leave Repeat Together running and the app visible.'}
Read-Host 'Press Enter when the phone is ready' | Out-Null
Push-Location $mobileRoot
try {
    python tools/run_phone_benchmark.py --run --engine $Engine --load $Load --limit $caseLimit --adb $adbPath --transport $Transport
} finally { Pop-Location }
