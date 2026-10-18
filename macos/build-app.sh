#!/bin/bash
# Baut SONIQ.app (und mit --dmg zusätzlich SONIQ.dmg) nach dist-mac/. Läuft lokal und in der GitHub Action.
# Braucht: Apple Silicon, Xcode-Kommandozeilenwerkzeuge (swiftc, codesign), git und cmake für Modellserver und Demucs.
# VERSION=1.2.3 setzt die Versionsnummer (sonst aus package.json).
#
#   macos/build-app.sh [--dmg]
#
# Signieren: ohne SIGN_IDENTITY ad hoc (läuft auf diesem Mac, auf anderen nur über "Trotzdem öffnen");
# mit SIGN_IDENTITY="Developer ID Application: …" für die Weitergabe (Notarisieren macht macos/notarize.sh).
set -euo pipefail
source "$(dirname "$0")/../scripts/common.sh"
cd "$ROOT"

OUT="$ROOT/dist-mac"
APP="$OUT/SONIQ.app"
C="$APP/Contents"
CACHE="$OUT/cache"
VERSION="${VERSION:-$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)}"   # VERSION: z. B. aus dem Release-Tag
MIN_MACOS="13.5"   # Node.js 24 braucht macOS 13.5
EB="$ENGINE/build-app"   # eigener Build des Modellservers, getrennt vom normalen build/ der Installation
DB="$DEMUCS_DIR/build-app"   # ebenso für demucs.cpp (Stem Separation)
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
schritt() { echo ""; echo "▸ $1"; }

[ "$(uname -m)" = "arm64" ] || { echo "Only Apple Silicon is supported."; exit 1; }
mkdir -p "$CACHE"

