@echo off
REM ============================================================
REM  Ultimate Racing Game - Local Server Launcher (Windows)
REM  Tries Python first, falls back to Node.js (npx serve)
REM ============================================================
setlocal

set PORT=8000
set URL=http://localhost:%PORT%

echo.
echo  ===============================================
echo   ULTIMATE RACING - Starting local web server
echo  ===============================================
echo.
echo   URL: %URL%
echo.
echo   Close this window to stop the server.
echo.

REM --- Try Python 3 ---
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo  Using Python to serve files...
    start "" "%URL%"
    python -m http.server %PORT%
    goto :eof
)

REM --- Try py launcher ---
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo  Using py launcher to serve files...
    start "" "%URL%"
    py -m http.server %PORT%
    goto :eof
)

REM --- Try Node.js / npx ---
where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo  Using npx serve to serve files...
    start "" "%URL%"
    npx --yes serve -l %PORT% .
    goto :eof
)

echo.
echo  ERROR: Neither Python nor Node.js found on this system.
echo.
echo  Please install one of the following:
echo    - Python 3: https://www.python.org/downloads/
echo    - Node.js:  https://nodejs.org/
echo.
pause
