# Gemeinsame Einstellungen für Install, Start und Stopp. Wird per "source" eingebunden.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$ROOT/engine/acestep.cpp"
MODELS="$ROOT/models"             # GGUF-Modelle, getrennt vom Modellserver
DATA="$ROOT/data"
CONF="$DATA/engine.conf"          # vom Installer geschrieben: MODE, LM_FILE

PORT=8765         # Web-App
SYNTH_PORT=8085   # ace-server Synthese (Metal)
LM_PORT=8086      # ace-server Sprachmodell (nur im Modus "split", auf CPU)

# Getestete acestep.cpp-Version (voller Commit-Hash); neuere könnten die API ändern.
ACESTEP_REPO="https://github.com/ServeurpersoCom/acestep.cpp"
ACESTEP_REV="b7ba6d9ce2f19ca7627fb8f340032c3ebe8ae253"
# Modelle: feste Revision des Hugging-Face-Repos, Dateien werden nach dem Download per SHA-256 geprüft.
HF_BASE="https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/666ac70204440867d8c01ba4b119cc79c95b370a"
# Datei:Größe in MB:SHA-256. xl-sft ist das optionale XL-Klangmodell (nur auf Wunsch geladen), lm-* wird nach Auswahl geladen,
# v15-base ist das optionale Spuren-Modell (lego/extract/complete für Einzelspuren, siehe newfeatures.md),
# xl-base das optionale XL-Spuren-Modell (4 Mrd. Parameter, in den Einstellungen wählbar).
MODEL_FILES="vae-BF16.gguf:340:0599862ac5d15cd308e1d2e368373aea6c02e25ebd1737ad4a4562a0901b0ef8
Qwen3-Embedding-0.6B-Q8_0.gguf:780:972f23255e46adfe744a0eb9a0039f3c63988f65753b0968d776e8b27168c321
acestep-v15-sft-Q8_0.gguf:2550:17f1984e48aaab27b3eb8ccbf0b754a6656e677884c60ea7003845cfc0059b70
acestep-v15-xl-sft-Q8_0.gguf:5060:d7b06fadab214375ef5ebcfa44bf4a10489ea364b119f5b9ecbcd870408bdab9
acestep-v15-base-Q8_0.gguf:2550:10329f321010cedc3571c24b6371d002ce49238f48be47def4a1c76bf27ee150
acestep-v15-xl-base-Q8_0.gguf:5306:45d05b88ccbfa0ea27208ea618d7f0749b2be040b457cfa661d37646ea39f207
acestep-5Hz-lm-0.6B-Q8_0.gguf:710:bdaf9e292d4470f31c19cafeaca1b74936a114667e3a85e5d33b65247e9908ec
acestep-5Hz-lm-1.7B-Q8_0.gguf:1980:726f99a82f050b32ebc5c5e36acaa9d7acd06bfe5e579a62b00e0d0d6d0b7ec6
acestep-5Hz-lm-4B-Q8_0.gguf:4460:972f91147a167f0c041f1b158d67985a82c0f6a852e68cdf70e46030cf08b1bc"

# Node.js-Laufzeit der Web-App (portabel in runtime/node, vom Installer geladen und per SHA-256 geprüft).
# Datei:SHA-256 je Plattform. Das Backend läuft ohne Build direkt aus backend/src (TypeScript).
NODE_VERSION="24.21.0"
NODE_DIR="$ROOT/runtime/node"
NODE_FILES="node-v24.21.0-darwin-arm64.tar.gz:bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057
node-v24.21.0-darwin-x64.tar.gz:1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097
node-v24.21.0-linux-x64.tar.xz:fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
node-v24.21.0-linux-arm64.tar.xz:6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2"
# cmake zum Bauen des Modellservers auf dem Mac (nur geladen, wenn keins installiert ist)
CMAKE_MAC="https://github.com/Kitware/CMake/releases/download/v3.31.9/cmake-3.31.9-macos-universal.tar.gz:eb9d0b2b6a5b900e2f5811326a86ea393a146e4cb2384d15512c226e9c98f8bf"
SERVER_ENTRY="$ROOT/backend/src/main.ts"
NODE_FLAGS="--disable-warning=ExperimentalWarning"

# Ältere Installationen hatten die Modelle in engine/acestep.cpp/models: einmalig umziehen statt neu laden.
if [ -d "$ENGINE/models" ] && ls "$ENGINE/models"/*.gguf >/dev/null 2>&1; then
  mkdir -p "$MODELS"
  for f in "$ENGINE/models"/*.gguf; do [ -e "$MODELS/${f##*/}" ] || mv "$f" "$MODELS/"; done
