@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
set "CLOUDFLARED=C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
set "LOG_FILE=%PROJECT_ROOT%cloudflared-live.log"

if exist "%LOG_FILE%" del /f /q "%LOG_FILE%"

"%CLOUDFLARED%" tunnel --url http://127.0.0.1:4173 --no-autoupdate > "%LOG_FILE%" 2>&1
