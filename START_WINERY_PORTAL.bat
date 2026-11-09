@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
 echo Install Python, then run this launcher again.
 pause
 exit /b 1
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8091/"
python server.py
pause
