#!/bin/bash
# SONIQ – Arch Linux Installer, Starter und Manager.
# Autor: ZeroDot1
# Prüft das Arch-System, installiert fehlende Pakete (pacman/yay, Node.js),
# baut den Modellserver (Vulkan/ROCm/CUDA/CPU), lädt die Modelle und startet die App.
#
# Optionen:
#   --yes, -y              Keine Rückfragen, Empfehlungen automatisch übernehmen
#   --yay                  Fehlende Pakete mit yay (AUR-Helper) installieren
#   --start                Nur die Server starten und Browser öffnen
#   --stop                 Laufende Server beenden
#   --status               Status der Server anzeigen
#   --install-only         Nur installieren/bauen/Modelle laden, nicht starten
#   --uninstall            Modellserver, Modelle und Umgebung entfernen (Songs auf Wunsch behalten)
#   --backend [auto|rocm|hip|vulkan|cuda|cpu]   Grafik-/Rechen-Backend wählen (Standard: auto)
#                          (rocm/hip empfohlen für AMD Radeon wie RX 9070 XT)
#   --lm [0.6B|1.7B|4B]    Sprachmodellgröße festlegen
#   --xl                   Zusätzlich das XL-Klangmodell herunterladen (5,3 GB)
#   --stems                Zusätzlich das Spuren-Modell herunterladen (2,5 GB: Spur für Spur, Herauslösen, Ersetzen)
#   --xl-stems             Zusätzlich das XL-Spuren-Modell herunterladen (5,3 GB, in den Einstellungen wählbar)
#   --no-browser           Browser beim Start nicht automatisch öffnen
#   --help, -h             Diese Hilfe anzeigen

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SOURCE_DIR/scripts/common.sh"
cd "$ROOT" || exit 1

AUTO=0
ACTION="run"       # run, install_only, start, stop, status, uninstall
LM_SIZE=""
XL=0
STEMS=0
XL_STEMS=0
REBUILD=0
BACKEND="auto"
OPEN_BROWSER=1
USE_YAY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) AUTO=1 ;;
    --yay) USE_YAY=1 ;;
    --start) ACTION="start" ;;
    --stop) ACTION="stop" ;;
    --status) ACTION="status" ;;
    --uninstall) ACTION="uninstall" ;;
    --install-only|--no-start) ACTION="install_only" ;;
    --rebuild) REBUILD=1 ;;
    --backend) BACKEND="$2"; shift ;;
    --lm) LM_SIZE="$2"; shift ;;
    --xl) XL=1 ;;
    --stems) STEMS=1 ;;
    --xl-stems) XL_STEMS=1 ;;
    --no-browser) OPEN_BROWSER=0 ;;
    --help|-h)
      echo "SONIQ – Arch Linux Setup & Launcher"
      echo "Author: ZeroDot1"
      echo ""
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --yes, -y              Automatic installation without questions"
      echo "  --yay                  Install missing packages with yay (AUR helper)"
      echo "  --start                Only start the servers and open the browser"
      echo "  --stop                 Stop running servers"
      echo "  --status               Show server status"
      echo "  --uninstall            Remove model server, models and environment (songs can be kept)"
      echo "  --install-only         Only install and set up, do not start"
      echo "  --rebuild              Recompile acestep.cpp"
      echo "  --backend [auto|rocm|hip|vulkan|cuda|cpu]   Choose backend (default: auto)"
      echo "                         (rocm/hip for AMD Radeon such as RX 9070 XT)"
      echo "  --lm [0.6B|1.7B|4B]    Force language model size"
      echo "  --xl                   Also download the XL sound model"
      echo "  --stems                Also download the track model (track by track, extract, replace)"
      echo "  --no-browser           Do not open the browser automatically"
      echo "  --help, -h             Show help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1. See $0 --help"
      exit 1
      ;;
  esac
  shift
done

abbruch() {
  echo ""
  echo "✗ $1"
  [ "$AUTO" = 1 ] || read -n 1 -s -r -p "Press any key to exit..." 2>/dev/null || true
  echo ""
  exit 1
}

schritt() { echo ""; echo "▸ $1"; }

ja() {
  [ "$AUTO" = 1 ] && return 0
  local a
  read -r -p "$1 [Enter = yes, n = no] " a
  [ -z "$a" ] || [[ "$a" =~ ^[jJyY] ]]
}

berechne_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

oeffne_browser() {
  local url="$1"
  [ "$OPEN_BROWSER" = 1 ] || return 0
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "$url" >/dev/null 2>&1 &
  fi
}

