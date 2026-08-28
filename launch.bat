@echo off
setlocal
cd /d "%~dp0"

if not exist "runtime\node\node.exe" (
  echo Unified Lab is incomplete: bundled Node.js was not found.
  pause
  exit /b 1
)

echo Starting Unified Lab...
"runtime\node\node.exe" "launcher.mjs"
set "LAB_EXIT=%ERRORLEVEL%"

if not "%LAB_EXIT%"=="0" (
  echo.
  echo Unified Lab stopped with an error. Check the logs folder for details.
  pause
)

exit /b %LAB_EXIT%
