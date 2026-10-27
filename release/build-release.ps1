# release/build-release.ps1 — Build a complete portable release of HOT-Step CPP
#
# Usage:
#   .\release\build-release.ps1 [-Version "1.5.0"] [-SkipEngine] [-SkipUI] [-Variant cuda] [-BuildBackend all]
#
# Produces:
#   release/out/SHS-Music-Studio-v{version}-win-x64-{variant}.zip
#
# Requirements:
#   - Node.js 24 LTS (for building with correct native module ABI)
#   - Visual Studio 2022 Build Tools with C++ workload
#   - CUDA Toolkit 12.x (for CUDA variant)
#   - Vulkan SDK (for Vulkan variant)

param(
    [string]$Version = "0.0.0",
    [switch]$SkipEngine,
    [switch]$SkipUI,
    [string]$EngineSource = "",
    [ValidateSet("cuda", "vulkan", "cpu")]
    [string]$Variant = "cuda",       # Packaged backend
    [ValidateSet("all", "cuda", "vulkan", "cpu")]
    [string]$BuildBackend = "all",   # Backends to compile
    [string]$NodeVersion = "24.18.0" # Node.js LTS version to bundle
)

$ErrorActionPreference = "Stop"
# Reject mismatches before downloads, staging cleanup or builds, including SkipEngine.
if ($BuildBackend -ne "all" -and $BuildBackend -ne $Variant) {
    throw "BuildBackend '$BuildBackend' must match Variant '$Variant', or use BuildBackend 'all'."
}
$buildCuda = if ($BuildBackend -in @("all", "cuda")) { "ON" } else { "OFF" }
$buildVulkan = if ($BuildBackend -in @("all", "vulkan")) { "ON" } else { "OFF" }
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $ProjectRoot "release"
$StagingDir = Join-Path $ReleaseDir "staging"
$OutputDir = Join-Path $ReleaseDir "out"

# Portable Node.js download cache
$NodeCacheDir = Join-Path $ReleaseDir ".node-cache"
$NodeZipName = "node-v${NodeVersion}-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v${NodeVersion}/${NodeZipName}"
$NodeExe = Join-Path (Join-Path $NodeCacheDir "node-v${NodeVersion}-win-x64") "node.exe"

Write-Host "`n════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SHS Music Studio Release Builder" -ForegroundColor Cyan
Write-Host "  Version: $Version | Variant: $Variant" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# ── Phase 0: Clean staging ────────────────────────────────────────────

Write-Host "[Phase 0] Cleaning staging directory..." -ForegroundColor Yellow
if ([IO.Path]::GetFullPath($StagingDir) -ne [IO.Path]::GetFullPath((Join-Path $ReleaseDir "staging"))) { throw "Unsafe staging path" }
if (Test-Path -LiteralPath $StagingDir) { Remove-Item -LiteralPath $StagingDir -Recurse -Force }
New-Item -ItemType Directory -Force $StagingDir | Out-Null
New-Item -ItemType Directory -Force $OutputDir | Out-Null

# ── Phase 1: Download portable Node.js ────────────────────────────────

Write-Host "`n[Phase 1] Portable Node.js $NodeVersion..." -ForegroundColor Yellow

if (-not (Test-Path $NodeExe)) {
    Write-Host "  Downloading from nodejs.org..."
    New-Item -ItemType Directory -Force $NodeCacheDir | Out-Null
    $zipPath = Join-Path $NodeCacheDir $NodeZipName

    if (-not (Test-Path $zipPath)) {
        Invoke-WebRequest -Uri $NodeUrl -OutFile $zipPath -UseBasicParsing
    }

    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v${NodeVersion}/SHASUMS256.txt" -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $expected = ($sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $NodeZipName") }) -replace '\s+.*$', ''
    if (!$expected -or (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expected) { throw 'Node archive SHA256 mismatch' }
    Write-Host "  Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $NodeCacheDir -Force
    Remove-Item $zipPath -ErrorAction SilentlyContinue

    if (-not (Test-Path $NodeExe)) {
        throw "Node.js extraction failed - $NodeExe not found"
    }
}

$nodeVer = & $NodeExe --version
Write-Host "  Using: $NodeExe ($nodeVer)" -ForegroundColor Green

# ── Phase 2: Build C++ Engine ─────────────────────────────────────────