# --- Server-Stopp -------------------------------------------------------------
stoppe_server() {
  schritt "Stopping servers"
  local found=0
  for P in "$PORT" "$SYNTH_PORT" "$LM_PORT"; do
    local pids
    pids=$(port_pids "$P")
    if [ -n "$pids" ]; then
      echo "  Stopping port $P (PID: $pids)..."
      kill $pids 2>/dev/null || true
      found=1
    fi
  done
  sleep 1
  for P in "$PORT" "$SYNTH_PORT" "$LM_PORT"; do
    local pids
    pids=$(port_pids "$P")
    if [ -n "$pids" ]; then
      kill -9 $pids 2>/dev/null || true
    fi
  done
  if [ "$found" = 1 ]; then
    echo "  ✓ Servers stopped."
  else
    echo "  No running servers found."
  fi
}

# --- Server-Status ------------------------------------------------------------
zeige_status() {
  schritt "Server status"
  lade_conf
  echo "  Configuration: mode $MODE, LM $LM_FILE, VAE_CHUNK=${VAE_CHUNK:-default}"
  if laeuft "$PORT"; then
    echo "  ✓ Web app running on port $PORT (http://localhost:$PORT)"
  else
    echo "  ✗ Web app not running (port $PORT free)"
  fi
  if laeuft "$SYNTH_PORT"; then
    echo "  ✓ Synthesis server running on port $SYNTH_PORT"
  else
    echo "  ✗ Synthesis server not running (port $SYNTH_PORT free)"
  fi
  if [ "$MODE" = "split" ]; then
    if laeuft "$LM_PORT"; then
      echo "  ✓ Language model server (CPU) running on port $LM_PORT"
    else
      echo "  ✗ Language model server not running (port $LM_PORT free)"
    fi
  fi
}

