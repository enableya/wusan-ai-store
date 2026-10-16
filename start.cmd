@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED_NODE%" (
    set "NODE_EXE=%BUNDLED_NODE%"
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
) else (
    set "NODE_EXE=node"
)

"%NODE_EXE%" -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or later is required.');process.exit(1);}"
if errorlevel 1 goto failed

for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%I"
if not defined NPM_CMD (
    echo npm was not found. Install Node.js with npm first.
    goto failed
)
for %%I in ("%NPM_CMD%") do set "NPM_CLI=%%~dpInode_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CLI%" (
    echo npm CLI was not found beside npm.cmd.
    goto failed
)

echo Installing project dependencies. Keep this window open.
"%NODE_EXE%" "%NPM_CLI%" install --cache .npm-cache --no-audit --no-fund
if errorlevel 1 goto failed

echo Starting Wusan AI on http://127.0.0.1:5180
echo Open the address only after Vite prints its Local URL.
"%NODE_EXE%" "%NPM_CLI%" run dev
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Startup failed. Send the error above for troubleshooting.
pause
exit /b 1
