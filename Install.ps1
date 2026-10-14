# Music Generator – Installer für Windows (NVIDIA-Grafikkarte empfohlen).
# Prüft den PC, installiert was fehlt, lädt Modellserver und Modelle und startet die App.
# Kann jederzeit erneut gestartet werden (z. B. nach "git pull"): Erledigtes wird übersprungen.
#
# Optionen:  -Yes         keine Rückfragen, Empfehlung übernehmen
#            -LM SIZE     Sprachmodell erzwingen: 0.6B, 1.7B oder 4B
#            -NoStart     App am Ende nicht starten
#            -XL          zusätzlich das XL-Klangmodell laden (5,3 GB, in den Einstellungen wählbar)
#            -Build       Modellserver selbst kompilieren statt fertige Binaries zu laden
#                         (braucht Visual Studio Build Tools + CUDA Toolkit)
param([switch]$Yes, [string]$LM = "", [switch]$NoStart, [switch]$Build, [switch]$XL)

. (Join-Path $PSScriptRoot "scripts\common.ps1")
Set-Location $ROOT
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Abbruch([string]$text) {
    Write-Host ""
    Write-Host "x $text"
    if (-not $Yes) { Taste-Zum-Schliessen }
    exit 1
}
function Schritt([string]$text) { Write-Host ""; Write-Host "> $text" }
function Ja([string]$frage) {   # Rückfrage mit Enter = ja
    if ($Yes) { return $true }
    $a = Read-Host "$frage [Enter = yes, n = no]"
    return ($a -eq "" -or $a -match '^[jJyY]')
}
function Download([string]$url, [string]$ziel) {   # fortsetzbar, mit Fortschrittsbalken
    & curl.exe -L --fail -C - --progress-bar -o "$ziel.part" $url
    if ($LASTEXITCODE -ne 0) { return $false }
    Move-Item -Force "$ziel.part" $ziel
    return $true
}

New-Item -ItemType Directory -Force -Path $DATA | Out-Null
Write-Host "==========================================="
Write-Host "  MUSIC GENERATOR · Installation (Windows)"
Write-Host "==========================================="

# --- 1. PC prüfen ---------------------------------------------------------------
Schritt "Checking PC"
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$RAM_GB = [int][math]::Floor($cs.TotalPhysicalMemory / 1GB)
$FREE_GB = [int][math]::Floor((Get-PSDrive -Name $ROOT.Substring(0, 1)).Free / 1GB)
$GPUS = @(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)
$NVIDIA = [bool]($GPUS | Where-Object { $_ -match 'NVIDIA' })
$VRAM_GB = 0
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $mem = (& nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
    if ($mem) { $VRAM_GB = [int][math]::Round([double]$mem / 1024) }
}
# VAE-Decoder in Kacheln rechnen lassen (--vae-chunk, Latent-Frames pro Kachel, Standard 1024 = ein Stück).
# Ohne Kachelung braucht er für 30 s Audio 6,7 GB am Stück; auf einer 6-GB-Karte scheitert das.
$VAE_CHUNK = ""
if ($VRAM_GB) {
    if     ($VRAM_GB -lt 8)  { $VAE_CHUNK = "128" }
    elseif ($VRAM_GB -lt 12) { $VAE_CHUNK = "256" }
    elseif ($VRAM_GB -lt 16) { $VAE_CHUNK = "512" }
}
Write-Host "  Graphics card:   $($GPUS -join ', ')$(if ($VRAM_GB) { " ($VRAM_GB GB)" })"
Write-Host "  Memory:          $RAM_GB GB"
Write-Host "  Windows:         $($os.Caption) $($os.Version)"
Write-Host "  Free disk space: $FREE_GB GB"
if (-not $NVIDIA) {
    Write-Host ""
    Write-Host "  Note: No NVIDIA graphics card found. Only CUDA has been tested; with AMD/Intel (Vulkan)"
    Write-Host "  or CPU only it may be very slow."
    if (-not (Ja "  Continue anyway?")) { Abbruch "Cancelled." }
}

