# chaoxing-jpath-grabber -- Windows PowerShell launcher
#
# Same as start.bat, for people who prefer PowerShell.
# If script execution is blocked, run:
#   powershell -ExecutionPolicy Bypass -File start.ps1
#
# ZERO third-party dependencies: Python standard library only.
# Kept pure ASCII so it does not depend on the console code page.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Find-Python {
    foreach ($c in @('python', 'python3')) {
        if (Get-Command $c -ErrorAction SilentlyContinue) {
            & $c -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) { return $c }
        }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return 'py -3' }
    }
    return $null
}

$PY = Find-Python

if (-not $PY) {
    Write-Host '[x] No usable Python 3.8+ found.' -ForegroundColor Red
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ans = Read-Host '    Install Python 3.12 via winget now? [y/N]'
        if ($ans -eq 'y') {
            winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
            Write-Host '    Finished. Close this window and run the script again (PATH needs a fresh window).'
            Read-Host 'Press Enter to close'
            exit 0
        }
    }
    Write-Host '    Please install Python manually: https://www.python.org/downloads/'
    Write-Host '    Remember to tick "Add python.exe to PATH" during setup.'
    Read-Host 'Press Enter to close'
    exit 1
}

Write-Host "[*] Python: $PY"
$check = 'import http.server,json,os,re,struct,subprocess,sys,zlib; print("[*] stdlib self-check OK - no pip install needed")'
if ($PY -eq 'py -3') { & py -3 -c $check } else { & $PY -c $check }
if ($LASTEXITCODE -ne 0) {
    Write-Host '[x] The Python stdlib self-check failed - that install looks incomplete.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$extra = @($args)
if ($PY -eq 'py -3') { & py -3 collector.py @extra } else { & $PY collector.py @extra }

Write-Host ''
Write-Host '[x] collector exited.' -ForegroundColor Yellow
Read-Host 'Press Enter to close'