schritt "Model server acestep.cpp (${ACESTEP_REV:0:7}, portable build)"
# Ohne -mcpu=native (GGML_NATIVE=OFF): soll auf jedem Apple-Silicon-Mac laufen, nicht nur auf dem Build-Rechner
if ! "$EB/ace-server" --help 2>&1 | head -1 | grep -q "${ACESTEP_REV:0:7}"; then
  [ -d "$ENGINE/.git" ] || git clone --quiet "$ACESTEP_REPO" "$ENGINE"
  ( cd "$ENGINE" && { git cat-file -e "$ACESTEP_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
    && git checkout --quiet "$ACESTEP_REV" && git submodule update --init --recursive --quiet )
  # acestep.cpp liest Kommazahlen mit std::from_chars, das Apple erst ab macOS 26 mitliefert. Für ältere macOS
  # den eingebauten Ersatz-Parser erzwingen; nur für diesen Build, die Datei wird danach zurückgesetzt.
  OPS="src/pipeline-synth-ops.cpp"
  trap 'git -C "$ENGINE" checkout --quiet -- "$OPS"' EXIT
  sed -i '' 's/^#if defined(_LIBCPP_VERSION) \&\& _LIBCPP_VERSION < 200000$/#if defined(__APPLE__) || (defined(_LIBCPP_VERSION) \&\& _LIBCPP_VERSION < 200000)/' "$ENGINE/$OPS"
  grep -q "defined(__APPLE__) ||" "$ENGINE/$OPS" || { echo "acestep.cpp changed: the from_chars patch for macOS < 26 no longer applies."; exit 1; }
  rm -rf "$EB"
  cmake -S "$ENGINE" -B "$EB" -DCMAKE_BUILD_TYPE=Release -DGGML_BLAS=ON -DGGML_NATIVE=OFF \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS" > "$OUT/engine-build.log"
  cmake --build "$EB" --config Release -j "$(sysctl -n hw.ncpu)" >> "$OUT/engine-build.log" 2>&1 \
    || { tail -30 "$OUT/engine-build.log"; exit 1; }
  git -C "$ENGINE" checkout --quiet -- "$OPS"
  trap - EXIT
fi
echo "  ok"

schritt "Stem separation demucs.cpp (${DEMUCS_REV:0:7}, portable build)"
# -mcpu=apple-m1 statt -march=native: läuft auf jedem Apple-Silicon-Mac; rechnet mit Accelerate (BLAS)
demucs_build_portable "$DB" "-mcpu=apple-m1 -DEIGEN_USE_BLAS" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS" \
  > "$OUT/demucs-build.log" 2>&1 || { tail -30 "$OUT/demucs-build.log"; exit 1; }
echo "  ok"

schritt "Node.js $NODE_VERSION"
entry=$(echo "$NODE_FILES" | grep "^node-v$NODE_VERSION-darwin-arm64\.")
file=${entry%%:*}; sha=${entry##*:}
if [ ! -x "$CACHE/node-$NODE_VERSION" ]; then
  curl -L --fail -sS -o "$CACHE/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  [ "$(shasum -a 256 "$CACHE/$file" | cut -d' ' -f1)" = "$sha" ] || { rm -f "$CACHE/$file"; echo "Checksum of $file does not match."; exit 1; }
  tar -xzf "$CACHE/$file" -C "$CACHE" --strip-components 2 "node-v$NODE_VERSION-darwin-arm64/bin/node"
  mv "$CACHE/node" "$CACHE/node-$NODE_VERSION"
  rm -f "$CACHE/$file"
fi
echo "  ok"

schritt "Interface"
"$CACHE/node-$NODE_VERSION" scripts/build-frontend.mjs

schritt "Assembling SONIQ.app $VERSION"
rm -rf "$APP"
mkdir -p "$C/MacOS" "$C/Frameworks" "$C/Resources/app/scripts" "$C/Resources/app/frontend" "$C/Resources/app/backend"
swiftc -O -target "arm64-apple-macos$MIN_MACOS" -o "$C/MacOS/SONIQ" macos/SONIQ/main.swift
cp "$CACHE/node-$NODE_VERSION" "$C/MacOS/node"
cp "$EB/ace-server" "$C/MacOS/ace-server"
# Demucs: braucht nur Systembibliotheken (Accelerate, libc++); die Gewichte lädt die App bei Bedarf nach
cp "$DB/demucs_mt.cpp.main" "$DB/demucs_ft_mt.cpp.main" "$C/MacOS/"
# Bibliotheken des Modellservers nach Frameworks (unter den Namen, die ace-server erwartet)
for lib in $(otool -L "$EB/ace-server" | sed -n 's|^[[:space:]]*@rpath/\([^ ]*\).*|\1|p'); do
  cp -L "$EB/$lib" "$C/Frameworks/$lib"
done
# Suchpfade aus dem Build (absolute Pfade dieses Rechners) durch Frameworks ersetzen
for rp in $(otool -l "$C/MacOS/ace-server" | awk '/LC_RPATH/ {getline; getline; print $2}'); do
  install_name_tool -delete_rpath "$rp" "$C/MacOS/ace-server"
done
install_name_tool -add_rpath "@executable_path/../Frameworks" "$C/MacOS/ace-server"
# Web-App: nur was zur Laufzeit gebraucht wird
cp -R backend/src backend/package.json "$C/Resources/app/backend/"
cp -R shared package.json "$C/Resources/app/"
cp scripts/common.sh "$C/Resources/app/scripts/"
cp -R frontend/dist "$C/Resources/app/frontend/"
# Symbol aus assets/icon-on.png
ICONSET="$OUT/SONIQ.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon-on.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) assets/icon-on.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$C/Resources/SONIQ.icns"
rm -rf "$ICONSET"
cat > "$C/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SONIQ</string>
  <key>CFBundleDisplayName</key><string>SONIQ</string>
  <key>CFBundleIdentifier</key><string>com.petergerov.soniq</string>
  <key>CFBundleExecutable</key><string>SONIQ</string>
  <key>CFBundleIconFile</key><string>SONIQ</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>NSHumanReadableCopyright</key><string>SONIQ · ACE-Step 1.5 via acestep.cpp</string>
</dict></plist>
EOF

schritt "Signing ($([ "$SIGN_IDENTITY" = "-" ] && echo "ad hoc" || echo "$SIGN_IDENTITY"))"
# Von innen nach außen. Mit Developer ID: Hardened Runtime (Pflicht fürs Notarisieren), Node braucht dafür JIT-Rechte.
# Ad hoc ohne Hardened Runtime: deren Bibliotheksprüfung verlangt dieselbe Team-ID, die ad hoc fehlt.
sign() { codesign --force --timestamp=none --sign "$SIGN_IDENTITY" "$@"; }
[ "$SIGN_IDENTITY" != "-" ] && sign() { codesign --force --timestamp --options runtime --sign "$SIGN_IDENTITY" "$@"; }
for lib in "$C/Frameworks/"*.dylib; do sign "$lib"; done
sign "$C/MacOS/ace-server"
sign "$C/MacOS/demucs_mt.cpp.main"
sign "$C/MacOS/demucs_ft_mt.cpp.main"
sign --entitlements macos/node.entitlements "$C/MacOS/node"
sign "$APP"
codesign --verify --deep --strict "$APP" && echo "  ok"

if [ "${1:-}" = "--dmg" ]; then
  schritt "SONIQ.dmg"
  STAGE="$OUT/dmg"
  rm -rf "$STAGE" "$OUT/SONIQ.dmg" && mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -quiet -volname "SONIQ" -srcfolder "$STAGE" -format UDZO -fs HFS+ "$OUT/SONIQ.dmg"
  rm -rf "$STAGE"
  [ "$SIGN_IDENTITY" != "-" ] && codesign --force --timestamp --sign "$SIGN_IDENTITY" "$OUT/SONIQ.dmg"
  echo "  $OUT/SONIQ.dmg ($(du -h "$OUT/SONIQ.dmg" | cut -f1))"
fi

echo ""
echo "Done: $APP ($(du -sh "$APP" | cut -f1))"
