#!/bin/bash
# Builds a Debian/Ubuntu server package: soniq_<version>_<amd64|arm64>.deb → dist-linux/
# Bundles portable Node.js, a Vulkan ace-server (GGML_NATIVE=OFF), the web UI, and a systemd unit.
# Models are not included — first open in the browser runs the packaged setup (same as SONIQ.app).
#
#   linux/build-deb.sh
#
# Needs: Debian/Ubuntu amd64 or arm64, build-essential, cmake, git, curl, libvulkan-dev, glslc, dpkg-dev
set -euo pipefail
source "$(dirname "$0")/../scripts/common.sh"
cd "$ROOT"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  DEB_ARCH=amd64;  NODE_PLAT=linux-x64 ;;
  aarch64) DEB_ARCH=arm64;  NODE_PLAT=linux-arm64 ;;
  *) echo "Unsupported architecture: $ARCH (need x86_64 or aarch64)."; exit 1 ;;
esac

OUT="$ROOT/dist-linux"
STAGE="$OUT/stage"
CACHE="$OUT/cache"
EB="$ENGINE/build-deb"
VERSION="${VERSION:-$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)}"
DEB_VERSION="${VERSION#v}"
PKG_NAME="soniq_${DEB_VERSION}_${DEB_ARCH}"
schritt() { echo ""; echo "▸ $1"; }

mkdir -p "$OUT" "$CACHE"
fail_log() { echo ""; echo "Build failed. Last lines of $OUT/engine-build.log:"; tail -60 "$OUT/engine-build.log" 2>/dev/null || true; exit 1; }

schritt "Build tools ($DEB_ARCH)"
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }
need cmake; need git; need curl; need tar; need dpkg-deb; need glslc
pkg-config --exists vulkan 2>/dev/null || [ -f /usr/include/vulkan/vulkan.h ] \
  || { echo "Missing Vulkan headers (apt install libvulkan-dev)."; exit 1; }
echo "  cmake $(cmake --version | head -1)"
echo "  glslc $(command -v glslc)"
echo "  ok"

schritt "Model server acestep.cpp (${ACESTEP_REV:0:7}, Vulkan, portable)"
if ! "$EB/ace-server" --help 2>&1 | head -1 | grep -q "${ACESTEP_REV:0:7}"; then
  [ -d "$ENGINE/.git" ] || git clone --quiet "$ACESTEP_REPO" "$ENGINE"
  ( cd "$ENGINE" && { git cat-file -e "$ACESTEP_REV^{commit}" 2>/dev/null || git fetch --quiet origin; } \
    && git checkout --quiet "$ACESTEP_REV" && git submodule update --init --recursive --quiet ) \
    || { echo "Failed to checkout acestep.cpp $ACESTEP_REV"; exit 1; }
  rm -rf "$EB"
  {
    echo "== cmake configure =="
    cmake -S "$ENGINE" -B "$EB" -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DGGML_NATIVE=OFF
    echo "== cmake build =="
    cmake --build "$EB" --config Release -j "$(nproc)"
  } > "$OUT/engine-build.log" 2>&1 || fail_log
  [ -x "$EB/ace-server" ] || fail_log
fi
echo "  ok"

schritt "Node.js $NODE_VERSION ($NODE_PLAT)"
entry=$(echo "$NODE_FILES" | grep "^node-v$NODE_VERSION-$NODE_PLAT\.") \
  || { echo "No Node.js build for $NODE_PLAT in scripts/common.sh."; exit 1; }
