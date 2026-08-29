@echo off
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator permission for the Windows Firewall rule...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
  exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$name = 'Neural Avatar Pipeline LAN';" ^
  "Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule;" ^
  "New-NetFirewallRule -DisplayName $name -Group 'Neural Avatar Pipeline' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8788,8793,8794,8795,8796,8797 -Profile Private | Out-Null"

if errorlevel 1 (
  echo.
  echo The firewall rule could not be created.
  pause
  exit /b 1
)

echo.
echo LAN access is enabled for Neural Avatar Pipeline on private networks.
echo Restart the lab, then use one of the LAN WebUI addresses printed by launch.bat.
pause

