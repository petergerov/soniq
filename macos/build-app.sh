#!/bin/bash
# Baut SONIQ.app (und mit --dmg zusätzlich SONIQ.dmg) nach dist-mac/. Läuft lokal und in der GitHub Action.
# Braucht: Apple Silicon, Xcode-Kommandozeilenwerkzeuge (swiftc, codesign), git und cmake für den Modellserver.
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
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
schritt() { echo ""; echo "▸ $1"; }

[ "$(uname -m)" = "arm64" ] || { echo "Only Apple Silicon is supported."; exit 1; }
mkdir -p "$CACHE"

schritt "Model server acestep.cpp (${ACESTEP_REV:0:7})"
if ! "$ENGINE/build/ace-server" --help 2>&1 | head -1 | grep -q "${ACESTEP_REV:0:7}"; then
  [ -d "$ENGINE/.git" ] || git clone --quiet "$ACESTEP_REPO" "$ENGINE"
  ( cd "$ENGINE" && { git cat-file -e "$ACESTEP_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
    && git checkout --quiet "$ACESTEP_REV" && git submodule update --init --recursive --quiet && ./buildcpu.sh )
fi
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
swiftc -O -target arm64-apple-macos13 -o "$C/MacOS/SONIQ" macos/SONIQ/main.swift
cp "$CACHE/node-$NODE_VERSION" "$C/MacOS/node"
cp "$ENGINE/build/ace-server" "$C/MacOS/ace-server"
# Bibliotheken des Modellservers nach Frameworks (unter den Namen, die ace-server erwartet)
for lib in $(otool -L "$ENGINE/build/ace-server" | sed -n 's|^[[:space:]]*@rpath/\([^ ]*\).*|\1|p'); do
  cp -L "$ENGINE/build/$lib" "$C/Frameworks/$lib"
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
  <key>LSMinimumSystemVersion</key><string>13.0</string>
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
