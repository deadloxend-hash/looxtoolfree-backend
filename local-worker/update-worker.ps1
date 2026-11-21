# Run this script from the existing LOOX worker folder after stopping its console.
# Updates only loox-worker.py. Credentials, models and environment files stay untouched.
$ErrorActionPreference = 'Stop'
$workerFile = Join-Path $PSScriptRoot 'loox-worker.py'
if (!(Test-Path -LiteralPath $workerFile)) { throw 'Place this script in your existing LOOX worker folder.' }
$runningWorker = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w)?(\.exe)?$' -and $_.CommandLine -match 'loox-worker\.py' }
if ($runningWorker) { throw 'Stop the existing LOOX worker console, then run this updater again.' }
$pythonCommand = Get-Command python -ErrorAction Stop
$downloadFile = Join-Path $PSScriptRoot ('loox-worker-update-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
 Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/deadloxend-hash/looxtoolfree-backend/00ac8ad4ce3de705b2b51b6f0d5b127d987b50a8/local-worker/loox-worker.py' -OutFile $downloadFile
 if ((Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne '586850a740cd5085b471fc2fdd97568944e22fed4f597055c187a8010b8d3424') { throw 'Downloaded file did not match the approved worker version.' }
 & $pythonCommand.Source -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())" $downloadFile
 if ($LASTEXITCODE -ne 0) { throw 'Python syntax check failed. Existing worker was preserved.' }
 $backupFile = $workerFile + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
 Copy-Item -LiteralPath $workerFile -Destination $backupFile -ErrorAction Stop
 Move-Item -LiteralPath $downloadFile -Destination $workerFile -Force -ErrorAction Stop
 Write-Host 'Worker source updated and previous source backed up. Start your usual worker launcher when ready.'
} finally {
 if (Test-Path -LiteralPath $downloadFile) { Remove-Item -LiteralPath $downloadFile }
}
