#!/bin/bash
# SONIQ – Installer für macOS.
# Prüft den Mac, installiert was fehlt, lädt das passende Modell und startet die App.
# Kann jederzeit erneut gestartet werden (z. B. nach "git pull"): Erledigtes wird übersprungen.
#
# Optionen:  --yes        keine Rückfragen, Empfehlung übernehmen
#            --lm SIZE    Sprachmodell erzwingen: 0.6B, 1.7B oder 4B
#            --xl         zusätzlich das XL-Klangmodell laden (5,3 GB, in den Einstellungen wählbar)
#            --no-start   App am Ende nicht starten
source "$(dirname "$0")/scripts/common.sh"
cd "$ROOT" || exit 1

AUTO=0; START=1; LM_SIZE=""; XL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) AUTO=1 ;;
    --no-start) START=0 ;;
    --xl) XL=1 ;;
    --lm) LM_SIZE="$2"; shift ;;
  esac
  shift
done

abbruch() {
  echo ""; echo "✗ $1"
  [ "$AUTO" = 1 ] || read -n 1 -s -r -p "Press any key to close..."
  exit 1
}
schritt() { echo ""; echo "▸ $1"; }
ja() {   # Rückfrage mit Enter = ja
  [ "$AUTO" = 1 ] && return 0
  local a; read -r -p "$1 [Enter = yes, n = no] " a
  [ -z "$a" ] || [[ "$a" =~ ^[jJyY] ]]
}

mkdir -p "$DATA"
echo "═══════════════════════════════════════════"
echo "  SONIQ · Installation"
echo "═══════════════════════════════════════════"

# --- 1. Mac prüfen ------------------------------------------------------------
schritt "Checking Mac"
ARCH=$(uname -m)
CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
FREE_GB=$(df -g "$ROOT" | awk 'NR==2 {print $4}')
echo "  Chip:        $CHIP ($ARCH)"
echo "  Memory:      $RAM_GB GB"
echo "  macOS:       $(sw_vers -productVersion)"
echo "  Free disk space: $FREE_GB GB"

if [ "$ARCH" != "arm64" ]; then
  echo ""
  echo "  Note: Intel Mac. Only Apple Silicon (M1 or newer) has been tested; it may be very slow."
  ja "  Continue anyway?" || abbruch "Cancelled."
fi

# --- 2. Modellgröße wählen ------------------------------------------------------
if   [ "$RAM_GB" -lt 12 ]; then EMPF="0.6B"
elif [ "$RAM_GB" -lt 24 ]; then EMPF="1.7B"
else                            EMPF="4B"
fi
if [ -z "$LM_SIZE" ]; then
  LM_SIZE="$EMPF"
  if [ "$AUTO" != 1 ]; then
    echo ""
    echo "  Language model (plans structure, tempo, key; bigger = better songs, more memory):"
    echo "    1) 0.6B  – 0.7 GB, for 8 GB RAM"
    echo "    2) 1.7B  – 2.0 GB, for 16 GB"
    echo "    3) 4B    – 4.5 GB, from 24 GB"
    read -r -p "  Choice [Enter = $EMPF recommended] " a
    case "$a" in 1) LM_SIZE="0.6B" ;; 2) LM_SIZE="1.7B" ;; 3) LM_SIZE="4B" ;; esac
  fi
fi
case "$LM_SIZE" in 0.6B|1.7B|4B) ;; *) abbruch "Unknown model size: $LM_SIZE (allowed: 0.6B, 1.7B, 4B)" ;; esac
LM_FILE="acestep-5Hz-lm-${LM_SIZE}-Q8_0.gguf"
echo "  → Language model $LM_SIZE, sound model SFT (high quality)"

# Optional: XL-Klangmodell (4 statt 2 Mrd. Parameter). Ist es schon da, bleibt es; sonst nur auf Wunsch.
XL_FILE=$(echo "$MODEL_FILES" | grep 'xl-sft' | cut -d: -f1)
[ -f "$MODELS/$XL_FILE" ] && XL=1
if [ "$XL" != 1 ] && [ "$AUTO" != 1 ]; then
  echo ""
  echo "  Sound model XL (optional extra, 5.3 GB): better sound quality according to the developers,"
  echo "  but takes about twice as long and needs more memory. The smaller model stays the default;"
  echo "  you can pick XL afterwards in the app settings."
  [ "$RAM_GB" -lt 16 ] && echo "  Not recommended with $RAM_GB GB RAM."
  read -r -p "  Download XL as well? [Enter = no, y = yes] " a
  [[ "$a" =~ ^[yY] ]] && XL=1
