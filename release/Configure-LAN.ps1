param([string]$Address)

# Works with existing portable releases: no Node/npm install or rebuild needed.
# Run as the Windows account that ran Setup.bat, after stopping the application.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$listeners = @()
$temporaryConfig = $null
$backup = $null
$committing = $false
$savedTls = @{}

try {
    $appDirectory = $PSScriptRoot
    $configFile = Join-Path $appDirectory 'portable.json'
    if (!(Test-Path -LiteralPath $configFile -PathType Leaf)) {
        throw 'Put Configure-LAN.bat and Configure-LAN.ps1 beside portable.json in the extracted app folder. Run Setup.bat first if this is a new installation.'
    }
    $settings = [IO.File]::ReadAllText($configFile) | ConvertFrom-Json
    foreach ($field in @('dataDir', 'host', 'url', 'port', 'enginePort', 'tls')) {
        if (!$settings.PSObject.Properties[$field]) { throw "portable.json is missing $field." }
    }
    if ($settings.tls -ne 'self-signed') {
        throw 'This helper supports the default self-signed TLS mode only. For PEM certificates or a reverse proxy, update the address and matching certificate/proxy configuration manually.'
    }
    foreach ($field in @('port', 'enginePort')) {
        $value = 0
        if (![int]::TryParse([string]$settings.$field, [ref]$value) -or $value -lt 1 -or $value -gt 65535) {
            throw "Invalid $field in portable.json."
        }
    }
    if ($settings.port -eq $settings.enginePort) { throw 'Server and engine ports must be different.' }
    if ([string]::IsNullOrWhiteSpace($settings.dataDir)) { throw 'Missing data directory.' }
    $dataDirectory = if ([IO.Path]::IsPathRooted($settings.dataDir)) {
        [IO.Path]::GetFullPath($settings.dataDir)
    } else {
        [IO.Path]::GetFullPath((Join-Path $appDirectory $settings.dataDir))
    }
    $appPrefix = $appDirectory.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if ($dataDirectory -eq $appDirectory -or $dataDirectory.StartsWith($appPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The data directory must be outside the application folder.'
    }
    $tlsDirectory = Join-Path $dataDirectory 'settings\tls'
    if (!(Test-Path -LiteralPath $tlsDirectory -PathType Container)) { throw 'Existing TLS data directory not found. Check dataDir in portable.json.' }
    $certificateScript = Join-Path $appDirectory 'create-certificate.ps1'
    if (!(Test-Path -LiteralPath $certificateScript -PathType Leaf)) { throw 'create-certificate.ps1 is missing from the portable installation.' }

    if ([string]::IsNullOrWhiteSpace($Address)) {
        Write-Host 'Use the IPv4 address of THIS server PC on your router (see ipconfig).'
        $Address = Read-Host 'Server LAN IPv4 address, for example 192.168.0.6'
    }
    $Address = $Address.Trim()
    $ip = $null
    if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or ![Net.IPAddress]::TryParse($Address, [ref]$ip)) {
        throw 'Enter an IPv4 address only, without https://, a port, or a path.'
    }
    $bytes = $ip.GetAddressBytes()
    $privateAddress = $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
    if (!$privateAddress) { throw 'Use a private LAN IPv4 address in 10.x.x.x, 172.16-31.x.x, or 192.168.x.x.' }
    $Address = $ip.ToString()
    $url = 'https://{0}:{1}' -f $Address, $settings.port

    # Windows can allow overlapping wildcard/specific-address binds when the
    # other program uses SO_REUSEADDR. Check IPv4/IPv6 listeners as well.
    $occupied = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $settings.port -or $_.Port -eq $settings.enginePort }
    if ($occupied) { throw 'Stop SHS Music Studio and its engine before running this helper. A configured port is already in use; no settings were changed.' }

    # Hold both ports until the update finishes, so a running server/engine or a
    # concurrent launcher cannot read a partially updated certificate/config.
    foreach ($endpoint in @(@([Net.IPAddress]::Any, [int]$settings.port), @([Net.IPAddress]::Loopback, [int]$settings.enginePort))) {
        $listener = [Net.Sockets.TcpListener]::new($endpoint[0], $endpoint[1])
        $listeners += $listener
        $listener.ExclusiveAddressUse = $true
        try { $listener.Start() } catch {
            throw "Cannot reserve port $($endpoint[1]). Stop SHS Music Studio and its engine before running this helper. No settings were changed. $($_.Exception.Message)"
        }
    }

    # Backups containing private keys stay inside the existing protected TLS folder.
    $id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
    $backup = Join-Path $tlsDirectory "lan-backup-$id"
    [IO.Directory]::CreateDirectory($backup) | Out-Null
    Copy-Item -LiteralPath $configFile -Destination (Join-Path $backup 'portable.json')
    foreach ($name in @('server.pfx', 'server.crt')) {
        $file = Join-Path $tlsDirectory $name
        $savedTls[$name] = Test-Path -LiteralPath $file -PathType Leaf
        if ($savedTls[$name]) { Copy-Item -LiteralPath $file -Destination (Join-Path $backup $name) }
    }
    $replacement = Join-Path $backup 'replacement'
    & $certificateScript -Directory $replacement -DnsName $Address
    foreach ($name in @('server.pfx', 'server.crt')) {
        if (!(Test-Path -LiteralPath (Join-Path $replacement $name) -PathType Leaf)) { throw 'Certificate generation did not produce both TLS files.' }
    }

    $settings.url = $url
    $settings.host = '0.0.0.0'
    # Preserve dataDir, ports, TLS mode, and any other existing settings.
    $temporaryConfig = Join-Path $appDirectory "portable.json.lan-$id.tmp"
    [IO.File]::WriteAllText($temporaryConfig, ($settings | ConvertTo-Json -Depth 100) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $committing = $true
    foreach ($name in @('server.pfx', 'server.crt')) {
        Copy-Item -LiteralPath (Join-Path $replacement $name) -Destination (Join-Path $tlsDirectory $name) -Force
    }
    # Windows PowerShell 5.1 otherwise converts $null to an empty backup path.
    [IO.File]::Replace($temporaryConfig, $configFile, [NullString]::Value)
    $committing = $false

    Write-Host "LAN configured: $url" -ForegroundColor Green
    Write-Host "Backup: $backup"
    Write-Host 'Start SHS-Music-Studio.bat (or HOT-Step.bat), then use the URL above on every device, including this PC.'
    Write-Host "Trust the new public certificate on each client: $(Join-Path $tlsDirectory 'server.crt')"
    Write-Host 'Do not copy server.pfx or the backup folder to clients. Accounts, models, and library data are unchanged.'
    Write-Host ''
    Write-Host 'If connections time out, use a Private Windows network profile for your trusted home LAN.'
    Write-Host 'Then run this command in an Administrator PowerShell to allow this app from the local subnet:'
    $program = (Join-Path $appDirectory 'runtime\node.exe').Replace("'", "''")
    Write-Host ("New-NetFirewallRule -DisplayName 'SHS Music Studio LAN {0}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort {0} -Program '{1}' -Profile Private -RemoteAddress LocalSubnet" -f $settings.port, $program)
    Write-Host 'Firewall rules and certificate trust are not changed automatically. Reserve the server IP in your router to keep this URL stable.'
} catch {
    $failure = $_.Exception.Message
    if ($committing) {
        try {
            foreach ($name in @('server.pfx', 'server.crt')) {
                $file = Join-Path $tlsDirectory $name
                if ($savedTls[$name]) { Copy-Item -LiteralPath (Join-Path $backup $name) -Destination $file -Force }
                elseif (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
            }
            # File.Replace is atomic: a failed replacement leaves the old config
            # intact. Do not try to overwrite a config locked by another process.
        } catch {
            [Console]::Error.WriteLine("Automatic rollback failed. Restore portable.json and TLS files from: $backup")
        }
    }
    [Console]::Error.WriteLine("[Configure-LAN] $failure")
    if ($backup) { [Console]::Error.WriteLine("Backup: $backup") }
    exit 1
} finally {
    foreach ($listener in $listeners) { $listener.Stop() }
    if ($temporaryConfig -and (Test-Path -LiteralPath $temporaryConfig)) { Remove-Item -LiteralPath $temporaryConfig -Force }
}
