# SONIQ on Debian / Ubuntu (server)

Headless install as a **systemd** service. The `.deb` ships portable Node.js, a **Vulkan** `ace-server`, and the web UI. Models are **not** in the package — open the UI once and use the setup (same flow as `SONIQ.app`).

## Install from a release

```bash
# example: 0.2.0
curl -LO https://github.com/petergerov/soniq/releases/download/v0.2.0/soniq_0.2.0_amd64.deb
sudo apt install ./soniq_0.2.0_amd64.deb
```

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

## Build locally

On amd64 Debian/Ubuntu:

```bash
sudo apt install build-essential cmake git curl xz-utils \
  libvulkan-dev vulkan-tools glslang-tools spirv-tools patchelf fakeroot dpkg-dev
VERSION=0.2.0 ./linux/build-deb.sh
sudo apt install ./dist-linux/soniq_0.2.0_amd64.deb
```

## Pipeline

GitHub Action **Debian server** (`.github/workflows/debian-server.yml`):

- Push to `main` / `develop` when `linux/` (or related paths) change, or **Run workflow**
- Every tag `v*`: build `soniq_<version>_amd64.deb` and attach it to the GitHub Release (together with the Mac DMG)

## Notes

- **GPU:** package is built with `GGML_VULKAN=ON`. Install a Vulkan driver on the host (`mesa-vulkan-drivers`, NVIDIA proprietary, …). For CUDA-only machines, use the source installer (`install.sh` / `arch_linux.sh --backend cuda`) instead.
- **Architecture:** amd64 only for now.
- Packaged mode (`MG_PACKAGED=1`): updates come as a new `.deb` from GitHub Releases, not `git pull`.