fi

export PATH="$ROOT/runtime/cmake/CMake.app/Contents/bin:$HOME/.local/bin:/opt/rocm/bin:/opt/cuda/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -d "/opt/rocm/lib" ] && export LD_LIBRARY_PATH="/opt/rocm/lib:${LD_LIBRARY_PATH:-}"

laeuft() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$1" -sTCP:LISTEN -t >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -tlpn "sport = :$1" 2>/dev/null | grep -q LISTEN
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$1"/tcp >/dev/null 2>&1
  else
    return 1
  fi
}

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$1" -sTCP:LISTEN -t 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$1"/tcp 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    (ss -tlpn "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+') || true
  fi
}

# MODE=split  -> Sprachmodell auf CPU (Port 8086), Synthese auf Metal/Vulkan/CUDA (Port 8085)
# MODE=single -> alles auf einem Server (Port 8085)
lade_conf() {   # engine.conf als key=value lesen, nicht ausführen
  MODE=split
  LM_FILE=""
  VAE_CHUNK=""
  KEEP_LOADED=""
  [ -f "$CONF" ] || return 0
  MODE=$(sed -n 's/^MODE=//p' "$CONF" | tail -1)
  LM_FILE=$(sed -n 's/^LM_FILE=//p' "$CONF" | tail -1)
  VAE_CHUNK=$(sed -n 's/^VAE_CHUNK=//p' "$CONF" | tail -1)
  KEEP_LOADED=$(sed -n 's/^KEEP_LOADED=//p' "$CONF" | tail -1)
  [ -n "$MODE" ] || MODE=split
}

# CMake speichert den absoluten Build-Ordner als Suchpfad. Nach einem Umbenennen des
# Projektordners findet macOS die ggml-Bibliotheken nicht mehr, obwohl sie neben der
# Binary liegen. @loader_path sucht dort, unabhängig vom Ordnernamen.
engine_rpath() {
  [ "$(uname)" = "Darwin" ] || return 0
  command -v install_name_tool >/dev/null 2>&1 || return 0
  local dir="$ENGINE/build" f
  [ -d "$dir" ] || return 0
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    file "$f" 2>/dev/null | grep -q "Mach-O" || continue
    otool -L "$f" 2>/dev/null | grep -q "@rpath/" || continue
    otool -l "$f" 2>/dev/null | grep -q "@loader_path" && continue
    install_name_tool -add_rpath "@loader_path" "$f" || continue
    codesign --force --sign - "$f" >/dev/null 2>&1 || true
  done
}

# Terminal-Fenster nach getaner Arbeit selbst schließen (macOS).
fenster_schliessen() {
  [ "$(uname)" = "Darwin" ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  local tty_now
  tty_now=$(tty 2>/dev/null) || return 0
  (sleep 1; osascript -e "tell application \"Terminal\" to close (first window whose tty is \"$tty_now\")" >/dev/null 2>&1) &
  disown
}

# Node für die Web-App: portable Laufzeit, sonst eine installierte (ab 22.18, wegen TypeScript ohne Build).
node_bin() {
  if [ -x "$NODE_DIR/bin/node" ]; then echo "$NODE_DIR/bin/node"; return 0; fi
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null || return 1
  command -v node
}

# Lädt die portable Node-Laufzeit nach runtime/node (überspringt, wenn sie schon in der richtigen Version da ist).
# $1 = Plattform-Kürzel wie darwin-arm64 oder linux-x64. Gibt 1 zurück, wenn es nicht klappt.
installiere_node() {
  local plat="$1" entry file sha tmp got
  if [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
    echo "  present (v$NODE_VERSION)"; return 0
  fi
  entry=$(echo "$NODE_FILES" | grep "^node-v$NODE_VERSION-$plat\.") || { echo "  No Node.js build for $plat."; return 1; }
  file=${entry%%:*}; sha=${entry##*:}
  tmp="$ROOT/runtime/$file"
  mkdir -p "$ROOT/runtime"
  curl -L --fail -C - --progress-bar -o "$tmp.part" "https://nodejs.org/dist/v$NODE_VERSION/$file" || return 1
  got=$( (shasum -a 256 "$tmp.part" 2>/dev/null || sha256sum "$tmp.part") | cut -d' ' -f1)
  if [ "$got" != "$sha" ]; then
    rm -f "$tmp.part"; echo "  Checksum of $file does not match."; return 1
  fi
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xf "$tmp.part" -C "$NODE_DIR" --strip-components 1 || return 1
  rm -f "$tmp.part"
  echo "  installed (v$NODE_VERSION)"
}

