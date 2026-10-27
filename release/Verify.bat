@echo off
setlocal
"%~dp0runtime\node.exe" "%~dp0verify-portable.mjs" %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
