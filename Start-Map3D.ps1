param([int]$Port = 8780, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'public'
if (-not (Test-Path (Join-Path $root 'vendor\maplibre-gl\maplibre-gl.js'))) {
    Push-Location $PSScriptRoot; npm install; npm run vendor; Pop-Location
}
$url = "http://127.0.0.1:$Port"
$up = $false
try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { }
if (-not $up) {
    Start-Process python -ArgumentList '-m','http.server',"$Port",'--bind','127.0.0.1','--directory',('"' + $root + '"') -WindowStyle Hidden
    Start-Sleep -Seconds 1
}
if (-not $NoBrowser) { Start-Process $url }
Write-Output "IgnisShield Map 3D ready: $url"