# --- 2. Modellgröße wählen ------------------------------------------------------
if     ($RAM_GB -lt 12) { $EMPF = "0.6B" }
elseif ($RAM_GB -lt 24) { $EMPF = "1.7B" }
else                    { $EMPF = "4B" }
# Auf der Grafikkarte müssen Sprachmodell und KV-Cache (1 GB) zusammen hineinpassen, sonst stürzt der
# Modellserver ab (GTX 1060 6 GB: 4B lädt 4,2 GB, dann scheitert der Cache). Der Grafikspeicher begrenzt also.
if ($VRAM_GB) {
    $GROESSEN = @("0.6B", "1.7B", "4B")
    $VMAX = if ($VRAM_GB -lt 6) { "0.6B" } elseif ($VRAM_GB -lt 8) { "1.7B" } else { "4B" }
    if ($GROESSEN.IndexOf($VMAX) -lt $GROESSEN.IndexOf($EMPF)) { $EMPF = $VMAX }
}
$LM_SIZE = $LM
if (-not $LM_SIZE) {
    $LM_SIZE = $EMPF
    if (-not $Yes) {
        Write-Host ""
        Write-Host "  Language model (plans structure, tempo, key; bigger = better songs, more memory):"
        Write-Host "    1) 0.6B  – 0.7 GB, for 8 GB RAM, graphics card below 6 GB"
        Write-Host "    2) 1.7B  – 2.0 GB, for 16 GB, graphics card with 6 GB"
        Write-Host "    3) 4B    – 4.5 GB, from 24 GB, graphics card from 8 GB"
        $a = Read-Host "  Choice [Enter = $EMPF recommended]"
        switch ($a) { "1" { $LM_SIZE = "0.6B" } "2" { $LM_SIZE = "1.7B" } "3" { $LM_SIZE = "4B" } }
    }
}
if ($LM_SIZE -notin @("0.6B", "1.7B", "4B")) { Abbruch "Unknown model size: $LM_SIZE (allowed: 0.6B, 1.7B, 4B)" }
$LM_FILE = "acestep-5Hz-lm-$LM_SIZE-Q8_0.gguf"
Write-Host "  -> Language model $LM_SIZE, sound model SFT (high quality)"

# Optional: XL-Klangmodell (4 statt 2 Mrd. Parameter). Ist es schon da, bleibt es; sonst nur auf Wunsch.
$XL_FILE = "acestep-v15-xl-sft-Q8_0.gguf"
if (Test-Path (Join-Path $MODELS $XL_FILE)) { $XL = [switch]$true }
if (-not $XL -and -not $Yes) {
    Write-Host ""
    Write-Host "  Sound model XL (optional extra, 5.3 GB): better sound quality according to the developers,"
    Write-Host "  but takes about twice as long and needs more memory. The smaller model stays the default;"
    Write-Host "  you can pick XL afterwards in the app settings."
    if ($VRAM_GB -and $VRAM_GB -lt 12) { Write-Host "  Not recommended with $VRAM_GB GB graphics memory (12 GB or more advised)." }
    $a = Read-Host "  Download XL as well? [Enter = no, y = yes]"
    if ($a -match '^[jJyY]') { $XL = [switch]$true }
}
if ($XL) { Write-Host "  -> plus XL sound model" }

# Dateien + Größe in MB (für die Speicherplatz-Prüfung)
$FILES = [ordered]@{}
$WANT = @("vae-BF16.gguf", "Qwen3-Embedding-0.6B-Q8_0.gguf", "acestep-v15-sft-Q8_0.gguf", $LM_FILE)
if ($XL) { $WANT += $XL_FILE }
foreach ($f in $WANT) {
    if (-not $MODEL_SHA[$f]) { Abbruch "File $f is missing in the model table (scripts\common.sh)." }
    $FILES[$f] = $MODEL_MB[$f]
}
$NEED_MB = 0
foreach ($f in $FILES.Keys) { if (-not (Test-Path (Join-Path $MODELS $f))) { $NEED_MB += $FILES[$f] } }
$NEED_GB = [int][math]::Ceiling($NEED_MB / 1024) + 3   # + Modellserver, Node.js und etwas Platz für Songs
Write-Host "  Download: $([math]::Ceiling($NEED_MB / 1024)) GB · about $NEED_GB GB free space needed in total"
if ($FREE_GB -lt $NEED_GB) { Abbruch "Not enough disk space: $FREE_GB GB free, about $NEED_GB GB needed." }
if (-not (Ja "  Start installation?")) { Abbruch "Cancelled." }

