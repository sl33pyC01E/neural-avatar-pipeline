@echo off
setlocal
cd /d "%~dp0"

set "UNIFIED_EFFICIENCY_MODE=1"
call "%~dp0launch.bat"
exit /b %ERRORLEVEL%
