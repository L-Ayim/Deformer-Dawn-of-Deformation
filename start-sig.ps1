# Bake terrain tiles and start services

$staticPort = 8080
$wsPort     = 3000
$tilePort   = 8081
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notmatch '^169\.|127\.'
}).IPAddress

if (-not (Test-Path 'tiles')) {
    New-Item -ItemType Directory -Path 'tiles' | Out-Null
}
$tileFiles = Get-ChildItem 'tiles' -Filter '*.obj' -ErrorAction SilentlyContinue
if ($tileFiles.Count -eq 0) {
    Write-Host 'Baking terrain tiles...'
    python bake_tiles.py --min -1 -1 --max 1 1 --out tiles
}

Start-Process powershell -ArgumentList 'node', 'server.js' -NoNewWindow
Start-Process powershell -ArgumentList 'npx live-server --port=8080 --host=0.0.0.0 --no-browser' -NoNewWindow
Start-Process powershell -ArgumentList 'node', 'tile_server.js' -NoNewWindow

Write-Host "Site running at   : http://${ip}:${staticPort}"
Write-Host "WebSocket server  : ws://${ip}:${wsPort}"
Write-Host "Tile server      : http://${ip}:${tilePort}/"
