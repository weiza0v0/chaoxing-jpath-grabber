@echo off
rem ===================================================================
rem  Fetch a PORTABLE Python into <repo>\runtime\python
rem
rem  After this, start.bat / make-pdf.bat prefer that interpreter and never
rem  touch conda, PATH, or anything system-wide. Deleting the "runtime"
rem  folder undoes it completely.
rem
rem  Uses the official Windows *embeddable* package (~10 MB): no installer,
rem  no registry, no PATH changes.
rem
rem  Downloads with the built-in curl.exe, extracts with the built-in
rem  tar.exe (bsdtar). So this script needs NO Python at all -- it
rem  bootstraps Python from nothing.
rem
rem  Each mirror gets a FULL attempt (download -> extract -> verify). Only
rem  when python.exe actually shows up do we accept it, so a truncated or
rem  bogus download can never slip through.
rem
rem  NOTE: keep this file pure ASCII and CRLF (see start.bat for why).
rem ===================================================================
setlocal
cd /d "%~dp0"

set "PYVER=3.12.7"
set "ROOT=%~dp0.."
set "RUNTIME=%ROOT%\runtime"
set "DEST=%RUNTIME%\python"
set "ZIP=%RUNTIME%\python-embed.zip"

if exist "%DEST%\python.exe" goto :already

where curl.exe >nul 2>nul
if errorlevel 1 goto :nocurl

if not exist "%RUNTIME%" mkdir "%RUNTIME%"

set "M1=https://registry.npmmirror.com/-/binary/python/%PYVER%/python-%PYVER%-embed-amd64.zip"
set "M2=https://mirrors.huaweicloud.com/python/%PYVER%/python-%PYVER%-embed-amd64.zip"
set "M3=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip"

echo [*] Fetching Windows embeddable Python %PYVER%
echo     into: %DEST%
echo.

set "OK="
call :attempt "%M1%" no-proxy
if defined OK goto :success
echo       -- failed, trying next mirror
echo.
call :attempt "%M2%" no-proxy
if defined OK goto :success
echo       -- failed, trying next mirror
echo.
call :attempt "%M3%" with-proxy
if defined OK goto :success
goto :dlfail

:success
if exist "%ZIP%" del "%ZIP%" >nul 2>nul
echo.
echo [*] Portable Python ready:
"%DEST%\python.exe" -V
echo.
echo [*] Done. start.bat and make-pdf.bat will now use this Python.
echo     Nothing was installed system-wide; delete the "runtime" folder to undo.
echo Press any key to close this window...
pause >nul
exit /b 0

rem ---------------------------------------------------------------
rem  :attempt <url> <no-proxy|with-proxy>
rem  download -> extract -> verify. Only a real python.exe counts.
rem ---------------------------------------------------------------
:attempt
echo [*] trying %~1
if exist "%ZIP%" del "%ZIP%" >nul 2>nul
if exist "%DEST%" rmdir /s /q "%DEST%" >nul 2>nul

if /i "%~2"=="no-proxy" (
  curl.exe -fsSL --noproxy "*" --retry 3 --connect-timeout 20 --max-time 300 -o "%ZIP%" "%~1"
) else (
  curl.exe -fsSL --retry 3 --connect-timeout 20 --max-time 300 -o "%ZIP%" "%~1"
)
if errorlevel 1 goto :eof
if not exist "%ZIP%" goto :eof

mkdir "%DEST%" >nul 2>nul
where tar.exe >nul 2>nul
if errorlevel 1 goto :attempt_ps
tar.exe -xf "%ZIP%" -C "%DEST%" >nul 2>nul
if not errorlevel 1 goto :attempt_check
:attempt_ps
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%DEST%' -Force" >nul 2>nul
:attempt_check
if not exist "%DEST%\python.exe" goto :eof
set "OK=1"
goto :eof

:already
echo [*] Portable Python already present:
"%DEST%\python.exe" -V
echo.
echo     Delete the "runtime" folder if you want to re-download it.
echo Press any key to close this window...
pause >nul
exit /b 0

:nocurl
echo [x] curl.exe not found. It ships with Windows 10 1803 and newer.
echo     Update Windows, or download the Windows embeddable package manually
echo     from https://www.python.org/downloads/windows/ and extract it into:
echo       %DEST%
echo Press any key to close this window...
pause >nul
exit /b 1

:dlfail
echo [x] All mirrors failed. Check your network, or download the Windows
echo     embeddable package manually from
echo       https://www.python.org/downloads/windows/
echo     and extract it into:
echo       %DEST%
echo Press any key to close this window...
pause >nul
exit /b 1
