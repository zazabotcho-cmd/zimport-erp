@echo off
setlocal
title WINGLOBAL PROGRAM Launcher
pushd "%~dp0"

if not exist "index.html" (
  echo ERROR: index.html is not in this folder.
  echo Keep this launcher in the same folder as index.html.
  pause
  exit /b 1
)

REM If the server is already running, just open WINGLOBAL.
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://localhost:8000/' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto OPEN_APP

REM Prefer the Windows Python launcher 'py', then fall back to 'python'.
where py >nul 2>&1
if %errorlevel%==0 (
  start "WINGLOBAL Server" /min py -m http.server 8000
  goto WAIT_SERVER
)

where python >nul 2>&1
if %errorlevel%==0 (
  start "WINGLOBAL Server" /min python -m http.server 8000
  goto WAIT_SERVER
)

echo.
echo ERROR: Python could not be found.
echo Python is installed, but Windows cannot find the command.
echo Try restarting Windows, then run this launcher again.
echo.
pause
exit /b 1

:WAIT_SERVER
timeout /t 3 /nobreak >nul

:OPEN_APP
REM Open in Chrome if installed; otherwise use the default browser.
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "http://localhost:8000/"
  goto DONE
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "http://localhost:8000/"
  goto DONE
)
start "" "http://localhost:8000/"

:DONE
popd
exit /b 0