if (-not $SkipEngine) {
    Write-Host "`n[Phase 2] Building C++ engine ($Variant)..." -ForegroundColor Yellow

    $engineDir = Join-Path $ProjectRoot "engine"

    # Use buildall.cmd for multi-arch release builds
    $buildScript = Join-Path $engineDir "buildall.cmd"

    Write-Host "  Running buildall.cmd ($BuildBackend) with static runtime..."

    # Smart CMake cache handling: only clear if build flags have changed.
    # Deleting CMakeCache.txt forces a full reconfigure -> full rebuild of ALL
    # targets including 100+ CUDA vendor kernels (~1 hour). If the cache already
    # has the correct release flags, we skip deletion for a fast incremental build.
    $buildDir = Join-Path $engineDir "build"
    $cacheFile = Join-Path $buildDir "CMakeCache.txt"
    $needsCacheClear = $false

    if (Test-Path $cacheFile) {
        $cacheContent = Get-Content $cacheFile -Raw
        $requiredFlags = @{
            "HOT_STEP_STATIC_RUNTIME:BOOL=ON" = "Static runtime (/MT)"
            "GGML_CUDA:BOOL=$buildCuda"        = "CUDA backend"
            "GGML_VULKAN:BOOL=$buildVulkan"    = "Vulkan backend"
            "GGML_BACKEND_DL:BOOL=ON"         = "Dynamic backend loading"
            "GGML_CPU_ALL_VARIANTS:BOOL=ON"   = "CPU all variants"
        }
        foreach ($flag in $requiredFlags.Keys) {
            if ($cacheContent -notmatch ("(?m)^" + [regex]::Escape($flag) + "\r?$")) {
                Write-Host "  Cache mismatch: $($requiredFlags[$flag]) ($flag)" -ForegroundColor Yellow
                $needsCacheClear = $true
            }
        }
        if ($needsCacheClear) {
            Write-Host "  Clearing CMake cache (flags changed since last build)..." -ForegroundColor Yellow
            Remove-Item $cacheFile -Force
        } else {
            Write-Host "  CMake cache valid -- incremental build (CUDA vendor files will NOT rebuild)" -ForegroundColor Green
        }
    } else {
        Write-Host "  No CMake cache -- full build required" -ForegroundColor Yellow
    }

    # Set cmake flags for the build
    # buildall.cmd runs cmake with its own flags, so we override via env
    $previousCmakeExtra = $env:RELEASE_CMAKE_EXTRA
    $env:RELEASE_CMAKE_EXTRA = "-DHOT_STEP_STATIC_RUNTIME=ON"

    Push-Location $engineDir
    try {
        # Use the absolute path even when current-directory executable lookup is disabled.
        & $buildScript $BuildBackend
        if ($LASTEXITCODE -ne 0) { throw "Engine build failed (exit code $LASTEXITCODE)" }
    } finally {
        $env:RELEASE_CMAKE_EXTRA = $previousCmakeExtra
        Pop-Location
    }

    # Verify output
    $aceServerExe = Join-Path (Join-Path $buildDir "Release") "ace-server.exe"
    if (-not (Test-Path $aceServerExe)) {
        throw "Build succeeded but ace-server.exe not found at $aceServerExe"
    }
    Write-Host "  Engine build complete" -ForegroundColor Green
} else {
    Write-Host "`n[Phase 2] SKIPPED (engine build)" -ForegroundColor DarkGray
}

# ── Phase 3: Bundle Server ────────────────────────────────────────────

Write-Host "`n[Phase 3] Bundling server..." -ForegroundColor Yellow

# Source bundling and dependency installation use the same portable runtime.
$npmCli = Join-Path (Split-Path -Parent $NodeExe) 'node_modules/npm/bin/npm-cli.js'
$previousPath = $env:PATH
$env:PATH = (Split-Path -Parent $NodeExe) + ';' + $env:PATH
Push-Location $ReleaseDir
try {
    & $NodeExe $npmCli ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Release tooling installation failed' }
} finally { Pop-Location; $env:PATH = $previousPath }
& $NodeExe (Join-Path $ReleaseDir 'esbuild.config.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Server bundling failed' }
& (Join-Path $ReleaseDir 'stage-runtime.ps1') -NodeExe $NodeExe -Destination (Join-Path $StagingDir 'server')

# ── Phase 4: Build UI ─────────────────────────────────────────────────

if (-not $SkipUI) {
    Write-Host "`n[Phase 4] Building UI..." -ForegroundColor Yellow

    $uiPreviousPath = $env:PATH
    $env:PATH = (Split-Path -Parent $NodeExe) + ";" + $env:PATH
    Push-Location (Join-Path $ProjectRoot "ui")
    try {
        & $NodeExe $npmCli ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "UI dependency installation failed" }
        & $NodeExe $npmCli run build
        if ($LASTEXITCODE -ne 0) { throw "UI build failed" }
    } finally {
        $env:PATH = $uiPreviousPath
        Pop-Location
    }

    Write-Host "  UI build complete" -ForegroundColor Green
} else {
    Write-Host "`n[Phase 4] SKIPPED (UI build)" -ForegroundColor DarkGray
}

