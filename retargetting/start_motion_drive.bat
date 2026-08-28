@echo off
cd /d "%~dp0"
start "Motion Drive" http://127.0.0.1:8793/
"..\runtime\node\node.exe" motion-control-server.js