file=${entry%%:*}; sha=${entry##*:}
NODE_BIN="$CACHE/node-$NODE_VERSION"
if [ ! -x "$NODE_BIN" ]; then
  curl -L --fail -sS -o "$CACHE/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  got=$(sha256sum "$CACHE/$file" | cut -d' ' -f1)
  [ "$got" = "$sha" ] || { rm -f "$CACHE/$file"; echo "Checksum of $file does not match."; exit 1; }
  tar -xJf "$CACHE/$file" -C "$CACHE" --strip-components 2 "node-v$NODE_VERSION-$NODE_PLAT/bin/node"
  mv "$CACHE/node" "$NODE_BIN"
  rm -f "$CACHE/$file"
fi
echo "  ok"

schritt "Interface"
"$NODE_BIN" scripts/build-frontend.mjs

schritt "Staging $PKG_NAME"
rm -rf "$STAGE"
OPT="$STAGE/opt/soniq"
mkdir -p "$OPT/bin" "$OPT/lib" "$OPT/app/scripts" "$OPT/app/frontend" "$OPT/app/backend" \
  "$STAGE/lib/systemd/system" "$STAGE/etc/soniq" \
  "$STAGE/var/lib/soniq/data" "$STAGE/var/lib/soniq/models" \
  "$STAGE/DEBIAN"

cp "$NODE_BIN" "$OPT/bin/node"
cp "$EB/ace-server" "$OPT/bin/ace-server"
chmod 755 "$OPT/bin/node" "$OPT/bin/ace-server"

# Bundle non-system shared libs from the build tree (Vulkan ICD stays on the host)
while read -r lib; do
  [ -n "$lib" ] && [ -f "$lib" ] || continue
  case "$lib" in
    /lib/*|/lib64/*|/usr/lib/*) continue ;;
  esac
  cp -L "$lib" "$OPT/lib/$(basename "$lib")"
done < <(ldd "$OPT/bin/ace-server" 2>/dev/null | awk '/=> \// {print $3}')
while IFS= read -r -d '' so; do
  base=$(basename "$so")
  [ -e "$OPT/lib/$base" ] || cp -L "$so" "$OPT/lib/$base"
done < <(find "$EB" -maxdepth 2 -type f -name '*.so*' -print0 2>/dev/null)
if command -v patchelf >/dev/null 2>&1; then
  patchelf --set-rpath '$ORIGIN/../lib' "$OPT/bin/ace-server" || true
fi

cp -R backend/src backend/package.json "$OPT/app/backend/"
cp -R shared package.json "$OPT/app/"
cp scripts/common.sh "$OPT/app/scripts/"
cp -R frontend/dist "$OPT/app/frontend/"

printf '%s\n' "$DEB_VERSION" > "$OPT/app/VERSION"

install -m 644 linux/soniq.service "$STAGE/lib/systemd/system/soniq.service"
sed -i "/^Environment=MG_ENGINE_BIN=/a Environment=MG_APP_VERSION=$DEB_VERSION" "$STAGE/lib/systemd/system/soniq.service"
install -m 644 linux/soniq.env "$STAGE/etc/soniq/soniq.env"

touch "$STAGE/var/lib/soniq/data/.keep" "$STAGE/var/lib/soniq/models/.keep"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: soniq
Version: $DEB_VERSION
Section: sound
Priority: optional
Architecture: $DEB_ARCH
Maintainer: Petar Gerov <peter@gerov.com>
Depends: adduser, libvulkan1
Recommends: mesa-vulkan-drivers | nvidia-driver | vulkan-tools
Homepage: https://github.com/petergerov/soniq
Description: SONIQ local music generator (server)
 Web UI and ACE-Step 1.5 model server for headless Debian/Ubuntu.
 Models download on first setup in the browser. Needs a Vulkan-capable GPU
 for generation (CPU fallback via acestep.cpp is limited).
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if ! getent passwd soniq >/dev/null; then
  adduser --system --group --home /var/lib/soniq --no-create-home \
    --gecos "SONIQ music generator" soniq
fi
chown -R soniq:soniq /var/lib/soniq
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable soniq.service >/dev/null 2>&1 || true
  systemctl restart soniq.service >/dev/null 2>&1 || systemctl start soniq.service >/dev/null 2>&1 || true
fi
echo "SONIQ installed. Open http://127.0.0.1:8765 (see /etc/soniq/soniq.env). Logs: journalctl -u soniq -f"
EOF

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ -d /run/systemd/system ]; then
  systemctl stop soniq.service >/dev/null 2>&1 || true
  systemctl disable soniq.service >/dev/null 2>&1 || true
fi
EOF

cat > "$STAGE/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = purge ] && [ -d /run/systemd/system ]; then
  systemctl daemon-reload || true
fi
EOF

chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"

schritt "dpkg-deb"
DEB="$OUT/${PKG_NAME}.deb"
fakeroot dpkg-deb --build --root-owner-group "$STAGE" "$DEB" >/dev/null \
  || dpkg-deb --build --root-owner-group "$STAGE" "$DEB" >/dev/null
ls -lh "$DEB"
echo ""
echo "Install:  sudo apt install ./$(basename "$DEB")"
echo "Service:  sudo systemctl status soniq"
echo "UI:       http://127.0.0.1:8765"