# ── Phase 5: Assemble Release ─────────────────────────────────────────

Write-Host "`n[Phase 5] Assembling release..." -ForegroundColor Yellow

$dist = $StagingDir

# Runtime: portable Node.js
Write-Host "  Copying runtime..."
New-Item -ItemType Directory -Force (Join-Path $dist "runtime") | Out-Null
Copy-Item $NodeExe (Join-Path $dist "runtime\node.exe")

# Engine: binaries + DLLs
Write-Host "  Copying engine binaries..."
$engineOut = Join-Path $dist "engine"
New-Item -ItemType Directory -Force $engineOut | Out-Null
$buildRelease = if ($EngineSource) { (Resolve-Path -LiteralPath $EngineSource).Path } else { Join-Path (Join-Path $ProjectRoot "engine") "build\Release" }

$engineFiles = @(
    "ace-server.exe", "ace-train.exe", "ace-midi.exe", "ace-caption.exe", "mastering.exe", "mp3-codec.exe",
    "neural-codec.exe", "vst-host.exe", "quantize.exe",
    "ggml.dll", "ggml-base.dll"
)

# Add variant-specific DLLs
switch ($Variant) {
    "cuda"   { $engineFiles += "ggml-cuda.dll" }
    "vulkan" { $engineFiles += "ggml-vulkan.dll" }
    # cpu: no GPU backend DLL needed
}

foreach ($file in $engineFiles) {
    $src = Join-Path $buildRelease $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $engineOut $file)
    } else {
        throw "Missing required engine file: $file"
    }
}

# Also copy any ggml-cpu-* variant DLLs (from GGML_CPU_ALL_VARIANTS)
Get-ChildItem (Join-Path $buildRelease "ggml-cpu-*.dll") -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $engineOut $_.Name)
}

# Lua plugins — dual directory system:
#   engine/plugins/  = native/built-in plugins (solvers, schedulers, guidance)
#   plugins/         = community/user plugins (same structure, overrides native)
# ace-server scans both via engine_dir and project_dir resolution from binary path
Write-Host "  Copying Lua plugins..."
$enginePluginsSrc = Join-Path (Join-Path $ProjectRoot "engine") "plugins"
if (Test-Path $enginePluginsSrc) {
    $enginePluginsDst = Join-Path $engineOut "plugins"
    Copy-Item -Recurse $enginePluginsSrc $enginePluginsDst
    $pluginCount = (Get-ChildItem -Recurse $enginePluginsDst -Filter "*.lua" | Measure-Object).Count
    Write-Host "    $pluginCount native plugins (engine/plugins/)" -ForegroundColor Green
} else {
    Write-Warning "  engine/plugins/ not found -- engine will have no built-in plugins!"
}
$communityPluginsSrc = Join-Path $ProjectRoot "plugins"
if (Test-Path $communityPluginsSrc) {
    Copy-Item -Recurse $communityPluginsSrc (Join-Path $dist "plugins")
    Write-Host "    Community plugins dir copied (plugins/)" -ForegroundColor Green
}

# Include app-local native runtimes for the engine, Node addons and Essentia.
# EngineSource must be a complete official engine binary distribution.
$runtimeNames = @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')
foreach ($dll in $runtimeNames) {
    $src = Join-Path $buildRelease $dll
    if (!(Test-Path -LiteralPath $src)) {
        $found = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio','C:\Program Files (x86)\Microsoft Visual Studio' -Recurse -Filter $dll -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match 'Redist.*x64' -and $_.FullName -notmatch 'debug' } | Select-Object -First 1
        if (!$found) { throw "Missing redistributable DLL: $dll. Supply a complete -EngineSource." }
        $src = $found.FullName
    }
    Copy-Item -LiteralPath $src -Destination $engineOut -Force
    Copy-Item -LiteralPath $src -Destination (Join-Path $dist 'runtime') -Force
}
Get-ChildItem -LiteralPath $buildRelease -Filter '*.dll' | Where-Object { $_.Name -match '^(vcomp|msvcp|vcruntime)' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $engineOut -Force
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dist 'runtime') -Force
}
if (!(Get-ChildItem -LiteralPath $engineOut -Filter 'ggml-cpu*.dll')) { throw 'No CPU backend packaged' }
if ($Variant -eq 'cuda') {
    foreach ($pattern in @('cudart64_*.dll','cublas64_*.dll','cublasLt64_*.dll')) {
        $files = @(Get-ChildItem -LiteralPath $buildRelease -Filter $pattern)
        if (!$files.Count) { throw "Missing offline CUDA runtime: $pattern" }
        $files | Copy-Item -Destination $engineOut -Force
    }
    Copy-Item -LiteralPath (Join-Path $buildRelease '.cuda-version') -Destination $engineOut
}
Set-Content -LiteralPath (Join-Path $engineOut '.variant') -Value $Variant -NoNewline -Encoding ASCII
# Production packages and ffmpeg were already installed in isolation.
$serverOut = Join-Path $dist 'server'

