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
# Stem Separation mit Demucs: demucs.cpp (MIT, feste Revision) und die ggml-Gewichte von htdemucs_ft (4 Spuren, beste
# Qualität) und htdemucs_6s (mit Gitarre und Klavier), im Modellordner unter demucs/. Datei:Größe in MB:SHA-256.
DEMUCS_REPO="https://github.com/sevagh/demucs.cpp"
DEMUCS_REV="f1206e9adeea103aef4a636b9e62297cf1f8e34e"
DEMUCS_DIR="$ROOT/engine/demucs.cpp"
DEMUCS_HF="https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/8f58ac0491bbea657275bcd3e38af1ab3a27bfc9"
DEMUCS_FILES="ggml-model-htdemucs-6s-f16.bin:55:09704f4ceae204e56e77d5eefd6ac71d7275be81fd507e6913371d59abcee856
ggml-model-htdemucs_ft_drums-4s-f16.bin:84:cda268755cc80deb5f4616a99f9d09f26bc5ce3882aa35e0bc504708a12604bb
ggml-model-htdemucs_ft_bass-4s-f16.bin:84:e6ded215aa15fb4eff7a37f3a51fd596ee17c94ae0ddb7ef3f2f6ecf8b86cdb5
ggml-model-htdemucs_ft_other-4s-f16.bin:84:cbc315571584d512e7853c9d40a499182393a7f4155cb8723a9040a685c2435b
ggml-model-htdemucs_ft_vocals-4s-f16.bin:84:19186500a45a551a034d96e9500415ebe73c8bd570bf55337ddc8cc8f53a9120"
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

