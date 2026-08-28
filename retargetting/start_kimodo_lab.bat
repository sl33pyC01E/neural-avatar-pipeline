@echo off
setlocal
cd /d "%~dp0"
set "KIMODO_LAB_PORT=8792"
echo Starting Kimodo 3D Lab on http://127.0.0.1:%KIMODO_LAB_PORT%/
echo Kimodo model server will start on demand at 127.0.0.1:17654.
node kimodo-lab-server.js
pause
