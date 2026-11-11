@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
 echo Install Python, then run this launcher again.
 pause
 exit /b 1
)
echo Starting updated WINGLOBAL portal R31...
powershell -NoProfile -Command "$connections = Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue; foreach ($connection in $connections) { $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $connection.OwningProcess); if ($processInfo.Name -match '^python(w|[0-9.]*)?\.exe$' -and $processInfo.CommandLine -match 'server\.py') { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue } }"
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8091/?build=20261111-r31"
python server.py
pause