# Copy data files (model-registry.json, assistant-knowledge.md)
$dataOut = Join-Path $serverOut "data"
New-Item -ItemType Directory -Force $dataOut | Out-Null
Copy-Item (Join-Path $ProjectRoot "server/src/data/*") $dataOut -Recurse -Force

# UI: pre-built dist
Write-Host "  Copying UI..."
$uiSrc = Join-Path (Join-Path $ProjectRoot "ui") "dist"
$uiDst = Join-Path (Join-Path $dist "ui") "dist"
if (Test-Path $uiSrc) {
    New-Item -ItemType Directory -Force (Join-Path $dist "ui") | Out-Null
    Copy-Item -Recurse $uiSrc $uiDst
} else {
    throw "UI dist not found"
}

# Essentia
$essentiaSrc = Join-Path $ProjectRoot "Essentia"
if (Test-Path $essentiaSrc) {
    Write-Host "  Copying Essentia..."
    Copy-Item -Recurse $essentiaSrc (Join-Path $dist "Essentia")
    Get-ChildItem -LiteralPath (Join-Path $dist 'runtime') -Filter '*.dll' | Copy-Item -Destination (Join-Path $dist 'Essentia')
}

# Noise samples
$noiseSrc = Join-Path $ProjectRoot "noise_samples"
if (Test-Path $noiseSrc) {
    Copy-Item -Recurse $noiseSrc (Join-Path $dist "noise_samples")
}

# Mutable data folders are initialized beside the app at first boot.

# Config and docs
Copy-Item (Join-Path $ReleaseDir ".env.example") (Join-Path $dist ".env.example")
Copy-Item (Join-Path $ReleaseDir "profile-path.mjs") (Join-Path $dist "profile-path.mjs")
Copy-Item (Join-Path $ReleaseDir "HOT-Step.bat") (Join-Path $dist "HOT-Step.bat")
Copy-Item (Join-Path $ReleaseDir "README.txt") (Join-Path $dist "README.txt")
Copy-Item (Join-Path $ProjectRoot "open-browser-if-needed.mjs") (Join-Path $dist "open-browser-if-needed.mjs")

foreach ($file in @('portable.mjs','Setup.bat','create-certificate.ps1','verify-portable.mjs','Verify.bat','SHS-Music-Studio.bat')) {
    Copy-Item -LiteralPath (Join-Path $ReleaseDir $file) -Destination $dist
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE') -Destination $dist
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'THIRD_PARTY.md') -Destination $dist
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'engine/LICENSE') -Destination (Join-Path $engineOut 'LICENSE')
Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $NodeExe) 'LICENSE') -Destination (Join-Path $dist 'runtime/Node-LICENSE.txt')
Set-Content -LiteralPath (Join-Path $dist 'VERSION') -Value $Version -NoNewline -Encoding ASCII
& $NodeExe (Join-Path $ReleaseDir 'release-manifest.mjs') $dist $Version $Variant $buildRelease
if ($LASTEXITCODE -ne 0) { throw 'Manifest generation failed' }
Write-Host 'Verifying the assembled portable server...'
& (Join-Path $dist 'runtime/node.exe') (Join-Path $dist 'verify-portable.mjs') --report (Join-Path $OutputDir "verification-$Version-$Variant.json")
if ($LASTEXITCODE -ne 0) { throw 'Portable verification failed; archive will not be created' }
Write-Host "  Assembly complete" -ForegroundColor Green

# ── Phase 6: Package ──────────────────────────────────────────────────

Write-Host "`n[Phase 6] Packaging..." -ForegroundColor Yellow

$zipName = "SHS-Music-Studio-v${Version}-win-x64-${Variant}.zip"
$zipPath = Join-Path $OutputDir $zipName

if (Test-Path $zipPath) { Remove-Item $zipPath }

# Compress — use .NET for better compression than Compress-Archive
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($dist, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$zipSize = (Get-Item $zipPath).Length
$zipSizeMB = [math]::Round($zipSize / 1MB, 1)

# Generate SHA256
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
$hashFile = Join-Path $OutputDir "${zipName}.sha256"
"$hash  $zipName" | Set-Content $hashFile -NoNewline

Write-Host "  $zipName ($zipSizeMB MB)" -ForegroundColor Green
Write-Host "  SHA256: $hash" -ForegroundColor DarkGray

Write-Host "`n════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Release build complete!" -ForegroundColor Green
Write-Host "  Output: $zipPath" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
