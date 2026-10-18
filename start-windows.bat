@echo off
title Dara CRM
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo Dara needs Node.js 22.13 or newer. You have:
  node --version
  echo Install the current LTS from https://nodejs.org
  pause
  exit /b 1
)
start "" http://localhost:4310
npm start
pause
