# SONIQ on Debian / Ubuntu (server)

Headless install as a **systemd** service. The `.deb` ships portable Node.js, a **Vulkan** `ace-server`, and the web UI. Models are **not** in the package — open the UI once and use the setup (same flow as `SONIQ.app`).

Packages: **amd64** and **arm64** (from CI).

## Install from a release

```bash
# amd64 (x86_64)
curl -LO https://github.com/petergerov/soniq/releases/download/v0.2.0/soniq_0.2.0_amd64.deb
sudo apt install ./soniq_0.2.0_amd64.deb

# arm64 (aarch64 — Graviton, Ampere, Pi 5, …)
curl -LO https://github.com/petergerov/soniq/releases/download/v0.2.0/soniq_0.2.0_arm64.deb
sudo apt install ./soniq_0.2.0_arm64.deb
```

Pick the file that matches `dpkg --print-architecture` (`amd64` or `arm64`).

Then open **http://127.0.0.1:8765**, pick the language model, download models, run the graphics check.

```bash
sudo systemctl status soniq
journalctl -u soniq -f
```

Config: `/etc/soniq/soniq.env` (`MG_HOST=0.0.0.0` to listen on all interfaces — put a reverse proxy / firewall in front).

Data and models: `/var/lib/soniq/{data,models}` (user `soniq`).

Uninstall (keeps `/var/lib/soniq` unless you purge):

```bash
sudo apt remove soniq
# sudo apt purge soniq   # also removes config; data dir is left for you to delete
```

## Create a release (Mac DMG + both .debs)

Same tag as always — CI attaches everything to one GitHub Release:

```bash
# on main (or develop), version already in package.json
git tag -a v0.2.0 -m "SONIQ 0.2.0"
git push origin v0.2.0
```

That runs:

- **Mac app** → `SONIQ-0.2.0.dmg`
- **Debian server** (amd64 + arm64) → `soniq_0.2.0_amd64.deb`, `soniq_0.2.0_arm64.deb`

If the tag already exists and you want to rebuild: delete and recreate (`git tag -d v0.2.0`, `git push origin :refs/tags/v0.2.0`, then tag/push again), or re-run the workflows on that tag in GitHub Actions.

## Build locally

On amd64 or arm64 Debian/Ubuntu:

```bash
sudo apt install build-essential cmake git curl xz-utils pkg-config \
  libvulkan-dev vulkan-tools glslang-tools glslc spirv-tools spirv-headers \
  patchelf fakeroot dpkg-dev
VERSION=0.2.0 ./linux/build-deb.sh
# → dist-linux/soniq_0.2.0_amd64.deb  or  …_arm64.deb
sudo apt install ./dist-linux/soniq_0.2.0_$(dpkg --print-architecture).deb
```

CI also tries the LunarG Vulkan SDK (`humbletim/install-vulkan-sdk`); on arm64 apt `glslc` is the usual fallback.

## Pipeline

GitHub Action **Debian server** (`.github/workflows/debian-server.yml`):

- Matrix: `ubuntu-24.04` (amd64) and `ubuntu-24.04-arm` (arm64)
- Push to `main` / `develop` when `linux/` (or related paths) change, or **Run workflow**
- Every tag `v*`: both `.deb` files go on the GitHub Release (with the Mac DMG)

## Notes

- **GPU:** package is built with `GGML_VULKAN=ON`. Install a Vulkan driver on the host. On many ARM boards Vulkan is limited; generation may be slow or CPU-bound.
- Packaged mode (`MG_PACKAGED=1`): updates come as a new `.deb` from GitHub Releases, not `git pull`.
