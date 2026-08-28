@echo off
setlocal
cd /d "%~dp0.."
call launch.bat
if errorlevel 1 (
  echo.
  echo Unified Lab could not start. Review the message above.
  pause
)