# demucs.cpp auf DEMUCS_REV bringen (Klon, Checkout, Submodule).
demucs_checkout() {
  if [ ! -d "$DEMUCS_DIR/.git" ]; then
    mkdir -p "$(dirname "$DEMUCS_DIR")" && git clone --quiet "$DEMUCS_REPO" "$DEMUCS_DIR" || return 1
  fi
  ( cd "$DEMUCS_DIR" \
    && { git cat-file -e "$DEMUCS_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
    && git checkout --quiet "$DEMUCS_REV" \
    && git submodule update --init --recursive --quiet )
}

# Die beiden Programme bauen (ein Modell / htdemucs_ft), sofern nötig, für diesen Rechner (-march=native).
# Weitere cmake-Optionen als Argumente (Linux: -DUSE_OPENBLAS=OFF, dann OpenMP). Ausgabe nach stdout/stderr.
demucs_build() {
  demucs_checkout || return 1
  demucs_compile "$DEMUCS_DIR/build" Release "" "$@"
}

# Release-Flags von demucs.cpp ohne -march=native. Das CMakeLists setzt sie fest, darum ein eigener Build-Typ.
DEMUCS_FAST="-Ofast -fno-unsafe-math-optimizations -freciprocal-math -fno-signed-zeros -DNDEBUG"

# Portabel für die fertigen Pakete: <Build-Ordner> <CPU-Flags, z. B. -mcpu=apple-m1> [cmake-Optionen].
# Mit Accelerate bzw. OpenBLAS gehört -DEIGEN_USE_BLAS in die Flags (das CMakeLists setzt es nur für Release).
demucs_build_portable() {
  local B="$1" flags="$2"
  shift 2
  demucs_checkout || return 1
  demucs_compile "$B" Portable "portable $flags" -DCMAKE_CXX_FLAGS_PORTABLE="$DEMUCS_FAST $flags" "$@"
}

# <Build-Ordner> <Build-Typ> <Kennung zusätzlich zur Revision> [cmake-Optionen]; baut nur, wenn sich etwas geändert hat
demucs_compile() {
  local B="$1" type="$2" stamp="$DEMUCS_REV${3:+ $3}"
  shift 3
  if [ "$(cat "$B/.soniq-rev" 2>/dev/null)" = "$stamp" ] && [ -x "$B/demucs_mt.cpp.main" ] && [ -x "$B/demucs_ft_mt.cpp.main" ]; then
    return 0
  fi
  rm -rf "$B"
  cmake -S "$DEMUCS_DIR" -B "$B" -DCMAKE_BUILD_TYPE="$type" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 "$@" \
    && cmake --build "$B" --target demucs_mt.cpp.main demucs_ft_mt.cpp.main -j "$(getconf _NPROCESSORS_ONLN)" \
    && echo "$stamp" > "$B/.soniq-rev"
}

# Gewichte von Demucs nach $MODELS/demucs laden und per SHA-256 prüfen (vorhandene bleiben). Rückgabe 1 bei Fehler.
demucs_models() {
  local dir="$MODELS/demucs" e f sha
  mkdir -p "$dir"
  for e in $DEMUCS_FILES; do
    IFS=: read -r f _ sha <<< "$e"
    if [ -f "$dir/$f" ]; then echo "  ✓ $f"; continue; fi
    echo "  ↓ $f"
    curl -L --fail -C - --progress-bar -o "$dir/$f.part" "$DEMUCS_HF/$f" || return 1
    if [ "$(sha256_of "$dir/$f.part")" != "$sha" ]; then
      rm -f "$dir/$f.part"
      echo "  Checksum of $f does not match, file deleted."
      return 1
    fi
    mv "$dir/$f.part" "$dir/$f"
  done
}

# Demucs als Core ML (nur macOS, macos/demucs-coreml.swift), auf GPU oder CPU weit schneller als demucs.cpp:
# htdemucs (4 Spuren, STFT im Programm) und htdemucs_6s (STFT im Modell). Gezippte .mlpackage, entpackt nach
# $MODELS/demucs/. Datei:Größe in MB:SHA-256.
DEMUCS_COREML_BASE="https://github.com/petergerov/gig-songbook/releases/download/1.0.0"
DEMUCS_COREML_FILES="demucs_f32.mlpackage.zip:76:fceed0d92722b644ab3c7d3bad10ee387b6751b9b173d67e5b4012fc9b0800a4
demucs_6s_f32.mlpackage.zip:240:3b3f70f8c73d4c0d66000358d8e516d235a8a79887fcb776c68a5b016a5ef7e3"

# Programm für Demucs als Core ML nach <Ordner>/soniq-demucs bauen, sofern die Quelle neuer ist. [swiftc-Optionen]
demucs_coreml_build() {
  local out="$1/soniq-demucs" src="$ROOT/macos/demucs-coreml.swift"
  shift
  [ -x "$out" ] && [ "$out" -nt "$src" ] && return 0
  mkdir -p "$(dirname "$out")" && swiftc -O "$@" -o "$out" "$src"
}

# Core-ML-Modelle laden, per SHA-256 prüfen und nach $MODELS/demucs entpacken (vorhandene bleiben). Rückgabe 1 bei Fehler.
demucs_coreml_models() {
  local dir="$MODELS/demucs" e f sha
  mkdir -p "$dir"
  for e in $DEMUCS_COREML_FILES; do
    IFS=: read -r f _ sha <<< "$e"
    if [ -f "$dir/${f%.zip}/Manifest.json" ]; then echo "  ✓ ${f%.zip}"; continue; fi
    echo "  ↓ $f"
    curl -L --fail -C - --progress-bar -o "$dir/$f.part" "$DEMUCS_COREML_BASE/$f" || return 1
    if [ "$(sha256_of "$dir/$f.part")" != "$sha" ]; then
      rm -f "$dir/$f.part"
      echo "  Checksum of $f does not match, file deleted."
      return 1
    fi
    rm -rf "$dir/${f%.zip}" && ditto -x -k "$dir/$f.part" "$dir" && rm -rf "$dir/__MACOSX" "$dir/$f.part" || return 1
  done
}

# SHA-256 einer Datei (macOS: shasum, Linux: sha256sum)
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
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

