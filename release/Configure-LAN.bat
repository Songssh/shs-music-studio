@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configure-LAN.ps1" %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
