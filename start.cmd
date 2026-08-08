@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
set "RUN_DIR=%ROOT_DIR%.run"
set "PID_FILE=%RUN_DIR%\dev.pid"
set "LOG_FILE=%RUN_DIR%\dev.log"
set "ERR_FILE=%RUN_DIR%\dev-error.log"

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"

if exist "%PID_FILE%" (
  set "PID="
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
  tasklist /FI "PID eq !PID!" /NH 2>nul | findstr /R /C:" !PID! " >nul
  if not errorlevel 1 (
    echo SimpleFinClient is already running ^(PID !PID!^). Stop it first with stop.cmd.
    exit /b 1
  )
  del /q "%PID_FILE%" >nul 2>&1
)

echo Starting SimpleFinClient development server in the background...

rem Launch the dev server hidden and detached. We spawn cmd.exe explicitly with
rem -WindowStyle Hidden and redirect output to log files, so the spawned tree
rem holds none of this script's console or stdout handles and the script can
rem return to the prompt immediately. The PID is written to a file (not piped)
rem to avoid a hung `for /f` reading a pipe that a long-running child inherits.
powershell -NoProfile -Command "$env:PORT='4200'; $env:NODE_ENV='development'; $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','npm run dev' -WorkingDirectory '%ROOT_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%LOG_FILE%' -RedirectStandardError '%ERR_FILE%' -PassThru; $p.Id | Out-File -Encoding ascii '%PID_FILE%'"

if not exist "%PID_FILE%" (
  echo Failed to start SimpleFinClient. See logs in "%RUN_DIR%".
  exit /b 1
)
for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
if not defined PID (
  echo Failed to start SimpleFinClient. See logs in "%RUN_DIR%".
  exit /b 1
)

tasklist /FI "PID eq %PID%" /NH 2>nul | findstr /R /C:" %PID% " >nul
if errorlevel 1 (
  echo SimpleFinClient exited during startup. See "%LOG_FILE%" and "%ERR_FILE%".
  exit /b 1
)

echo Started in the background with PID %PID%.
echo Frontend: http://localhost:6173
echo API:      http://localhost:4200
echo Log:      %LOG_FILE%
echo Stop it anytime with: stop.cmd
