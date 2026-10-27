@echo off
setlocal
"%~dp0runtime\node.exe" "%~dp0portable.mjs" setup %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
