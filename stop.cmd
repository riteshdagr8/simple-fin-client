@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
set "PID_FILE=%ROOT_DIR%.run\dev.pid"

if not exist "%PID_FILE%" (
  echo SimpleFinClient is not running.
  exit /b 0
)

rem `for /f` strips the trailing CR that `set /p` would leave in the variable.
for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "PID=%%P"
del /q "%PID_FILE%" >nul 2>&1

tasklist /FI "PID eq %PID%" /NH 2>nul | findstr /R /C:" %PID% " >nul
if errorlevel 1 (
  echo Removed stale PID file.
  exit /b 0
)

echo Stopping SimpleFinClient ^(PID %PID%^)...
rem The dev server runs in a hidden console, so a graceful close always
rem fails; taskkill /F (tree) is the reliable path. SQLite WAL mode makes
rem a forced kill safe — the WAL is recovered on the next open.
taskkill /PID %PID% /T >nul 2>&1
if errorlevel 1 taskkill /PID %PID% /T /F >nul 2>&1
if errorlevel 1 (
  echo Failed to stop process tree. Check PID %PID% in Task Manager.
  exit /b 1
)
echo SimpleFinClient stopped.
