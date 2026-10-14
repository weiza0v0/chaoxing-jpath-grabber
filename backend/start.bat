@echo off
rem ===================================================================
rem  chaoxing-jpath-grabber -- Windows launcher (just double-click me)
rem
rem  This project has ZERO third-party dependencies (Python stdlib only),
rem  so there is nothing to "pip install". This script only:
rem    1. locates a usable Python 3.8+
rem    2. offers to install one via winget if missing
rem    3. runs a stdlib self-check
rem    4. starts the collector
rem
rem  Search order (explicit locations ONLY - we never look for "python" on
rem  PATH, because on Windows that normally resolves to the 2-byte Microsoft
rem  Store placeholder in WindowsApps, and even when it is real, which
rem  interpreter wins is unpredictable):
rem     0) <repo>\runtime\python  (see fetch-runtime.bat)
rem     1) the official Python Launcher, py -3
rem     2) conda / miniconda / anaconda in the usual install locations
rem  Every candidate is VALIDATED by actually running it.
rem
rem  NOTE: keep this file pure ASCII and CRLF. cmd.exe reads .bat using the
rem  OEM code page (GBK on zh-CN Windows), so a UTF-8 file with Chinese text
rem  gets mis-decoded: multi-byte sequences swallow following ASCII chars,
rem  which breaks "rem" comments and "setlocal" and crashes at parse time.
rem ===================================================================
setlocal
cd /d "%~dp0"

set "PY="

rem --- 0) portable runtime fetched by fetch-runtime.bat: takes priority,
rem     so this repo never depends on conda / PATH / system installs ---
if exist "%~dp0..\runtime\python\python.exe" set "PY=%~dp0..\runtime\python\python.exe"
if defined PY goto :checkpy

rem --- 1) the py launcher ---
where py >nul 2>nul
if not errorlevel 1 call :validate "py -3"
if defined PY goto :checkpy

rem --- 2) conda / miniconda / anaconda, explicit install locations only ---
call :tryconda "%USERPROFILE%\miniconda3"
call :tryconda "%USERPROFILE%\anaconda3"
call :tryconda "%USERPROFILE%\Miniconda3"
call :tryconda "%USERPROFILE%\Anaconda3"
call :tryconda "%USERPROFILE%\AppData\Local\miniconda3"
call :tryconda "%USERPROFILE%\AppData\Local\anaconda3"
call :tryconda "%ProgramData%\miniconda3"
call :tryconda "%ProgramData%\Anaconda3"
call :tryconda "%ProgramData%\Miniconda3"
if defined PY goto :checkpy
goto :nopython

:validate
if defined PY goto :eof
set "CAND=%~1"
%CAND% -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
if errorlevel 1 goto :eof
set "PY=%CAND%"
goto :eof

:tryconda
if defined PY goto :eof
if not exist "%~1\python.exe" goto :eof
"%~1\python.exe" -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
if errorlevel 1 goto :eof
set "PY=%~1\python.exe"
goto :eof

:checkpy
if not defined PY goto :nopython

echo [*] Python: %PY%
%PY% -c "import http.server,json,os,re,struct,subprocess,sys,zlib; print('[*] stdlib self-check OK - no pip install needed')"
if errorlevel 1 goto :broken

echo.
%PY% collector.py %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [x] collector exited with code %RC%
echo Press any key to close this window...
pause >nul
exit /b %RC%

:nopython
echo [x] No usable Python 3.8+ found.
echo.
echo     Tip: run fetch-runtime.bat to get a portable Python into
echo       <repo>\runtime\python - no installer, nothing system-wide.
echo.
echo     Looked for: <repo>\runtime, the py launcher, and conda at
echo       USERPROFILE\miniconda3 ^| anaconda3 ^| AppData\Local\...
echo.
echo     We intentionally do NOT use "python" from PATH: that is usually the
echo       LOCALAPPDATA\Microsoft\WindowsApps\python.exe
echo     placeholder, which is a ~2 byte Microsoft Store stub, not a real
echo     Python.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :manual
echo     winget is available and can install Python 3.12 for you.
set /p ANS="    Install Python 3.12 via winget now? [y/N] "
if /i not "%ANS%"=="y" goto :manual
echo.
winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
echo.
echo     Finished. Close this window, then double-click this script again
echo     (the PATH change needs a fresh window).
echo Press any key to close this window...
pause >nul
exit /b 0

:manual
echo     Please install Python manually: https://www.python.org/downloads/
echo     Remember to tick "Add python.exe to PATH" during setup.
echo Press any key to close this window...
pause >nul
exit /b 1

:broken
echo [x] The Python stdlib self-check failed - that install looks incomplete.
echo Press any key to close this window...
pause >nul
exit /b 1
