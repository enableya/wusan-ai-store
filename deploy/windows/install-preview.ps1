param([Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$PackageSha256)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'C:\WusanMigration'
$root = 'C:\WusanAI'
$state = 'C:\ProgramData\WusanAI'
function Native-Checked([scriptblock]$Action) { & $Action; if ($LASTEXITCODE -ne 0) { throw 'Native command failed.' } }
function Check-SumFile([string]$Name, [string]$List, [string]$Algorithm) {
    $line = @(Get-Content (Join-Path $stage $List) | Where-Object { ($_ -split '\s+')[-1].TrimStart('*') -eq $Name })
    if ($line.Count -ne 1) { throw 'Checksum entry missing or ambiguous.' }
    $expected = ($line[0] -split '\s+')[0]
    if ((Get-FileHash (Join-Path $stage $Name) -Algorithm $Algorithm).Hash.ToLower() -ne $expected.ToLower()) { throw 'Binary checksum mismatch.' }
}
Check-SumFile 'node-v24.22.0-win-x64.zip' 'node-SHASUMS256.txt' 'SHA256'
Check-SumFile 'caddy_2.11.7_windows_amd64.zip' 'caddy_2.11.7_checksums.txt' 'SHA512'
if ((Get-FileHash "$stage\WinSW-x64.exe" -Algorithm SHA256).Hash.ToLower() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da') { throw 'Service wrapper transfer checksum mismatch.' }
if ((Get-FileHash "$stage\release.tgz" -Algorithm SHA256).Hash.ToLower() -ne $PackageSha256) { throw 'Release archive checksum mismatch.' }
if (Test-Path "$root\current") { throw 'Current release exists; use a controlled update instead of initial install.' }
foreach ($path in @($root, $state)) {
    New-Item -ItemType Directory -Force $path | Out-Null
    Native-Checked { icacls.exe $path /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null }
}
foreach ($path in @('data','logs','logs\api','logs\web','caddy')) {
    $directory = Join-Path $state $path
    New-Item -ItemType Directory -Force $directory | Out-Null
    Native-Checked { icacls.exe $directory /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null }
}
New-Item -ItemType Directory -Force "$state\keys", "$root\bin", "$root\services", "$root\releases", "$stage\extract", "$stage\node", "$stage\caddy" | Out-Null
Expand-Archive "$stage\node-v24.22.0-win-x64.zip" "$stage\node" -Force
Copy-Item "$stage\node\node-v24.22.0-win-x64\*" "$root\bin" -Recurse -Force
Expand-Archive "$stage\caddy_2.11.7_windows_amd64.zip" "$stage\caddy" -Force
Copy-Item "$stage\caddy\caddy.exe" "$root\bin\caddy.exe"
Native-Checked { tar.exe -xzf "$stage\release.tgz" -C "$stage\extract" }
$release = "$root\releases\20261031-tencent"
if (Test-Path $release) { throw 'Release destination already exists.' }
Move-Item "$stage\extract\wusan-ai-store" $release
Native-Checked { icacls.exe $release /reset /T /C | Out-Null }
$manifest = Get-Content "$release\release.json" -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $path = [IO.Path]::GetFullPath((Join-Path $release $entry.path))
    if (-not $path.StartsWith($release + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes release.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256) { throw 'Release file checksum mismatch.' }
}
Push-Location $release
try {
    $env:PATH = "$root\bin;" + $env:PATH
    $env:NODE_ENV = 'production'
    Native-Checked { & "$root\bin\node.exe" "$root\bin\node_modules\npm\bin\npm-cli.js" ci --omit=dev --ignore-scripts --no-audit --no-fund }
} finally { Pop-Location }
foreach ($name in @('app-private.keytext','alipay-public.keytext')) {
    if (Test-Path "$state\keys\$name") { throw 'Existing key would be overwritten.' }
    Move-Item "$stage\$name" "$state\keys\$name"
}
if (Test-Path "$state\data\store.sqlite") { throw 'Existing database would be overwritten.' }
Move-Item "$stage\store.sqlite" "$state\data\store.sqlite"
if (Test-Path "$state\production.env") { throw 'Existing environment would be overwritten.' }
Move-Item "$stage\production.env" "$state\production.env"
Native-Checked { icacls.exe "$state\production.env" /reset | Out-Null }
Copy-Item "$release\deploy\windows\Caddyfile.preview" "$state\Caddyfile"
New-Item -ItemType Junction -Path "$root\current" -Target $release | Out-Null
# Files moved from the administrator-only upload directory need explicit inherited service read access.
Native-Checked { icacls.exe "$state\keys" /reset /T /C | Out-Null }
Native-Checked { icacls.exe "$state\keys" /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null }
Native-Checked { icacls.exe "$state\data" /grant:r '*S-1-5-19:(OI)(CI)M' /T /C | Out-Null }
Native-Checked { icacls.exe "$state\keys" /setowner '*S-1-5-32-544' /T /C | Out-Null }
Native-Checked { & "$root\bin\caddy.exe" validate --config "$state\Caddyfile" --adapter caddyfile }
foreach ($service in @('wusan-api','wusan-web')) {
    Copy-Item "$stage\WinSW-x64.exe" "$root\services\$service.exe"
    Copy-Item "$release\deploy\windows\$service.xml" "$root\services\$service.xml"
    Native-Checked { & "$root\services\$service.exe" install }
}
Start-Service WusanApi
Start-Service WusanWeb
foreach ($attempt in 1..30) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:5182/api/health' -TimeoutSec 2
        if ($health.data.status -eq 'ok') { break }
    } catch { Start-Sleep -Seconds 2 }
}
if ($health.data.status -ne 'ok') { throw 'API health verification failed.' }
$page = Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing
if ($page.StatusCode -ne 200) { throw 'Frontend preview verification failed.' }
Get-Service WusanApi,WusanWeb | Select-Object Name,Status,StartType
Write-Host 'Preview installed. DNS unchanged; production payment switch remains false.'
