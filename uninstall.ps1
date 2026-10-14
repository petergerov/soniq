# SONIQ - Deinstallation fuer Windows.
# Ursprung: Uninstall-Funktion von ZeroDot1 (Linux), hier fuer Windows umgesetzt.
# Entfernt Modellserver, Modelle, Node.js-Laufzeit, Einstellungen und die Verknuepfungen.
# Songs und Bibliothek bleiben auf Wunsch.
#
# Optionen:  -Yes   keine Rueckfragen: alles entfernen, Songs und Bibliothek behalten
param([switch]$Yes)

. (Join-Path $PSScriptRoot "scripts\common.ps1")
Set-Location $ROOT

function Frage([string]$text, [bool]$standardJa) {   # Enter nimmt den Standard
    if ($Yes) { return $true }
    $hint = if ($standardJa) { "[Enter = yes, n = no]" } else { "[Enter = no, y = yes]" }
    $a = Read-Host "$text $hint"
    if ($a -eq "") { return $standardJa }
    return ($a -match '^[jJyY]')
}
function Groesse([string]$pfad) {
    if (-not (Test-Path $pfad)) { return "" }
    $b = (Get-ChildItem $pfad -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($b -ge 1GB) { return ("{0:N1} GB" -f ($b / 1GB)) } else { return ("{0:N0} MB" -f ($b / 1MB)) }
}

# Sicherheitspruefung: nur im Programmordner von SONIQ arbeiten
if (-not (Test-Path (Join-Path $ROOT "backend\src\main.ts")) -or -not (Test-Path (Join-Path $ROOT "scripts\common.ps1")) -or $ROOT -eq $HOME) {
    Write-Host "x This does not look like the SONIQ folder ($ROOT). Nothing was changed."
    if (-not $Yes) { Taste-Zum-Schliessen }
    exit 1
}

Write-Host "==========================================="
Write-Host "  SONIQ - Uninstall"
Write-Host "==========================================="
Write-Host ""
Write-Host "  This removes, inside $ROOT :"
$venv = Join-Path $ROOT ".venv"
$runtime = Join-Path $ROOT "runtime"
$modules = Join-Path $ROOT "node_modules"
if (Test-Path $ENGINE) { Write-Host "    engine\   model server              ($(Groesse (Join-Path $ROOT 'engine')))" }
if (Test-Path $MODELS) { Write-Host "    models\   models                    ($(Groesse $MODELS))" }
if (Test-Path $runtime) { Write-Host "    runtime\  Node.js                   ($(Groesse $runtime))" }
if (Test-Path $modules) { Write-Host "    node_modules\  developer tools      ($(Groesse $modules))" }
if (Test-Path $venv)   { Write-Host "    .venv\    old Python environment    ($(Groesse $venv))" }
if (Test-Path $DATA)   { Write-Host "    data\     settings, logs, library   ($(Groesse $DATA))" }
Write-Host "    the shortcuts 'SONIQ Start' and 'SONIQ Stop' (program folder and desktop)"
Write-Host "  Not removed: the program folder itself, tools installed outside it"
Write-Host "  (for example Git) and songs in a song folder you chose yourself."
Write-Host ""
if (-not (Frage "  Uninstall now?" $false)) { Write-Host "  Cancelled. Nothing was changed."; if (-not $Yes) { Taste-Zum-Schliessen }; exit 0 }

# 1. Server beenden
foreach ($p in @($PORT, $SYNTH_PORT, $LM_PORT)) {
    $pids = Port-Pids $p
    if ($pids.Count) { Write-Host "  Stopping server on port $p ..."; Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1

# 2. Songs und Bibliothek behalten?
$behalten = $false
$songs = Join-Path $DATA "songs"
if ((Test-Path $songs) -and (Get-ChildItem $songs -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Write-Host ""
    Write-Host "  Your songs are in data\songs ($(Groesse $songs))."
    $behalten = Frage "  Keep songs and library (titles, folders, favorites)?" $true
}

# 3. Entfernen
Write-Host ""
if (Test-Path (Join-Path $ROOT "engine")) { Write-Host "  - removing engine\ ..."; Remove-Item (Join-Path $ROOT "engine") -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $MODELS) { Write-Host "  - removing models\ ..."; Remove-Item $MODELS -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $runtime) { Write-Host "  - removing runtime\ ..."; Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue }
foreach ($m in @($modules, (Join-Path $ROOT "backend\node_modules"), (Join-Path $ROOT "frontend\node_modules"))) {
    if (Test-Path $m) { Write-Host "  - removing $(Split-Path -Leaf (Split-Path -Parent $m))\node_modules ..."; Remove-Item $m -Recurse -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $venv) { Write-Host "  - removing .venv\ ..."; Remove-Item $venv -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $DATA) {
    if ($behalten) {
        Write-Host "  - cleaning data\ (keeping songs and library) ..."
        Get-ChildItem $DATA -Force | Where-Object { $_.Name -ne "songs" -and $_.Name -notlike "music.db*" } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  - removing data\ ..."
        Remove-Item $DATA -Recurse -Force -ErrorAction SilentlyContinue
    }
}
foreach ($dir in @($ROOT, [Environment]::GetFolderPath("Desktop"))) {
    foreach ($n in @("SONIQ Start.lnk", "SONIQ Stop.lnk", "Music Generator ON.lnk", "Music Generator OFF.lnk")) {
        $f = Join-Path $dir $n
        if (Test-Path $f) { Write-Host "  - removing shortcut $f"; Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }
}

Write-Host ""
Write-Host "==========================================="
Write-Host "  Done."
if ($behalten) { Write-Host "  Your songs and library were kept in data\." }
Write-Host "  To finish, delete this folder: $ROOT"
Write-Host "==========================================="
if (-not $Yes) { Taste-Zum-Schliessen }
