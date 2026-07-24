@echo off
setlocal
cd /d %~dp0\..

if exist .server.log del /f /q .server.log
if exist .client.log del /f /q .client.log

start "zashboard-server" /min cmd /c "cd /d %cd% && corepack pnpm run dev:server > .server.log 2>&1"
start "zashboard-client" /min cmd /c "cd /d %cd% && corepack pnpm run dev:client -- --host 0.0.0.0 > .client.log 2>&1"