# --- 3. Werkzeuge ---------------------------------------------------------------
Schritt "git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  installing (winget) ..."
    & winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = "$env:ProgramFiles\Git\cmd;$env:LOCALAPPDATA\Programs\Git\cmd;$env:PATH"
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Abbruch "git could not be installed. Please download it from https://git-scm.com and run 'Install' again." }
}
Write-Host "  $(& git --version)"

Schritt "Node.js (runs the web app)"
$nodeExe = Join-Path $NODE_DIR "node.exe"
if ((Test-Path $nodeExe) -and ((& $nodeExe --version) -eq "v$NODE_VERSION")) {
    Write-Host "  present (v$NODE_VERSION)"
} else {
    # Portable Version ohne Admin-Rechte, Prüfsumme fest in common.ps1
    $plat = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "win-arm64" } else { "win-x64" }
    $name = "node-v$NODE_VERSION-$plat"
    $zip = Join-Path $ROOT "runtime\$name.zip"
    New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "runtime") | Out-Null
    if (-not (Download "https://nodejs.org/dist/v$NODE_VERSION/$name.zip" $zip)) { Abbruch "Downloading Node.js failed. Running Install again resumes." }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne $NODE_SHA[$plat]) {
        Remove-Item -Force $zip
        Abbruch "Checksum of Node.js does not match. The file was deleted; running Install again downloads it anew."
    }
    if (Test-Path $NODE_DIR) { Remove-Item $NODE_DIR -Recurse -Force }
    # tar (ab Windows 10 1803) entpackt deutlich schneller als Expand-Archive
    $entpackt = $false
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
        & tar.exe -xf $zip -C (Join-Path $ROOT "runtime") 2>$null
        $entpackt = ($LASTEXITCODE -eq 0)
    }
    if (-not $entpackt) { Expand-Archive -Path $zip -DestinationPath (Join-Path $ROOT "runtime") -Force }
    Rename-Item (Join-Path $ROOT "runtime\$name") "node"
    Remove-Item -Force $zip
    if (-not (Test-Path $nodeExe)) { Abbruch "Node.js could not be unpacked." }
    Write-Host "  installed (v$NODE_VERSION)"
}

