param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$DnsName)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 + .NET 4.7.2. No OpenSSL or certificate-store writes.
New-Item -ItemType Directory -Force -Path $Directory | Out-Null
$rsa = New-Object System.Security.Cryptography.RSACng 2048
try {
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=HOT-Step Portable', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $ip = $null
    if ([Net.IPAddress]::TryParse($DnsName, [ref]$ip)) { $san.AddIpAddress($ip) } else { $san.AddDnsName($DnsName) }
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
    $oids = [System.Security.Cryptography.OidCollection]::new()
    $null = $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
    $cert = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(365))
    try {
        [IO.File]::WriteAllBytes((Join-Path $Directory 'server.pfx'), $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))
        $pem = "-----BEGIN CERTIFICATE-----`r`n" + [Convert]::ToBase64String($cert.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`r`n-----END CERTIFICATE-----`r`n"
        [IO.File]::WriteAllText((Join-Path $Directory 'server.crt'), $pem, [Text.Encoding]::ASCII)
    } finally { $cert.Dispose() }
} finally { $rsa.Dispose() }