# --- Server-Start -------------------------------------------------------------
starte_server() {
  schritt "Starting SONIQ"
  lade_conf
  mkdir -p "$DATA"

  if [ ! -x "$ENGINE/build/ace-server" ] || ! node_bin >/dev/null; then
    echo "  Model server or Node.js is missing. Running the installation first."
    installiere
  fi
  local NODE
  NODE=$(node_bin) || abbruch "Node.js is missing."

  # Hardware- und GPU-Umgebungsvariablen (ROCm / AMD Radeon / Multi-GPU)
  [ -d "/opt/rocm/bin" ] && export PATH="/opt/rocm/bin:$PATH"
  [ -d "/opt/rocm/lib" ] && export LD_LIBRARY_PATH="/opt/rocm/lib:${LD_LIBRARY_PATH:-}"
  # Standardwerte für Systeme mit integrierter und dedizierter Grafik (erste Karte, dedizierte bevorzugt).
  # Wer andere Werte braucht, setzt die Variablen vor dem Start selbst, sie werden nicht überschrieben.
  export HIP_VISIBLE_DEVICES="${HIP_VISIBLE_DEVICES:-0}"
  export DRI_PRIME="${DRI_PRIME:-1}"
  export GGML_VK_VISIBLE_DEVICES="${GGML_VK_VISIBLE_DEVICES:-0}"

  local SERVER_ARGS=(--models "$MODELS" --max-batch 1)
  [ -n "$VAE_CHUNK" ] && SERVER_ARGS+=(--vae-chunk "$VAE_CHUNK")
  # Synth: Modelle im VRAM halten wenn genug Speicher (KEEP_LOADED=1) oder große VAE-Kacheln
  local SYNTH_ARGS=("${SERVER_ARGS[@]}")
  if [ "$KEEP_LOADED" = "1" ] || [ "$KEEP_LOADED" = "true" ] || { [ -z "$KEEP_LOADED" ] && { [ -z "$VAE_CHUNK" ] || [ "${VAE_CHUNK:-0}" -ge 512 ] 2>/dev/null; }; }; then
    SYNTH_ARGS+=(--keep-loaded)
  fi

  # 1. Sprachmodell-Server (bei split auf CPU)
  if [ "$MODE" = "split" ]; then
    if laeuft "$LM_PORT"; then
      echo "  Language model server is already running (port $LM_PORT)."
    else
      echo "  Starting language model server (CPU)..."
      if command -v setsid >/dev/null 2>&1; then
        setsid env GGML_BACKEND=CPU "$ENGINE/build/ace-server" --host 127.0.0.1 --port "$LM_PORT" \
          "${SERVER_ARGS[@]}" > "$DATA/ace-lm.log" 2>&1 &
      else
        GGML_BACKEND=CPU nohup "$ENGINE/build/ace-server" --host 127.0.0.1 --port "$LM_PORT" \
          "${SERVER_ARGS[@]}" > "$DATA/ace-lm.log" 2>&1 &
      fi
      disown 2>/dev/null || true
    fi
  fi

  # 2. Synthese-Server
  if laeuft "$SYNTH_PORT"; then
    echo "  Synthesis server is already running (port $SYNTH_PORT)."
  else
    echo "  Starting synthesis server..."
    if command -v setsid >/dev/null 2>&1; then
      setsid "$ENGINE/build/ace-server" --host 127.0.0.1 --port "$SYNTH_PORT" \
        "${SYNTH_ARGS[@]}" > "$DATA/ace-server.log" 2>&1 &
    else
      nohup "$ENGINE/build/ace-server" --host 127.0.0.1 --port "$SYNTH_PORT" \
        "${SYNTH_ARGS[@]}" > "$DATA/ace-server.log" 2>&1 &
    fi
    disown 2>/dev/null || true
  fi

  # 3. Web-App
  local APP_PID=""
  APP_PID=$(port_pids "$PORT" | head -1 || true)
  if [ -n "$APP_PID" ]; then
    local START_TIME=""
    [ -d "/proc/$APP_PID" ] && START_TIME=$(stat -c '%Y' "/proc/$APP_PID" 2>/dev/null || true)
    local NEUESTE=""
    NEUESTE=$(find backend/src shared frontend/dist -type f \( -name '*.ts' -o -name '*.js' -o -name '*.html' -o -name '*.css' \) -exec stat -c '%Y' {} + 2>/dev/null | sort -rn | head -1 || true)
    if [ -n "$START_TIME" ] && [ -n "$NEUESTE" ] && [ "$NEUESTE" -gt "$START_TIME" ]; then
      echo "  The code was updated. Restarting the web app..."
      kill "$APP_PID" 2>/dev/null || true
      for _ in $(seq 1 20); do laeuft "$PORT" || break; sleep 0.5; done
      APP_PID=""
    else
      echo "  Web app is already running on port $PORT."
    fi
  fi

  if [ -z "$APP_PID" ]; then
    echo "  Starting web app..."
    if command -v setsid >/dev/null 2>&1; then
      setsid "$NODE" $NODE_FLAGS "$SERVER_ENTRY" --port "$PORT" > "$DATA/server.log" 2>&1 &
    else
      nohup "$NODE" $NODE_FLAGS "$SERVER_ENTRY" --port "$PORT" > "$DATA/server.log" 2>&1 &
    fi
    disown 2>/dev/null || true
  fi

  # 4. Warten, bis alles antwortet
  echo "  Waiting for servers..."
  for _ in $(seq 1 60); do
    laeuft "$PORT" && laeuft "$SYNTH_PORT" && { [ "$MODE" != "split" ] || laeuft "$LM_PORT"; } && break
    sleep 0.5
  done

  laeuft "$PORT" || abbruch "The web app did not start in time. See data/server.log"
  laeuft "$SYNTH_PORT" || abbruch "The synthesis server did not start in time. See data/ace-server.log"
  if [ "$MODE" = "split" ]; then
    laeuft "$LM_PORT" || abbruch "The language model server did not start in time. See data/ace-lm.log"
  fi

  echo "  ✓ All servers are running!"
  oeffne_browser "http://localhost:$PORT"
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  SONIQ is open at: http://localhost:$PORT"
  echo "  To stop:      $0 --stop"
  echo "  or:           './stop.sh'"
  echo "═══════════════════════════════════════════════════════════"
}

