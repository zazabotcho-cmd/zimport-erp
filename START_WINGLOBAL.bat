@echo off
title WINGLOBAL
cd /d "%~dp0"

if not exist "index.html" (
    echo ERROR: index.html was not found in this folder.
    pause
    exit /b
)

echo Starting WINGLOBAL...
echo Keep this black window OPEN while using WINGLOBAL.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000/index.html"
python -m http.server 8000 --bind 127.0.0.1

echo.
echo WINGLOBAL server stopped.
pause
