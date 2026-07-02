@echo off
echo Stopping SimpleFinClient servers...
taskkill /fi "WINDOWTITLE eq Express" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Vite" /f >nul 2>&1
echo Done.
