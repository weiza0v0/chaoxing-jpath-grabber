@echo off
rem ===================================================================
rem  Rebuild the PDF by hand. The collector normally does this for you
rem  automatically once a grab finishes; this is for re-runs.
rem
rem    make-pdf.bat                 list collected books
rem    make-pdf.bat <book-id>       rebuild that book
rem    make-pdf.bat <book-id> 281   rebuild with a custom dpi
rem
rem  NOTE: keep this file pure ASCII and CRLF (see start.bat for why).
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

if "%~1"=="" goto :list

set "TARGET=%~1"
if exist "%TARGET%\" goto :havedir
set "DIR=%~dp0..\output\%TARGET%"
goto :checkdir
:havedir
set "DIR=%TARGET%"
:checkdir
if not exist "%DIR%\" goto :nodir

if "%~2"=="" goto :noodpi
%PY% build_pdf.py "%DIR%" --dpi %~2
goto :done
:noodpi
%PY% build_pdf.py "%DIR%"
goto :done

:list
%PY% books.py
echo.
echo Usage: make-pdf.bat ^<book-id^> [dpi]
goto :done

:nodir
echo [x] Directory not found: %DIR%
echo.
%PY% books.py
goto :done

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
echo     Run start.bat first - it can install one via winget.

:done
echo.
echo Press any key to close this window...
pause >nul
exit /b 0