# --- 4. Modellserver (acestep.cpp) ----------------------------------------------
Schritt "Model server acestep.cpp"
$ACE = Ace-Server
if ($ACE -and -not $Build) {
    Write-Host "  present: $ACE"
} elseif (-not $Build) {
    # Fertige Binaries des acestep.cpp-Autors (CUDA + Vulkan + CPU, Backend wird zur Laufzeit gewählt)
    Write-Host "  downloading ready-made Windows binaries (about 180 MB) ..."
    $rel = Join-Path $ENGINE "build\Release"
    New-Item -ItemType Directory -Force -Path $rel | Out-Null
    $index = (Invoke-WebRequest -UseBasicParsing $PREBUILT_URL).Content
    $names = [regex]::Matches($index, 'href="([^"/?]+\.(exe|dll))"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    if (-not $names) { Abbruch "Could not read the binaries file list ($PREBUILT_URL). Alternative: 'Install -Build' compiles it yourself." }
    foreach ($n in $names) {
        Write-Host "  v $n"
        if (-not (Download "$PREBUILT_URL$n" (Join-Path $rel $n))) { Abbruch "Downloading $n failed. Running Install again resumes." }
    }
    "PREBUILT=$(Get-Date -Format s)" | Set-Content (Join-Path $rel "VERSION.txt")
    Write-Host "  done"
} else {
    # Selbst kompilieren: Quellcode in der getesteten Version, CUDA wenn vorhanden
    if (-not (Test-Path (Join-Path $ENGINE ".git"))) {
        New-Item -ItemType Directory -Force -Path (Join-Path $ROOT "engine") | Out-Null
        & git clone --quiet $ACESTEP_REPO $ENGINE
        if ($LASTEXITCODE -ne 0) { Abbruch "Downloading acestep.cpp failed." }
    }
    Push-Location $ENGINE
    & git cat-file -e "$ACESTEP_REV^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { & git fetch --quiet origin }
    & git checkout --quiet $ACESTEP_REV
    if ($LASTEXITCODE -ne 0) { Pop-Location; Abbruch "Could not switch acestep.cpp to version $($ACESTEP_REV.Substring(0, 7))." }
    & git submodule update --init --recursive --quiet
    Pop-Location

    if ($ACE -and ((& $ACE --help 2>&1 | Select-Object -First 1) -match $ACESTEP_REV.Substring(0, 7))) {   # --help zeigt den kurzen Hash
        Write-Host "  already built ($($ACESTEP_REV.Substring(0, 7)))"
    } else {
        if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
            & winget install --id Kitware.CMake -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
            $env:PATH = "$env:ProgramFiles\CMake\bin;$env:PATH"
        }
        $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
        $vs = if (Test-Path $vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { "" }
        if (-not $vs) {
            Write-Host "  Visual Studio Build Tools are missing. Installation (about 7 GB, admin rights):"
            Write-Host '    winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
            Abbruch "Then run 'Install -Build' again."
        }
        $cuda = $env:CUDA_PATH
        if (-not $cuda) { $cuda = [Environment]::GetEnvironmentVariable("CUDA_PATH", "Machine") }
        if ($NVIDIA -and -not $cuda) {
            Write-Host "  CUDA Toolkit is missing. Installation (about 3 GB, admin rights):  winget install Nvidia.CUDA"
            Abbruch "Then run 'Install -Build' again (without CUDA 'Install -Build' still works, but CPU/Vulkan only)."
        }
        $flags = @("-DGGML_CPU_ALL_VARIANTS=ON", "-DGGML_BACKEND_DL=ON")
        if ($cuda) { $flags += @("-DGGML_CUDA=ON", "-DCMAKE_CUDA_ARCHITECTURES=native") }
        Write-Host "  building (takes 10-30 minutes) ..."
        Push-Location $ENGINE
        $log = Join-Path $DATA "build.log"
        & cmake -S . -B build @flags *> $log
        if ($LASTEXITCODE -eq 0) { & cmake --build build --config Release -j $env:NUMBER_OF_PROCESSORS *>> $log }
        $rc = $LASTEXITCODE
        Pop-Location
        if ($rc -ne 0) { Abbruch "Build failed, details in data\build.log" }
        Write-Host "  done"
    }
}
$ACE = Ace-Server
if (-not $ACE) { Abbruch "ace-server.exe not found." }

# --- 5. Modelle -----------------------------------------------------------------
Schritt "Downloading models"
New-Item -ItemType Directory -Force -Path $MODELS | Out-Null
$NEW_MODELS = $false
foreach ($f in $FILES.Keys) {
    $ziel = Join-Path $MODELS $f
    if (Test-Path $ziel) { Write-Host "  ok $f"; continue }
    Write-Host "  v $f"
    if (-not (Download "$HF_BASE/$f" "$ziel.neu")) { Abbruch "Downloading $f failed. Running Install again resumes the download." }
    Write-Host "    verifying checksum ..."
    if ((Get-FileHash -Algorithm SHA256 "$ziel.neu").Hash.ToLower() -ne $MODEL_SHA[$f]) {
        Remove-Item -Force "$ziel.neu"
        Abbruch "Checksum of $f does not match. The file was deleted; running Install again downloads it anew."
    }
    Move-Item -Force "$ziel.neu" $ziel
    Write-Host "    checksum ok"
    $NEW_MODELS = $true
}
# Der Modellserver liest die Modellliste nur beim Start: nach neuen Modellen laufende Server beenden, ON startet sie neu.
if ($NEW_MODELS) {
    foreach ($p in @($SYNTH_PORT, $LM_PORT)) {
        $pids = Port-Pids $p
        if ($pids.Count) { Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Seconds 1
}

# --- 6. Grafikkarte testen ------------------------------------------------------
# Prüft, ob das Sprachmodell auf der Grafikkarte brauchbar rechnet (auf dem Mac M4 tut es das nicht).
# Sonst läuft es auf der CPU (Modus "split"), sonst reicht ein Server (Modus "single").
Schritt "Testing graphics card"
$OLD = @{}
if (Test-Path $CONF) { foreach ($l in Get-Content $CONF) { if ($l -match '^(\w+)=(.*)$') { $OLD[$Matches[1]] = $Matches[2] } } }
$STAMP = if (Test-Path (Join-Path $ENGINE "build\Release\VERSION.txt")) { (Get-Content (Join-Path $ENGINE "build\Release\VERSION.txt") -First 1) } else { $ACESTEP_REV }
if ($OLD.MODE -and $OLD.LM_FILE -eq $LM_FILE -and $OLD.TESTED_REV -eq $STAMP) {
    $MODE = $OLD.MODE
    Write-Host "  already tested: mode $MODE"
} else {
    $TEST_PORT = 8099
    if (Port-Laeuft $TEST_PORT) { Abbruch "Port $TEST_PORT is in use, please try again later." }
    $args_ = @("--host", "127.0.0.1", "--port", $TEST_PORT, "--models", "`"$MODELS`"", "--max-batch", "1")
    if ($VAE_CHUNK) { $args_ += @("--vae-chunk", $VAE_CHUNK) }
    $proc = Start-Hintergrund $ACE $args_ (Join-Path $DATA "selftest.log")
    for ($i = 0; $i -lt 120; $i++) {
        try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$TEST_PORT/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($proc.HasExited) {
        Get-Content (Join-Path $DATA "selftest.err.log") -Tail 15 -ErrorAction SilentlyContinue
        Abbruch "The model server does not start (see data\selftest.err.log). If a DLL is missing, a current NVIDIA driver usually helps."
    }
    Write-Host "  Trial run of the language model on the graphics card (can take 1-2 minutes) ..."
    & (Node-Exe) $NODE_FLAGS (Join-Path $ROOT "backend\src\cli\selftest.ts") $TEST_PORT $LM_FILE
    $MODE = if ($LASTEXITCODE -eq 0) { "single" } else { "split" }
    if ($proc.HasExited) {   # abgestürzt (z. B. Grafikspeicher voll): Ursache zeigen statt nur "Verbindung verweigert"
        Write-Host "  The model server crashed during the test (data\selftest.err.log):"
        Get-Content (Join-Path $DATA "selftest.err.log") -Tail 4 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
    }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  -> mode $MODE"
}
@("MODE=$MODE", "LM_FILE=$LM_FILE", "TESTED_REV=$STAMP", "VAE_CHUNK=$VAE_CHUNK") | Set-Content $CONF

# --- 7. Verknüpfungen -----------------------------------------------------------
Schritt "Shortcuts (program folder and desktop)"
$shell = New-Object -ComObject WScript.Shell
foreach ($e in @(@("Music Generator ON", "icon-on.ico"), @("Music Generator OFF", "icon-off.ico"))) {
    foreach ($dir in @($ROOT, [Environment]::GetFolderPath("Desktop"))) {
        $lnk = $shell.CreateShortcut((Join-Path $dir "$($e[0]).lnk"))
        $lnk.TargetPath = "powershell.exe"
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $ROOT "$($e[0]).ps1")`""
        $lnk.WorkingDirectory = $ROOT
        $lnk.IconLocation = (Join-Path $ROOT "assets\$($e[1])")
        $lnk.Save()
    }
}
Write-Host "  ok"

# --- Fertig ---------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================="
Write-Host "  Done. Start with 'Music Generator ON',"
Write-Host "  stop with 'Music Generator OFF'."
Write-Host "==========================================="
if (-not $NoStart) {
    & (Join-Path $ROOT "Music Generator ON.ps1")
}
