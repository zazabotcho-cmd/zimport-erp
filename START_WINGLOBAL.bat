@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title WINGLOBAL Launcher

if not exist "index.html" (
  echo.
  echo ERROR: index.html is missing.
  echo Keep START_WINGLOBAL.bat in the same folder as index.html.
  echo.
  pause
  exit /b 1
)

REM Close any OLD local server left on WINGLOBAL's dedicated port.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8765 .*LISTENING" 2^>nul') do (
  taskkill /F /PID %%P >nul 2>&1
)

REM Small delay so Windows releases the port.
timeout /t 1 /nobreak >nul

REM Start a fresh server FROM THIS EXACT FOLDER.
start "WINGLOBAL LOCAL SERVER" /min cmd /c "cd /d ""%~dp0"" && python -m http.server 8765 --bind 127.0.0.1"

REM Wait until the local server is actually responding.
set READY=
for /L %%I in (1,1,12) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8765/index.html'; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
  if not errorlevel 1 (
    set READY=1
    goto :OPENAPP
  )
  timeout /t 1 /nobreak >nul
)

echo.
echo WINGLOBAL server did not start correctly.
echo.
echo Test this in Command Prompt:
echo python -m http.server 8765 --bind 127.0.0.1
echo.
pause
exit /b 1

:OPENAPP
REM Add a changing query value so Chrome does not reuse a stale page.
for /f %%T in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set TS=%%T
set URL=http://127.0.0.1:8765/index.html?v=%TS%

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="%URL%"
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="%URL%"
  exit /b 0
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app="%URL%"
  exit /b 0
)

start "" "%URL%"
exit /b 0
