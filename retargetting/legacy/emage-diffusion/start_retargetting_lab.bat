@echo off
setlocal
cd /d "%~dp0"
set "RETARGETTING_PORT=8791"
echo Starting EMAGE 3D Retargetting Lab on http://127.0.0.1:%RETARGETTING_PORT%/
echo Close this window to stop the lab server.
node server.js
pause
