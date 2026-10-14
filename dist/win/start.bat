@echo off
rem ===================================================================
rem  jpath-grabber (standalone) -- double-click me
rem
rem  This build bundles its own Python (see the "python" folder), so you
rem  do NOT need Python installed on this machine.
rem
rem  IMPORTANT: extract the WHOLE zip before running. Running start.bat
rem  from inside the zip viewer will not work.
rem ===================================================================
setlocal
cd /d "%~dp0"
set "PY=%~dp0python\python.exe"

if not exist "%PY%" goto :nopy

echo [*] bundled Python:
"%PY%" -V
echo.
"%PY%" "%~dp0backend\collector.py" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [x] collector exited with code %RC%
echo Press any key to close this window...
pause >nul
exit /b %RC%

:nopy
echo [x] python\python.exe not found - the archive was not extracted fully.
echo     Please extract the WHOLE zip to a folder first, then run start.bat.
echo Press any key to close this window...
pause >nul
exit /b 1
