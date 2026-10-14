# Gemeinsame Einstellungen für Install, Start und Stopp unter Windows. Wird per ". " eingebunden.
# Ports, acestep.cpp-Version und Download-Adresse stehen in common.sh (eine Quelle für Mac und Windows).

$ROOT   = Split-Path -Parent $PSScriptRoot
$ENGINE = Join-Path $ROOT "engine\acestep.cpp"
$MODELS = Join-Path $ROOT "models"         # GGUF-Modelle, getrennt vom Modellserver
$DATA   = Join-Path $ROOT "data"
$CONF   = Join-Path $DATA "engine.conf"      # vom Installer geschrieben: MODE, LM_FILE

# KEY=value-Zeilen aus common.sh übernehmen (PORT, SYNTH_PORT, LM_PORT, ACESTEP_REPO, ACESTEP_REV, HF_BASE, NODE_VERSION, NODE_FLAGS)
# sowie die Modell-Tabelle MODEL_FILES (Name:MB:SHA-256, eine Datei je Zeile)
$MODEL_SHA = @{}; $MODEL_MB = @{}
foreach ($line in Get-Content (Join-Path $PSScriptRoot "common.sh")) {
    if ($line -match '^(PORT|SYNTH_PORT|LM_PORT|ACESTEP_REPO|ACESTEP_REV|HF_BASE|NODE_VERSION|NODE_FLAGS)="?([^"#]+?)"?\s*(#.*)?$') {
        Set-Variable -Name $Matches[1] -Value $Matches[2].Trim()
    }
    if ($line -match '^(?:MODEL_FILES=")?([\w.-]+\.gguf):(\d+):([0-9a-f]{64})"?$') {
        $MODEL_MB[$Matches[1]] = [int]$Matches[2]; $MODEL_SHA[$Matches[1]] = $Matches[3]
    }
}

# Fertige Windows-Binaries des acestep.cpp-Autors (siehe README von acestep.cpp, Abschnitt Windows)
$PREBUILT_URL = "https://www.serveurperso.com/temp/acestep.cpp-win64/build/Release/"

# Node.js-Laufzeit der Web-App (portabel in runtime\node); das Backend läuft direkt aus backend\src (TypeScript)
$NODE_DIR     = Join-Path $ROOT "runtime\node"
$SERVER_ENTRY = Join-Path $ROOT "backend\src\main.ts"
# Prüfsummen der Windows-Pakete (die übrigen Plattformen stehen in common.sh)
$NODE_SHA = @{
    "win-x64"   = "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"
    "win-arm64" = "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921"
}

# Aeltere Installationen hatten die Modelle in engine\acestep.cpp\models: einmalig umziehen statt neu laden.
$alteModelle = Get-ChildItem (Join-Path $ENGINE "models") -Filter *.gguf -File -ErrorAction SilentlyContinue
if ($alteModelle) {
    New-Item -ItemType Directory -Force -Path $MODELS | Out-Null
    foreach ($f in $alteModelle) { if (-not (Test-Path (Join-Path $MODELS $f.Name))) { Move-Item $f.FullName $MODELS } }
}

# Werkzeuge im Benutzerordner (z. B. cmake) und Git
$env:PATH = "$env:USERPROFILE\.local\bin;$env:LOCALAPPDATA\Programs\Git\cmd;$env:ProgramFiles\Git\cmd;$env:PATH"

function Ace-Server {
    foreach ($p in @("build\Release\ace-server.exe", "build\ace-server.exe")) {
        $f = Join-Path $ENGINE $p
        if (Test-Path $f) { return $f }
    }
    return $null
}

# Node für die Web-App: portable Laufzeit, sonst eine installierte ab 22.18 (wegen TypeScript ohne Build)
function Node-Exe {
    $portable = Join-Path $NODE_DIR "node.exe"
    if (Test-Path $portable) { return $portable }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) {
        $v = (& $cmd.Source --version) -replace '^v', ''
        $p = $v.Split('.')
        if ([int]$p[0] -gt 22 -or ([int]$p[0] -eq 22 -and [int]$p[1] -ge 18)) { return $cmd.Source }
    }
    return $null
}

function Port-Laeuft([int]$port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Port-Pids([int]$port) {
    return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty OwningProcess -Unique)
}

# Hintergrundprozess ohne Fenster starten, Ausgabe in eine Log-Datei
function Start-Hintergrund([string]$exe, [string[]]$argumente, [string]$log) {
    $err = [System.IO.Path]::ChangeExtension($log, ".err.log")
    return Start-Process -FilePath $exe -ArgumentList $argumente -WorkingDirectory $ROOT -WindowStyle Hidden `
        -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
}

function Taste-Zum-Schliessen {
    Write-Host ""
    Write-Host "Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
