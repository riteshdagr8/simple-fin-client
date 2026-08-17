@echo off
setlocal EnableExtensions EnableDelayedExpansion
title SimpleFinClient - One-time Install
cd /d "%~dp0"

echo.
echo  ====================================================
echo    SimpleFinClient - One-time Install
echo  ====================================================
echo.

rem --- Check Node.js ---
where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed.
  echo.
  echo  SimpleFinClient needs Node.js 18 or newer to run.
  echo  Please install it from:  https://nodejs.org
  echo  Choose the "LTS" version.
  echo.
  echo  After installing, close this window and run install.cmd again.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo  Node.js found: !NODE_VER!
echo.

rem --- Create .env from .env.example if missing ---
if not exist ".env" (
  echo  [1/4] Creating configuration file .env ...
  if not exist ".env.example" (
    echo  ERROR: .env.example is missing. Did you download the full project?
    pause
    exit /b 1
  )
  copy /y ".env.example" ".env" >nul

  rem Auto-generate a random JWT secret (48 bytes hex) and encryption key (32 bytes hex)
  for /f "delims=" %%s in ('node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"') do set "JWT=%%s"
  for /f "delims=" %%e in ('node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"') do set "ENC=%%e"

  rem APP_URL must be https in production mode; point it at the local app.
  powershell -NoProfile -Command "(Get-Content -Raw '.env') -replace '^JWT_SECRET=.*$', 'JWT_SECRET=%JWT%' -replace '^ENCRYPTION_KEY=.*$', 'ENCRYPTION_KEY=%ENC%' -replace '^APP_URL=.*$', 'APP_URL=https://localhost:4200' | Set-Content -NoNewline '.env'"
  echo  Configuration created with a random JWT secret and encryption key.
) else (
  echo  [1/4] Configuration file .env already exists - keeping it.
)
echo.

echo  [2/4] Installing dependencies (this can take a few minutes)...
call npm install
if errorlevel 1 (
  echo  ERROR: npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.

echo  [3/4] Building the app...
call npm run build
if errorlevel 1 (
  echo  ERROR: Build failed.
  pause
  exit /b 1
)
echo.

echo  [4/4] Done!
echo.
echo  ====================================================
echo    SimpleFinClient is installed!
echo.
echo    To start it, double-click:  start.cmd
echo    Then open your browser to:  http://localhost:4200
echo.
echo    To stop it later, double-click:  stop.cmd
echo  ====================================================
echo.
echo  Next steps inside the app:
echo    - Create an account (top-right)
echo    - Add your SimpleFIN setup token under Connections
echo.
pause
