$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../auth-environment/runtime'))
$stateFile = Join-Path $runtime 'workspace-process.json'
if (!(Test-Path -LiteralPath $stateFile)) { Write-Host 'No Workspace launcher process is recorded.'; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if (!$process -or $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$state.started).ToUniversalTime().Ticks) { Write-Host 'Workspace is already stopped.'; exit 0 }
$expected = Join-Path $PSScriptRoot 'tools/workspace/server.mjs'
$info = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
if ($state.entry -ne $expected -or !$info.CommandLine.Contains($expected)) { throw 'PID no longer belongs to this Workspace launcher; no process was stopped.' }
Set-Content -LiteralPath (Join-Path $runtime 'workspace-stop.request') -Value 'stop' -Encoding ASCII
if (!$process.WaitForExit(15000)) { throw 'Graceful shutdown timed out. Inspect the development logs; no unrelated process was killed.' }
Write-Host 'Workspace server and its engine stopped. Data and saved drafts are retained.'
