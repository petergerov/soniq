# Beendet Web-App und Modellserver.
. (Join-Path $PSScriptRoot "scripts\common.ps1")

foreach ($p in @($PORT, $SYNTH_PORT, $LM_PORT)) {
    $pids = Port-Pids $p
    if ($pids.Count) {
        Write-Host "Stopping server on port $p..."
        Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 1
Write-Host "Servers stopped."
