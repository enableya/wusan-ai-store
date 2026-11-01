param(
    [Parameter(Mandatory = $true)][ValidatePattern('^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$')][string]$AuthorizedKey,
    [Parameter(Mandatory = $true)][ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')][string]$DeployAddress
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run in elevated PowerShell.' }
$capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
if ($capability.State -ne 'Installed') { Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null }
if (-not (Test-Path "$env:WINDIR\System32\OpenSSH\sshd.exe")) { throw 'OpenSSH server executable is missing.' }
$directory = Join-Path $env:ProgramData 'ssh'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$authorizedKeys = Join-Path $directory 'administrators_authorized_keys'
function Set-AdministratorKeyAcl([string]$Path) {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl.SetOwner($admins)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($admins, 'FullControl', 'Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($system, 'FullControl', 'Allow'))
    Set-Acl -Path $Path -AclObject $acl
}
if (Test-Path $authorizedKeys) {
    if ((Get-Item $authorizedKeys).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected key-file reparse point.' }
    $lines = @(Get-Content $authorizedKeys)
} else { $lines = @() }
if ($lines -notcontains $AuthorizedKey) {
    # Atomic rewrite with ASCII; preserve other administrators' keys and never replace them.
    $temporary = Join-Path $directory ([Guid]::NewGuid().ToString() + '.tmp')
    try {
        [IO.File]::WriteAllLines($temporary, @($lines) + @($AuthorizedKey), [Text.Encoding]::ASCII)
        Set-AdministratorKeyAcl $temporary
        Move-Item -Force -Path $temporary -Destination $authorizedKeys
    } finally { if (Test-Path $temporary) { Remove-Item $temporary -Force } }
}
Set-AdministratorKeyAcl $authorizedKeys
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
if (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Direction Inbound -Action Allow
    Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $DeployAddress
} else {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'Wusan deployment SSH' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -RemoteAddress $DeployAddress | Out-Null
}
$keygen = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
& $keygen -lf (Join-Path $directory 'ssh_host_ed25519_key.pub')
if ($LASTEXITCODE -ne 0) { throw 'Could not read SSH host-key fingerprint.' }
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, OSArchitecture, TotalVisibleMemorySize
Write-Host 'Also allow TCP/22 from the deployment IP in the Tencent Cloud instance firewall.'
