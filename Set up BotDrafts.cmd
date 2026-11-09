@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/ first.
  pause
  exit /b 1
)
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 (
  pause
  exit /b 1
)
node setup.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo Setup complete. Open Start BotDrafts.vbs to start the helper.
pause
