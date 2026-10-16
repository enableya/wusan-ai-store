param(
    [switch]$Install,
    [int]$Port = 5180
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
$nodeVersion = if ($nodePath) { [Version]((& $nodePath --version).TrimStart('v')) } else { [Version]'0.0.0' }

if ($nodeVersion -lt [Version]'24.0.0') {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $bundledNode)) {
        throw 'Node.js 24 or later is required. Install a supported Node.js release first.'
    }
    $nodePath = $bundledNode
}

$env:Path = (Split-Path -Parent $nodePath) + ';' + $env:Path
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$npmCli = Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) {
    throw 'npm CLI was not found. Install npm with your Node.js distribution.'
}

Push-Location -LiteralPath $projectRoot
try {
    if ($Install) {
        & $nodePath $npmCli install --cache .npm-cache --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) {
        throw 'Dependencies are missing. Run this script with -Install first.'
    }
    & $nodePath $npmCli run dev -- --port $Port
} finally {
    Pop-Location
}
