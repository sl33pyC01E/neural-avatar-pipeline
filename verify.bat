@echo off
setlocal
cd /d "%~dp0"

if not exist "runtime\node\node.exe" (
  echo [MISSING] Bundled Node.js
  pause
  exit /b 1
)

"runtime\node\node.exe" "verify.mjs" %*
set "VERIFY_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %VERIFY_EXIT%
