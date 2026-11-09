@echo off
cd /d "%~dp0"
if not exist "assets\catalog.json" (
  echo Run Set up BotDrafts.cmd first.
  pause
  exit /b 1
)
start "BotDrafts Helper" /min node "%~dp0server.mjs" --open
