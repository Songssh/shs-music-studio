param([Parameter(Mandatory=$true)][string]$NodeExe, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$NodeExe = (Resolve-Path -LiteralPath $NodeExe).Path
$Destination = [IO.Path]::GetFullPath($Destination)
$npmCli = Join-Path (Split-Path -Parent $NodeExe) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npmCli)) { throw 'Build cache must contain the full official Node distribution, including npm.' }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'server/package.json'),(Join-Path $project 'server/package-lock.json') -Destination $Destination -Force
$previousPath = $env:PATH
$previousCache = $env:npm_config_cache
$previousPython = $env:PYTHON
try {
    $env:PATH = (Split-Path -Parent $NodeExe) + ';' + $previousPath
    $env:npm_config_cache = Join-Path $PSScriptRoot '.npm-cache'
    Push-Location $Destination
    try {
        & $NodeExe $npmCli ci --omit=dev --include=optional --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Locked production dependency installation failed' }
        & $NodeExe --input-type=module -e "import Database from 'better-sqlite3'; import sharp from 'sharp'; import {betterAuth} from 'better-auth'; const db=new Database(':memory:'); db.exec('CREATE TABLE probe(id)'); db.close(); await sharp({create:{width:2,height:2,channels:3,background:'red'}}).webp().toBuffer(); console.log('Native dependencies OK', process.version, process.versions.modules, sharp.versions.vips, typeof betterAuth);"
        if ($LASTEXITCODE -ne 0) { throw 'Production runtime dependency verification failed' }
    } finally { Pop-Location }
    $ffmpeg = Join-Path $Destination 'node_modules/ffmpeg-static/ffmpeg.exe'
    if (!(Test-Path -LiteralPath $ffmpeg)) { throw 'ffmpeg-static installation did not provide ffmpeg.exe' }
    Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $Destination 'ffmpeg.exe') -Force
} finally { $env:PATH=$previousPath; $env:npm_config_cache=$previousCache; $env:PYTHON=$previousPython }
