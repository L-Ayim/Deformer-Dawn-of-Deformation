# Start both services in background and print LAN IP with links

$staticPort = 8080
$wsPort     = 3000
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notmatch '^169\.|127\.' })[0].IPAddress

Start-Process powershell -ArgumentList 'node', 'server.js' -NoNewWindow
Start-Process powershell -ArgumentList 'npx live-server --port=8080 --host=0.0.0.0 --no-browser' -NoNewWindow

Write-Host "Site running at   : http://${ip}:${staticPort}"
Write-Host "WebSocket server  : ws://${ip}:${wsPort}"