# --- Haupt-Installation --------------------------------------------------------
installiere() {
  echo "═══════════════════════════════════════════════════════════"
  echo "  SONIQ · Arch Linux Setup"
  echo "═══════════════════════════════════════════════════════════"

  # 1. System und Hardware prüfen
  schritt "1. Checking system and hardware"
  if [ "$(uname -s)" != "Linux" ]; then
    abbruch "This script is made for Linux (detected: $(uname -s))."
  fi

  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    echo "  Distribution: $PRETTY_NAME"
    if [[ "$ID" != "arch" && "$ID_LIKE" != *"arch"* && "$ID" != "cachyos" && "$ID" != "manjaro" && "$ID" != "endeavouros" ]]; then
      echo "  Note: No standard Arch system detected ($ID). The pacman package manager is still required."
    fi
  fi

  ARCH=$(uname -m)
  echo "  Architecture: $ARCH"
  if [ "$ARCH" != "x86_64" ]; then
    echo "  Warning: Non-x86_64 architecture. acestep.cpp may not be fully supported."
  fi

  # RAM ermitteln
  local mem_kb
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
  RAM_GB=$(( mem_kb / 1048576 ))
  echo "  Memory:       ${RAM_GB} GB"

  # Freier Speicherplatz
  local free_kb
  free_kb=$(df -k "$ROOT" | awk 'NR==2 {print $4}')
  FREE_GB=$(( free_kb / 1048576 ))
  echo "  Free disk space: ${FREE_GB} GB"

  # GPU-Erkennung
  local GPU_INFO
  GPU_INFO=$(lspci 2>/dev/null | grep -iE 'vga|3d|display' || true)
  local HAS_NVIDIA=0
  local HAS_AMD=0
  local HAS_INTEL=0
  local VRAM_GB=0
  local AMD_GFX=""

  if echo "$GPU_INFO" | grep -iq 'nvidia'; then HAS_NVIDIA=1; fi
  if echo "$GPU_INFO" | grep -iqE 'amd|radeon|advanced micro devices'; then HAS_AMD=1; fi
  if echo "$GPU_INFO" | grep -iq 'intel'; then HAS_INTEL=1; fi

  if [ "$HAS_NVIDIA" = 1 ] && command -v nvidia-smi >/dev/null 2>&1; then
    local vram_mb
    vram_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)
    VRAM_GB=$(( (vram_mb + 512) / 1024 ))
  elif [ "$HAS_AMD" = 1 ]; then
    # VRAM via sysfs (/sys/class/drm) oder rocm-smi
    local vram_bytes=0
    for f in /sys/class/drm/card*/device/mem_info_vram_total; do
      if [ -r "$f" ]; then
        vram_bytes=$(cat "$f" 2>/dev/null || echo 0)
        [ "$vram_bytes" -gt 0 ] && break
      fi
    done
    if [ "$vram_bytes" -gt 0 ]; then
      VRAM_GB=$(( (vram_bytes / 1048576 + 512) / 1024 ))
    elif command -v rocm-smi >/dev/null 2>&1; then
      local vram_raw
      vram_raw=$(rocm-smi --showmeminfo vram 2>/dev/null | grep -o 'VRAM Total Memory (B): [0-9]*' | awk '{print $NF}' | head -1 || echo 0)
      [ "$vram_raw" -gt 0 ] && VRAM_GB=$(( (vram_raw / 1048576 + 512) / 1024 ))
    fi
    # AMD GFX Ziel-Architektur ermitteln (z.B. gfx1201 für RX 9070 XT)
    if command -v rocminfo >/dev/null 2>&1; then
      AMD_GFX=$(rocminfo 2>/dev/null | grep -m1 -o 'gfx[0-9a-z]*' || true)
    fi
  fi

  echo "  Graphics card(s):"
  if [ -n "$GPU_INFO" ]; then
    echo "$GPU_INFO" | sed 's/^/    /'
  else
    echo "    No dedicated GPU found"
  fi
  [ "$VRAM_GB" -gt 0 ] && echo "    Graphics memory (VRAM): ${VRAM_GB} GB"
  [ -n "$AMD_GFX" ] && echo "    AMD GPU architecture:  $AMD_GFX"

  # VAE Chunking nach VRAM festlegen
  VAE_CHUNK=""
  if [ "$VRAM_GB" -gt 0 ]; then
    if   [ "$VRAM_GB" -lt 8 ];  then VAE_CHUNK="128"
    elif [ "$VRAM_GB" -lt 12 ]; then VAE_CHUNK="256"
    elif [ "$VRAM_GB" -lt 16 ]; then VAE_CHUNK="512"
    fi
  elif [ "$HAS_AMD" = 1 ] || [ "$HAS_INTEL" = 1 ]; then
    # Bei AMD/Intel im Vulkan-Modus ist VAE_CHUNK=256 ein sicherer Standard für Karten bis 16GB
    VAE_CHUNK="256"
  fi

  # 2. Backend bestimmen
  schritt "2. Choosing compute backend"
  local CHOSEN_BACKEND="$BACKEND"
  if [ "$CHOSEN_BACKEND" = "auto" ]; then
    if [ "$HAS_AMD" = 1 ] && { [ -d "/opt/rocm" ] || command -v hipcc >/dev/null 2>&1 || command -v rocminfo >/dev/null 2>&1; }; then
      CHOSEN_BACKEND="rocm"
    elif [ "$HAS_NVIDIA" = 1 ] && { command -v nvcc >/dev/null 2>&1 || [ -d "/opt/cuda" ]; }; then
      CHOSEN_BACKEND="cuda"
    elif [ "$HAS_AMD" = 1 ] || [ "$HAS_INTEL" = 1 ] || [ "$HAS_NVIDIA" = 1 ]; then
      CHOSEN_BACKEND="vulkan"
    else
      CHOSEN_BACKEND="cpu"
    fi
  fi
  [ "$CHOSEN_BACKEND" = "hip" ] && CHOSEN_BACKEND="rocm"
  echo "  Selected backend: $CHOSEN_BACKEND"

  # 3. Arch Linux Pakete prüfen und installieren
  schritt "3. Checking Arch Linux dependencies (pacman / yay)"
  local BASE_PKGS=(base-devel cmake git curl lsof xdg-utils)
  local GPU_PKGS=()

  if [ "$CHOSEN_BACKEND" = "rocm" ]; then
    # Für AMD ROCm / HIP
    if ! command -v hipcc >/dev/null 2>&1 && ! pacman -Q hip-runtime-amd >/dev/null 2>&1; then
      GPU_PKGS+=(rocm-hip-sdk)
    fi
  elif [ "$CHOSEN_BACKEND" = "vulkan" ]; then
    GPU_PKGS=(vulkan-headers spirv-headers shaderc vulkan-icd-loader)
    if [ "$HAS_AMD" = 1 ]; then
      GPU_PKGS+=(vulkan-radeon)
    elif [ "$HAS_INTEL" = 1 ]; then
      GPU_PKGS+=(vulkan-intel)
    elif [ "$HAS_NVIDIA" = 1 ]; then
      GPU_PKGS+=(nvidia-utils)
    fi
  elif [ "$CHOSEN_BACKEND" = "cuda" ]; then
    GPU_PKGS=(cuda)
  fi

  local NEEDED_PKGS=()
  for pkg in "${BASE_PKGS[@]}" "${GPU_PKGS[@]}"; do
    if ! pacman -Q "$pkg" >/dev/null 2>&1; then
      # Sonderfall base-devel (Meta-Paket)
      if [ "$pkg" = "base-devel" ] && pacman -Qg base-devel >/dev/null 2>&1; then
        continue
      fi
      # Sonderfall gcc
      if [ "$pkg" = "base-devel" ] && command -v gcc >/dev/null 2>&1 && command -v make >/dev/null 2>&1; then
        continue
      fi
      # Sonderfall lsof: ss oder fuser reicht aus
      if [ "$pkg" = "lsof" ] && { command -v ss >/dev/null 2>&1 || command -v fuser >/dev/null 2>&1; }; then
        continue
      fi
      # Sonderfall Vulkan Treiber: wenn bereits ein ICD installiert ist
      if [[ "$pkg" =~ vulkan-(radeon|intel) ]] && pacman -Q vulkan-icd-loader >/dev/null 2>&1 && [ -d /usr/share/vulkan/icd.d ] && [ "$(ls -A /usr/share/vulkan/icd.d 2>/dev/null)" ]; then
        continue
      fi
      NEEDED_PKGS+=("$pkg")
    fi
  done

  if [ ${#NEEDED_PKGS[@]} -gt 0 ]; then
    echo "  The following Arch packages are missing:"
    for p in "${NEEDED_PKGS[@]}"; do echo "    - $p"; done
    echo ""
    local METHOD=""
    if [ "$USE_YAY" = 1 ]; then
      if command -v yay >/dev/null 2>&1; then
        METHOD="yay"
      else
        echo "  Note: yay was requested but is not installed. Falling back to sudo pacman."
        METHOD="pacman"
      fi
    elif [ "$AUTO" = 1 ]; then
      METHOD="pacman"
    else
      if command -v yay >/dev/null 2>&1; then
        read -r -p "  Install missing packages now with [Enter = sudo pacman, y = yay, n = cancel]? " a
        if [[ "$a" =~ ^[yY] ]]; then
          METHOD="yay"
        elif [ -z "$a" ] || [[ "$a" =~ ^[jJpP] ]]; then
          METHOD="pacman"
        fi
      else
        if ja "  Install missing packages now with 'sudo pacman -S --needed'?"; then
          METHOD="pacman"
        fi
      fi
    fi

    local install_rc=0
    if [ "$METHOD" = "yay" ]; then
      echo "  Installing packages with 'yay -S --needed'..."
      yay -S --needed "${NEEDED_PKGS[@]}" || install_rc=$?
    elif [ "$METHOD" = "pacman" ]; then
      echo "  Installing packages with 'sudo pacman -S --needed'..."
      sudo pacman -S --needed "${NEEDED_PKGS[@]}" || install_rc=$?
    else
      install_rc=1
    fi

    if [ "$install_rc" -ne 0 ]; then
      echo "  Warning: Installing some packages failed or was cancelled."
      if [ "$CHOSEN_BACKEND" = "vulkan" ] || [ "$CHOSEN_BACKEND" = "rocm" ] || [ "$CHOSEN_BACKEND" = "cuda" ]; then
        echo "  Switching to the CPU backend as a fallback..."
        CHOSEN_BACKEND="cpu"
      fi
    fi
  else
    echo "  ✓ All required system packages are present."
  fi

  # Node.js (Laufzeit der Web-App): installiertes nodejs ab 22.18 samt npm (bei Arch ein eigenes Paket),
  # sonst portable Version in runtime/node (bringt npm mit)
  schritt "4. Setting up Node.js for the web app"
  if node_bin >/dev/null && { [ -x "$NODE_DIR/bin/node" ] || command -v npm >/dev/null 2>&1; }; then
    echo "  ✓ Node.js $("$(node_bin)" --version) ($(node_bin))"
  else
    echo "  No suitable Node.js (22.18 or newer, with npm) found. Downloading the portable version..."
    case "$(uname -m)" in aarch64|arm64) NODE_PLAT="linux-arm64" ;; *) NODE_PLAT="linux-x64" ;; esac
    installiere_node "$NODE_PLAT" || abbruch "Node.js could not be installed."
  fi
  echo "  Building the app ..."
  "$(node_bin)" "$ROOT/scripts/build-frontend.mjs" || abbruch "The app could not be built. Check the internet connection and run the installation again."

  # 5. Modellserver (acestep.cpp) bauen
  schritt "5. Building model server acestep.cpp ($CHOSEN_BACKEND)"
  mkdir -p "$ROOT/engine"
  if [ ! -d "$ENGINE/.git" ]; then
    echo "  Cloning acestep.cpp..."
    git clone --quiet "$ACESTEP_REPO" "$ENGINE" || abbruch "Cloning acestep.cpp failed."
  fi

  ( cd "$ENGINE" \
    && { git cat-file -e "$ACESTEP_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
    && git checkout --quiet "$ACESTEP_REV" \
    && git submodule update --init --recursive --quiet ) || abbruch "Could not switch to version ${ACESTEP_REV:0:7}."

  local BUILD_NEEDED=0
  if [ "$REBUILD" = 1 ]; then
    BUILD_NEEDED=1
  elif [ ! -x "$ENGINE/build/ace-server" ]; then
    BUILD_NEEDED=1
  elif ! "$ENGINE/build/ace-server" --help 2>&1 | head -1 | grep -q "${ACESTEP_REV:0:7}"; then
    BUILD_NEEDED=1
  fi

  if [ "$BUILD_NEEDED" = 1 ]; then
    echo "  Compiling acestep.cpp (backend: $CHOSEN_BACKEND) ..."
    mkdir -p "$DATA"
    local CMAKE_FLAGS=()
    if [ "$CHOSEN_BACKEND" = "rocm" ]; then
      [ -d "/opt/rocm/bin" ] && export PATH="/opt/rocm/bin:$PATH"
      CMAKE_FLAGS=(-DGGML_HIP=ON)
      [ -n "$AMD_GFX" ] && CMAKE_FLAGS+=(-DAMDGPU_TARGETS="$AMD_GFX")
    elif [ "$CHOSEN_BACKEND" = "cuda" ]; then
      [ -d "/opt/cuda/bin" ] && export PATH="/opt/cuda/bin:$PATH"
      CMAKE_FLAGS=(-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=native)
    elif [ "$CHOSEN_BACKEND" = "vulkan" ]; then
      CMAKE_FLAGS=(-DGGML_VULKAN=ON)
    else
      CMAKE_FLAGS=(-DGGML_CPU_ALL_VARIANTS=ON)
    fi

    (
      cd "$ENGINE"
      rm -rf build
      cmake -S . -B build "${CMAKE_FLAGS[@]}"
      cmake --build build --config Release -j "$(nproc)"
    ) > "$DATA/build.log" 2>&1 || {
      if [ "$CHOSEN_BACKEND" != "cpu" ]; then
        echo "  Build with $CHOSEN_BACKEND failed. Details in data/build.log"
        if ja "  Try a fallback build with the CPU backend only?"; then
          CHOSEN_BACKEND="cpu"
          (
            cd "$ENGINE"
            rm -rf build
            cmake -S . -B build -DGGML_CPU_ALL_VARIANTS=ON
            cmake --build build --config Release -j "$(nproc)"
          ) > "$DATA/build.log" 2>&1 || abbruch "The CPU build failed as well. See data/build.log"
        else
          abbruch "Build cancelled."
        fi
      else
        abbruch "Build failed. Details in data/build.log"
      fi
    }
    echo "  ✓ Build finished."
  else
    echo "  ✓ acestep.cpp is already built (${ACESTEP_REV:0:7})."
  fi

  # 6. Modellgröße wählen
  schritt "6. Choosing the model size"
  local EMPF="1.7B"
  if   [ "$RAM_GB" -lt 12 ]; then EMPF="0.6B"
  elif [ "$RAM_GB" -lt 24 ]; then EMPF="1.7B"
  else                            EMPF="4B"
  fi
  if [ "$VRAM_GB" -gt 0 ]; then
    if   [ "$VRAM_GB" -lt 6 ]; then EMPF="0.6B"
    elif [ "$VRAM_GB" -lt 8 ] && [ "$EMPF" = "4B" ]; then EMPF="1.7B"
    fi
  fi

  if [ -z "$LM_SIZE" ]; then
    LM_SIZE="$EMPF"
    if [ "$AUTO" != 1 ]; then
      echo "  Language model (plans structure, tempo, key; bigger = better songs, more RAM):"
      echo "    1) 0.6B – about 0.7 GB (for 8 GB RAM / small GPUs)"
      echo "    2) 1.7B – about 2.0 GB (for 16 GB RAM / 6–8 GB VRAM)"
      echo "    3) 4B   – about 4.5 GB (from 24 GB RAM / from 8 GB VRAM)"
      read -r -p "  Choice [Enter = $EMPF recommended]: " a
      case "$a" in
        1) LM_SIZE="0.6B" ;;
        2) LM_SIZE="1.7B" ;;
        3) LM_SIZE="4B" ;;
      esac
    fi
  fi
  case "$LM_SIZE" in 0.6B|1.7B|4B) ;; *) abbruch "Unknown model size: $LM_SIZE (allowed: 0.6B, 1.7B, 4B)" ;; esac
  LM_FILE="acestep-5Hz-lm-${LM_SIZE}-Q8_0.gguf"
  echo "  → Language model: $LM_SIZE, sound model: SFT (standard, high quality)"

  # XL Modell optional
  XL_FILE="acestep-v15-xl-sft-Q8_0.gguf"
  [ -f "$MODELS/$XL_FILE" ] && XL=1
  if [ "$XL" != 1 ] && [ "$AUTO" != 1 ]; then
    echo ""
    echo "  Sound model XL (optional extra, 5.3 GB): better sound quality according to the developers,"
    echo "  but takes about twice as long and needs more memory. You can pick XL later in the app settings."
    read -r -p "  Download XL as well? [Enter = no, y = yes]: " a
    [[ "$a" =~ ^[jJyY] ]] && XL=1
  fi
  [ "$XL" = 1 ] && echo "  → plus XL sound model"

  # Optional: Spuren-Modell (Base) für einzelne Spuren. Ist es schon da, bleibt es; sonst nur auf Wunsch.
  STEMS_FILE="acestep-v15-base-Q8_0.gguf"
  [ -f "$MODELS/$STEMS_FILE" ] && STEMS=1
  if [ "$STEMS" != 1 ] && [ "$AUTO" != 1 ]; then
    echo ""
    echo "  Track model (optional extra, 2.5 GB): generate a song track by track, extract single tracks"
    echo "  from a song, or replace instruments in your own recording. Without it these features stay greyed out."
    read -r -p "  Download the track model as well? [Enter = no, y = yes]: " a
    [[ "$a" =~ ^[jJyY] ]] && STEMS=1
  fi
  [ "$STEMS" = 1 ] && echo "  → plus track model"
  # Optional: XL-Spuren-Modell. Nur mit --xl-stems; ist es schon da, bleibt es.
  [ -f "$MODELS/acestep-v15-xl-base-Q8_0.gguf" ] && XL_STEMS=1
  [ "$XL_STEMS" = 1 ] && echo "  → plus XL track model"

  # 7. Modelle herunterladen
  schritt "7. Downloading models"
  mkdir -p "$MODELS"
  local FILES
  FILES=$(echo "$MODEL_FILES" | grep -v 'acestep-5Hz-lm-\|xl-sft\|v15-base\|xl-base' ; echo "$MODEL_FILES" | grep "^$LM_FILE:")
  [ "$XL" = 1 ] && FILES=$(echo "$FILES"; echo "$MODEL_FILES" | grep 'xl-sft')
  [ "$STEMS" = 1 ] && FILES=$(echo "$FILES"; echo "$MODEL_FILES" | grep 'v15-base')
  [ "$XL_STEMS" = 1 ] && FILES=$(echo "$FILES"; echo "$MODEL_FILES" | grep 'xl-base')

  local NEED_MB=0
  for e in $FILES; do
    IFS=: read -r f mb _ <<< "$e"
    [ -f "$MODELS/$f" ] || NEED_MB=$(( NEED_MB + mb ))
  done
  local NEED_GB=$(( (NEED_MB + 1023) / 1024 + 3 ))
  echo "  Download: $(( (NEED_MB + 1023) / 1024 )) GB · about $NEED_GB GB free space needed"
  [ "$FREE_GB" -ge "$NEED_GB" ] || abbruch "Not enough disk space: $FREE_GB GB free, $NEED_GB GB needed."

  for e in $FILES; do
    IFS=: read -r f _ sha <<< "$e"
    if [ -f "$MODELS/$f" ]; then
      echo "  ✓ $f present"
      continue
    fi
    echo "  ↓ Downloading $f ..."
    curl -L --fail -C - --progress-bar -o "$MODELS/$f.part" "$HF_BASE/$f" \
      || abbruch "Downloading $f failed. Running the script again resumes the download."
    echo "    Verifying checksum (SHA-256)..."
    local calc_sha
    calc_sha=$(berechne_sha256 "$MODELS/$f.part")
    if [ "$calc_sha" != "$sha" ]; then
      rm -f "$MODELS/$f.part"
      abbruch "Checksum of $f does not match. The file was deleted; please run the script again."
    fi
    mv "$MODELS/$f.part" "$MODELS/$f"
    echo "    ✓ Checksum ok"
  done

  # 8. Selbsttest & Konfiguration speichern
  schritt "8. Graphics self-test and configuration"
  mkdir -p "$DATA"
  local OLD_MODE=""
  local OLD_LM=""
  local OLD_REV=""
  [ -f "$CONF" ] && {
    OLD_MODE=$(sed -n 's/^MODE=//p' "$CONF" || true)
    OLD_LM=$(sed -n 's/^LM_FILE=//p' "$CONF" || true)
    OLD_REV=$(sed -n 's/^TESTED_REV=//p' "$CONF" || true)
  }

  local MODE="single"
  if [ -n "$OLD_MODE" ] && [ "$OLD_LM" = "$LM_FILE" ] && [ "${OLD_REV:0:7}" = "${ACESTEP_REV:0:7}" ]; then
    MODE="$OLD_MODE"
    echo "  Already tested: mode $MODE"
  else
    local TEST_PORT=8099
    if laeuft "$TEST_PORT"; then
      echo "  Test port $TEST_PORT is in use, skipping the trial run. Mode: single."
      MODE="single"
    else
      echo "  Starting the model trial run..."
      local TEST_ARGS=(--host 127.0.0.1 --port "$TEST_PORT" --models "$MODELS" --max-batch 1)
      [ -n "$VAE_CHUNK" ] && TEST_ARGS+=(--vae-chunk "$VAE_CHUNK")
      "$ENGINE/build/ace-server" "${TEST_ARGS[@]}" > "$DATA/selftest.log" 2>&1 &
      local TEST_PID=$!
      for _ in $(seq 1 120); do curl -s "http://127.0.0.1:$TEST_PORT/health" >/dev/null && break; sleep 0.5; done
      if "$(node_bin)" $NODE_FLAGS "$ROOT/backend/src/cli/selftest.ts" "$TEST_PORT" "$LM_FILE" >/dev/null 2>&1; then
        MODE="single"
      else
        MODE="split"
      fi
      kill "$TEST_PID" 2>/dev/null || true
      wait "$TEST_PID" 2>/dev/null || true
      echo "  → Detected mode: $MODE"
    fi
  fi

  cat > "$CONF" <<EOF
MODE=$MODE
LM_FILE=$LM_FILE
TESTED_REV=$ACESTEP_REV
VAE_CHUNK=$VAE_CHUNK
BACKEND=$CHOSEN_BACKEND
EOF
  echo "  ✓ Configuration saved to data/engine.conf."

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Installation on Arch Linux finished!"
  echo "═══════════════════════════════════════════════════════════"
}

# --- Ausführung nach gewählter Aktion ------------------------------------------
case "$ACTION" in
  stop)
    stoppe_server
    ;;
  status)
    zeige_status
    ;;
  uninstall)
    if [ "$AUTO" = 1 ]; then exec bash "$ROOT/scripts/uninstall.sh" --yes; else exec bash "$ROOT/scripts/uninstall.sh"; fi
    ;;
  install_only)
    installiere
    ;;
  start)
    starte_server
    ;;
  run)
    if [ ! -x "$ENGINE/build/ace-server" ] || [ ! -f "$CONF" ] || ! node_bin >/dev/null; then
      installiere
    fi
    starte_server
    ;;
esac
