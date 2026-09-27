param([switch]$Clean)
$ErrorActionPreference = 'Stop'
$bundle = $PSScriptRoot
$env:JAVA_HOME = Join-Path $bundle 'toolchain/jdk'
$env:ANDROID_HOME = Join-Path $bundle 'toolchain/sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $bundle 'toolchain/gradle-home'
$env:ANDROID_USER_HOME = Join-Path $bundle 'toolchain/android-user'
$env:PATH = "$env:JAVA_HOME\bin;$(Join-Path $bundle 'toolchain/node');$env:PATH"
$project = Join-Path $bundle 'project/avatar-validation'
$tasks = @(':app:assembleDebug', ':app:lintDebug')
if ($Clean) { $tasks = @('clean') + $tasks }
& (Join-Path $project 'gradlew.bat') -p $project --offline --no-daemon --console=plain @tasks
if ($LASTEXITCODE -ne 0) { throw 'Portable build failed.' }
Write-Host 'Built APK is under project/avatar-validation/app/build/outputs/apk/debug. No phone was used.'
