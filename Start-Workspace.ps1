param([switch]$NoBuild, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$runtime = [IO.Path]::GetFullPath((Join-Path $repo '../auth-environment/runtime'))
$entry = Join-Path $repo 'tools/workspace/server.mjs'
$stateFile = Join-Path $runtime 'workspace-process.json'
if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.StartTime.ToUniversalTime().Ticks -eq ([datetime]$state.started).ToUniversalTime().Ticks) {
        Write-Host 'Workspace is already running: http://127.0.0.1:4301'
        if (!$NoBrowser) { Start-Process 'http://127.0.0.1:4301' }
        exit 0
    }
}
if (!(Test-Path (Join-Path $repo 'server/node_modules/tsx')) -or !(Test-Path (Join-Path $repo 'ui/node_modules/dockview'))) {
    throw 'Install dependencies first: run npm ci in server and ui.'
}
if (!$NoBuild) {
    Push-Location (Join-Path $repo 'ui')
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'UI build failed.' } } finally { Pop-Location }
}
if (!(Test-Path (Join-Path $repo 'ui/dist/index.html'))) { throw 'Build the UI before using -NoBuild.' }
$nodeExe = (Get-Command node.exe).Source
$loader = './server/node_modules/tsx/dist/loader.mjs'
$process = Start-Process -FilePath $nodeExe -ArgumentList @('--import', ('"'+$loader+'"'), ('"'+$entry+'"')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'workspace-server.log') -RedirectStandardError (Join-Path $runtime 'workspace-server.err.log')
@{pid=$process.Id; started=$process.StartTime.ToUniversalTime().ToString('o'); entry=$entry} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
for ($attempt=0; $attempt -lt 40; $attempt++) {
    if ($process.HasExited) { throw "Workspace exited. See $runtime\workspace-server.err.log" }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4301/' -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host 'Workspace ready: http://127.0.0.1:4301 (Windows defaults to Workspace; Android keeps the classic UI)'
            if (!$NoBrowser) { Start-Process 'http://127.0.0.1:4301' }
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw "Startup timed out. Check $runtime\workspace-server.log"
