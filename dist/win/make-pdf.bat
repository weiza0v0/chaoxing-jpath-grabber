@echo off
rem ===================================================================
rem  Rebuild the PDF by hand (the collector normally does it automatically).
rem
rem    make-pdf.bat                 list collected books
rem    make-pdf.bat <book-id>       rebuild that book
rem    make-pdf.bat <book-id> 281   rebuild with a custom dpi
rem
rem  NOTE: keep this file pure ASCII and CRLF (see start.bat for why).
rem ===================================================================
setlocal
cd /d "%~dp0"
set "PY=%~dp0python\python.exe"
if not exist "%PY%" goto :nopy

if "%~1"=="" goto :list

set "TARGET=%~1"
if exist "%TARGET%\" goto :havedir
set "DIR=%~dp0output\%TARGET%"
goto :checkdir
:havedir
set "DIR=%TARGET%"
:checkdir
if not exist "%DIR%\" goto :nodir

if "%~2"=="" goto :noodpi
"%PY%" "%~dp0backend\build_pdf.py" "%DIR%" --dpi %~2
goto :done
:noodpi
"%PY%" "%~dp0backend\build_pdf.py" "%DIR%"
goto :done

:list
"%PY%" "%~dp0backend\books.py" "%~dp0output"
echo.
echo Usage: make-pdf.bat ^<book-id^> [dpi]
goto :done

:nodir
echo [x] Directory not found: %DIR%
echo.
"%PY%" "%~dp0backend\books.py" "%~dp0output"
goto :done

:nopy
echo [x] python\python.exe not found - the archive was not extracted fully.

:done
echo.
echo Press any key to close this window...
pause >nul
exit /b 0
