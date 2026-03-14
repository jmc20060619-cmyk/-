$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$healthUrl = "http://127.0.0.1:4173/api/health"
$serverLog = Join-Path $projectRoot "server-public.log"
$tunnelLog = Join-Path $projectRoot "cloudflared-live.log"
$publicUrlFile = Join-Path $projectRoot "public-url.txt"

function Resolve-Cloudflared {
  $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallback = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
  if (Test-Path $fallback) {
    return $fallback
  }

  throw "cloudflared.exe was not found. Install Cloudflare Tunnel first."
}

function Ensure-Server {
  try {
    Invoke-RestMethod $healthUrl | Out-Null
    return
  } catch {
    Start-Process node -ArgumentList @("server.js") -WorkingDirectory $projectRoot -RedirectStandardOutput $serverLog -RedirectStandardError $serverLog | Out-Null
    Start-Sleep -Seconds 3
    Invoke-RestMethod $healthUrl | Out-Null
  }
}

function Stop-Existing-Tunnels {
  Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
    Where-Object { $_.CommandLine -like "*127.0.0.1:4173*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Get-CimInstance Win32_Process -Filter "name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -like "*start-public-tunnel.cmd*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Ensure-Server
Stop-Existing-Tunnels

$launcher = Join-Path $projectRoot "start-public-tunnel.cmd"
Start-Process cmd.exe -ArgumentList "/c `"$launcher`"" -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null

$publicUrl = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $tunnelLog) {
    $match = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Matches.Value } |
      Select-Object -Last 1

    if ($match) {
      $publicUrl = $match
      break
    }
  }
}

if (-not $publicUrl) {
  throw "Could not find a public URL in $tunnelLog."
}

$publicUrl | Set-Content -Path $publicUrlFile -Encoding UTF8
Write-Host ""
Write-Host "Public URL:"
Write-Host $publicUrl
Write-Host ""
Write-Host "Dashboard: $publicUrl/index.html"
Write-Host "Monitor:   $publicUrl/monitor.html"
Write-Host "Detail:    $publicUrl/detail.html"
Write-Host ""
Write-Host "Saved to: $publicUrlFile"
Write-Host "Tunnel log: $tunnelLog"
