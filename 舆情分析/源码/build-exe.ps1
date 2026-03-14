$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath("Desktop")
$outputPath = Join-Path $desktopPath "GovInsightConsole.exe"
$buildDir = Join-Path $projectRoot ".sea-build"
$blobPath = Join-Path $buildDir "sea-prep.blob"
$configPath = Join-Path $buildDir "sea-config.json"
$sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
$nodeExe = (Get-Command node).Source

if (Test-Path $buildDir) {
  Remove-Item $buildDir -Recurse -Force
}

New-Item -ItemType Directory -Path $buildDir | Out-Null

$assets = @{
  "app.js" = (Join-Path $projectRoot "app.js")
  "detail.html" = (Join-Path $projectRoot "detail.html")
  "index.html" = (Join-Path $projectRoot "index.html")
  "monitor.html" = (Join-Path $projectRoot "monitor.html")
  "styles.css" = (Join-Path $projectRoot "styles.css")
  "warning.html" = (Join-Path $projectRoot "warning.html")
}

$config = @{
  main = (Join-Path $projectRoot "server.js")
  output = $blobPath
  disableExperimentalSEAWarning = $true
  useCodeCache = $false
  assets = $assets
}

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "生成 SEA 预处理 blob..."
& node --experimental-sea-config $configPath

Write-Host "复制 Node 可执行文件..."
Copy-Item $nodeExe $outputPath -Force

Write-Host "注入应用资源到 EXE..."
& npx --yes postject $outputPath NODE_SEA_BLOB $blobPath --sentinel-fuse $sentinelFuse

Write-Host ""
Write-Host "桌面 EXE 已生成:"
Write-Host $outputPath
