$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

function Test-ListeningPort {
  param([int]$Port)

  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    return $null -ne $conn
  } catch {
    return $false
  }
}

function Start-DevProcess {
  param(
    [string]$Title,
    [string]$Command
  )

  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $Command -WindowStyle Minimized | Out-Null
  Write-Host "[dev-up] started $Title"
}

$serverPort = 2048
$clientPort = 5173

if (-not (Test-ListeningPort -Port $serverPort)) {
  Start-DevProcess -Title 'zashboard-server' -Command "cd /d `"$root`" && corepack pnpm run dev:server > .server.log 2>&1"
} else {
  Write-Host "[dev-up] server already listening on :$serverPort"
}

if (-not (Test-ListeningPort -Port $clientPort)) {
  Start-DevProcess -Title 'zashboard-client' -Command "cd /d `"$root`" && corepack pnpm exec vite --host 0.0.0.0 --port 5173 > .client.log 2>&1"
} else {
  Write-Host "[dev-up] client already listening on :$clientPort"
}

Start-Sleep -Seconds 2

$serverStatus = if (Test-ListeningPort -Port $serverPort) { 'up' } else { 'down' }
$clientStatus = if (Test-ListeningPort -Port $clientPort) { 'up' } else { 'down' }

Write-Host "[dev-up] status server:$serverStatus client:$clientStatus"
