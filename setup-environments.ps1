[CmdletBinding()]
param(
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$python310 = Join-Path $projectRoot 'runtime\python310\python.exe'
$python312 = Join-Path $projectRoot 'runtime\python312\python.exe'

function Require-File([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
    }
}

function New-ProjectVenv([string]$RelativePath, [string]$BasePython, [bool]$IncludeSystemPackages) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath))
    $rootPrefix = $projectRoot.TrimEnd('\') + '\'
    if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to manage an environment outside the project: $target"
    }
    if ((Test-Path -LiteralPath $target) -and $Rebuild) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'Scripts\python.exe'))) {
        $arguments = @('-m', 'venv')
        if ($IncludeSystemPackages) { $arguments += '--system-site-packages' }
        $arguments += $target
        Invoke-Checked $BasePython $arguments
    }
    return Join-Path $target 'Scripts\python.exe'
}

Require-File $python310 'Bundled Python 3.10'
Require-File $python312 'Bundled Python 3.12'
Require-File (Join-Path $projectRoot 'requirements\python312-shared.lock.txt') 'Shared Python lock'
Require-File (Join-Path $projectRoot 'requirements\ardy-overlay.lock.txt') 'ARDY overlay lock'
Require-File (Join-Path $projectRoot 'requirements\pockettts-overlay.lock.txt') 'PocketTTS overlay lock'
Require-File (Join-Path $projectRoot 'requirements\lam-python310.lock.txt') 'LAM lock'
Require-File (Join-Path $projectRoot 'ardy\pyproject.toml') 'Vendored ARDY source'
Require-File (Join-Path $projectRoot 'face_animation\LAM-Audio2Expression\inference_streaming_audio.py') 'LAM source checkout'

Write-Host 'Installing the exact shared Python 3.12 dependency set...'
Invoke-Checked $python312 @('-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', (Join-Path $projectRoot 'requirements\python312-shared.lock.txt'))

Write-Host 'Creating the ARDY overlay...'
$ardyPython = New-ProjectVenv 'ardy\.venv' $python312 $true
Invoke-Checked $ardyPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--requirement', (Join-Path $projectRoot 'requirements\ardy-overlay.lock.txt'))
Invoke-Checked $ardyPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--editable', (Join-Path $projectRoot 'ardy'))

Write-Host 'Creating the PocketTTS overlay...'
$pocketPython = New-ProjectVenv 'voice\pocket_tts' $python312 $true
Invoke-Checked $pocketPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', '--requirement', (Join-Path $projectRoot 'requirements\pockettts-overlay.lock.txt'))

Write-Host 'Creating the isolated LAM environment...'
$lamPython = New-ProjectVenv 'face_animation\LAM-Audio2Expression\.venv' $python310 $false
Invoke-Checked $lamPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', (Join-Path $projectRoot 'requirements\lam-python310.lock.txt'))

Write-Host 'Environment setup complete. Model payloads, CUDA files, and the local VRM remain separate prerequisites.'
