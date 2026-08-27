@echo off
cd /d "%~dp0"
title WINGLOBAL

if not exist "index.html" (
  echo ERROR: index.html not found in this folder.
  pause
  exit /b 1
)

REM Stop only an old server using port 8000.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8000 .*LISTENING" 2^>nul') do taskkill /F /PID %%P >nul 2>&1

timeout /t 1 /nobreak >nul

REM Start the same Python server command that already worked manually.
start "WINGLOBAL SERVER - KEEP OPEN" cmd /k "cd /d ""%~dp0"" && python -m http.server 8000"

timeout /t 2 /nobreak >nul

REM Open in a normal Chrome/browser tab, not Chrome app mode.
start "" "http://localhost:8000/index.html"

exit /b 0