fi
[ "$XL" = 1 ] && echo "  → plus XL sound model"

# Benötigte Dateien (Name:MB:SHA-256 aus common.sh): die drei festen, das gewählte Sprachmodell, auf Wunsch XL
FILES=$(echo "$MODEL_FILES" | grep -v 'acestep-5Hz-lm-\|xl-sft\|v15-base' ; echo "$MODEL_FILES" | grep "^$LM_FILE:")
[ "$XL" = 1 ] && FILES=$(echo "$FILES"; echo "$MODEL_FILES" | grep 'xl-sft')
NEED_MB=0
for e in $FILES; do
  IFS=: read -r f mb _ <<< "$e"
  [ -f "$MODELS/$f" ] || NEED_MB=$(( NEED_MB + mb ))
done
NEED_GB=$(( (NEED_MB + 1023) / 1024 + 3 ))   # + Build, Node.js und etwas Platz für Songs
echo "  Download: $(( (NEED_MB + 1023) / 1024 )) GB · about $NEED_GB GB free space needed in total"
[ "$FREE_GB" -ge "$NEED_GB" ] || abbruch "Not enough disk space: $FREE_GB GB free, about $NEED_GB GB needed."
ja "  Start installation?" || abbruch "Cancelled."

# --- 3. Werkzeuge -------------------------------------------------------------
schritt "Apple developer tools (compiler, git)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1
  abbruch "An Apple window opens to install the developer tools. Please confirm there, then run 'install' again."
fi
echo "  present"

schritt "Node.js (runs the web app)"
case "$ARCH" in arm64) NODE_PLAT="darwin-arm64" ;; *) NODE_PLAT="darwin-x64" ;; esac
installiere_node "$NODE_PLAT" || abbruch "Node.js could not be installed. Running install again resumes the download."

schritt "Building the app"
"$(node_bin)" "$ROOT/scripts/build-frontend.mjs" || abbruch "The app could not be built. Check the internet connection and run install again."

