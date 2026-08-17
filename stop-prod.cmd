@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
set "PID_FILE=%ROOT_DIR%.run\prod.pid"

if not exist "%PID_FILE%" (
  echo SimpleFinClient is not running in production.
  exit /b 0
)

for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
del /q "%PID_FILE%" >nul 2>&1

tasklist /FI "PID eq %PID%" /NH 2>nul | findstr /R /C:" %PID% " >nul
if errorlevel 1 (
  echo Removed stale PID file.
  exit /b 0
)

echo Stopping SimpleFinClient ^(PID %PID%^)...
taskkill /PID %PID% /T >nul 2>&1
if errorlevel 1 taskkill /PID %PID% /T /F >nul 2>&1
if errorlevel 1 (
  echo Failed to stop process tree. Check PID %PID% in Task Manager.
  exit /b 1
)
echo SimpleFinClient stopped.
