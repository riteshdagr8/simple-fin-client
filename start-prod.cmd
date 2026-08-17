@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "RUN_DIR=%ROOT_DIR%.run"
set "PID_FILE=%RUN_DIR%\prod.pid"
set "LOG_FILE=%RUN_DIR%\prod.log"
set "ERR_FILE=%RUN_DIR%\prod-error.log"

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"

if exist "%PID_FILE%" (
  set "PID="
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
  tasklist /FI "PID eq !PID!" /NH 2>nul | findstr /R /C:" !PID! " >nul
  if not errorlevel 1 (
    echo SimpleFinClient is already running in production ^(PID !PID!^). Stop it first with stop-prod.cmd.
    exit /b 1
  )
  del /q "%PID_FILE%" >nul 2>&1
)

echo Starting SimpleFinClient in production mode in the background...

powershell -NoProfile -Command "$env:NODE_ENV='production'; $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','npm start' -WorkingDirectory '%ROOT_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%LOG_FILE%' -RedirectStandardError '%ERR_FILE%' -PassThru; $p.Id | Out-File -Encoding ascii '%PID_FILE%'"

if not exist "%PID_FILE%" (
  echo Failed to start. See logs in "%RUN_DIR%".
  exit /b 1
)
for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
if not defined PID (
  echo Failed to start. See logs in "%RUN_DIR%".
  exit /b 1
)

tasklist /FI "PID eq %PID%" /NH 2>nul | findstr /R /C:" %PID% " >nul
if errorlevel 1 (
  echo SimpleFinClient exited during startup. See "%LOG_FILE%" and "%ERR_FILE%".
  exit /b 1
)

echo Started in production with PID %PID%.
echo App:  http://localhost:4200
echo Log:  %LOG_FILE%
echo Stop it anytime with: stop-prod.cmd