schritt "cmake (to build the model server)"
if ! command -v cmake >/dev/null 2>&1; then
  CMAKE_URL=${CMAKE_MAC%:*}; CMAKE_SHA=${CMAKE_MAC##*:}
  mkdir -p "$ROOT/runtime"
  curl -L --fail --progress-bar -o "$ROOT/runtime/cmake.tar.gz" "$CMAKE_URL" || abbruch "cmake could not be downloaded."
  [ "$(shasum -a 256 "$ROOT/runtime/cmake.tar.gz" | cut -d' ' -f1)" = "$CMAKE_SHA" ] \
    || { rm -f "$ROOT/runtime/cmake.tar.gz"; abbruch "Checksum of cmake does not match."; }
  rm -rf "$ROOT/runtime/cmake" && mkdir -p "$ROOT/runtime/cmake"
  tar -xzf "$ROOT/runtime/cmake.tar.gz" -C "$ROOT/runtime/cmake" --strip-components 1 || abbruch "cmake could not be unpacked."
  rm -f "$ROOT/runtime/cmake.tar.gz"
fi
cmake --version | head -1

# --- 4. Modellserver (acestep.cpp) ---------------------------------------------
schritt "Model server acestep.cpp (${ACESTEP_REV:0:7})"
if [ ! -d "$ENGINE/.git" ]; then
  mkdir -p "$ROOT/engine"
  git clone --quiet "$ACESTEP_REPO" "$ENGINE" || abbruch "Downloading acestep.cpp failed."
fi
( cd "$ENGINE" \
  && { git cat-file -e "$ACESTEP_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
  && git checkout --quiet "$ACESTEP_REV" \
  && git submodule update --init --recursive --quiet ) || abbruch "Could not switch acestep.cpp to version ${ACESTEP_REV:0:7}."

if "$ENGINE/build/ace-server" --help 2>&1 | head -1 | grep -q "${ACESTEP_REV:0:7}"; then   # --help zeigt den kurzen Hash
  echo "  already built"
else
  echo "  building (takes a few minutes) …"
  ( cd "$ENGINE" && ./buildcpu.sh ) > "$DATA/build.log" 2>&1 || abbruch "Build failed, details in data/build.log"
  echo "  done"
fi

# --- 5. Modelle -----------------------------------------------------------------
schritt "Downloading models"
mkdir -p "$MODELS"
NEW_MODELS=0
for e in $FILES; do
  IFS=: read -r f _ sha <<< "$e"
  if [ -f "$MODELS/$f" ]; then echo "  ✓ $f"; continue; fi
  echo "  ↓ $f"
  curl -L --fail -C - --progress-bar -o "$MODELS/$f.part" "$HF_BASE/$f" \
    || abbruch "Downloading $f failed. Running install again resumes the download."
  echo "    verifying checksum …"
  if [ "$(shasum -a 256 "$MODELS/$f.part" | cut -d' ' -f1)" != "$sha" ]; then
    rm -f "$MODELS/$f.part"
    abbruch "Checksum of $f does not match. The file was deleted; running install again downloads it anew."
  fi
  mv "$MODELS/$f.part" "$MODELS/$f"
  NEW_MODELS=1
done
# Der Modellserver liest die Modellliste nur beim Start: nach neuen Modellen laufende Server beenden, ON startet sie neu.
if [ "$NEW_MODELS" = 1 ]; then
  for p in "$SYNTH_PORT" "$LM_PORT"; do laeuft "$p" && kill $(lsof -i :"$p" -sTCP:LISTEN -t) 2>/dev/null; done
  sleep 1
fi

# --- 6. Grafikchip testen ------------------------------------------------------
# Auf manchen Chips (z. B. M4) rechnet das Sprachmodell unter Metal falsch.
# Dann läuft es auf der CPU (Modus "split"), sonst reicht ein Server (Modus "single").
schritt "Testing graphics chip"
OLD_MODE=""; OLD_LM=""; OLD_REV=""
[ -f "$CONF" ] && { OLD_MODE=$(sed -n 's/^MODE=//p' "$CONF"); OLD_LM=$(sed -n 's/^LM_FILE=//p' "$CONF"); OLD_REV=$(sed -n 's/^TESTED_REV=//p' "$CONF"); }
if [ -n "$OLD_MODE" ] && [ "$OLD_LM" = "$LM_FILE" ] && [ "${OLD_REV:0:7}" = "${ACESTEP_REV:0:7}" ]; then   # alte Installationen haben den kurzen Hash
  MODE="$OLD_MODE"
  echo "  already tested: mode $MODE"
else
  TEST_PORT=8099
  laeuft "$TEST_PORT" && abbruch "Port $TEST_PORT is in use, please try again later."
  "$ENGINE/build/ace-server" --host 127.0.0.1 --port "$TEST_PORT" --models "$MODELS" --max-batch 1 \
    > "$DATA/selftest.log" 2>&1 &
  TEST_PID=$!
  for _ in $(seq 1 120); do curl -s "http://127.0.0.1:$TEST_PORT/health" >/dev/null && break; sleep 0.5; done
  echo "  Trial run of the language model on Metal (can take 1–2 minutes) …"
  if "$(node_bin)" $NODE_FLAGS "$ROOT/backend/src/cli/selftest.ts" "$TEST_PORT" "$LM_FILE"; then MODE=single; else MODE=split; fi
  kill "$TEST_PID" 2>/dev/null; wait "$TEST_PID" 2>/dev/null
  echo "  → mode $MODE"
fi
cat > "$CONF" <<EOF
MODE=$MODE
LM_FILE=$LM_FILE
TESTED_REV=$ACESTEP_REV
EOF

# --- 7. Start-/Stopp-Symbole ----------------------------------------------------
schritt "Setting up start and stop icons"
bash "$ROOT/scripts/symbole.sh"
echo "  ok"

# --- Fertig ---------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════"
echo "  Done. Start with 'start',"
echo "  stop with 'stop'."
echo "═══════════════════════════════════════════"
if [ "$START" = 1 ]; then
  exec "$ROOT/start.command"
fi
