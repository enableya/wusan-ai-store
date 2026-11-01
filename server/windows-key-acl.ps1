param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
try {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 1 }
    $acl = Get-Acl -LiteralPath $Path
    $sidType = [Security.Principal.SecurityIdentifier]
    $owner = $acl.GetOwner($sidType).Value
    if ($owner -notin @('S-1-5-18', 'S-1-5-32-544')) { exit 1 }
    $serviceRead = $false
    foreach ($rule in $acl.GetAccessRules($true, $true, $sidType)) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
        $sid = $rule.IdentityReference.Value
        if ($sid -notin @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-19')) { exit 1 }
        if ($sid -eq 'S-1-5-19') {
            # Write/create/append/delete/change-DACL/take-ownership bits. Read is permitted.
            if (([int64]$rule.FileSystemRights -band 852310) -ne 0) { exit 1 }
            if (([int64]$rule.FileSystemRights -band 1) -ne 0) { $serviceRead = $true }
        }
    }
    if (-not $serviceRead) { exit 1 }
    [Console]::Out.WriteLine('SECURE')
} catch { exit 1 }
