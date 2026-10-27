@echo off
setlocal
REM profile-path.mjs / RESTART_MARKER: portable.mjs uses the data-local profile.
:start
"%~dp0runtime\node.exe" "%~dp0portable.mjs" start %*
set "SERVER_EXIT=%ERRORLEVEL%"
"%~dp0runtime\node.exe" "%~dp0portable.mjs" consume-restart
if %ERRORLEVEL%==42 goto start
echo.
echo HOT-Step stopped (exit %SERVER_EXIT%).
pause
exit /b %SERVER_EXIT%
