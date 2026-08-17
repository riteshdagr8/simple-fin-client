@echo off
cd /d "%~dp0"
echo Starting SimpleFinClient...
echo.
echo [1/2] Starting Express API server on port 4200...
start "Express" cmd /c "set PORT=4200 && set NODE_ENV=development && node server/index.js"
timeout /t 3 /nobreak >nul
echo [2/2] Starting Vite frontend on port 6173...
start "Vite" cmd /c "npx vite --host"
echo.
echo Both servers starting.
echo   API:  http://localhost:4200
echo   App:  http://localhost:6173
echo.
echo Close the server windows or run stop.bat to shut down.
