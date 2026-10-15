# SONIQ

Create your own songs locally – no limits, no subscription, no cloud.
A web interface for [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) via
[acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp).

- **Mac** (Apple Silicon, Metal): this page. Detailed guide with pictures: **[docs/guide](docs/guide/README.md)**
- **Windows** (NVIDIA, CUDA/Vulkan): **[README-WINDOWS.md](README-WINDOWS.md)**
- **Linux** (Arch Linux and derivatives with an installer, other distributions by hand): see [Linux](#linux-arch-linux--derivatives) below
- **Debian / Ubuntu server** (`.deb` + systemd, from GitHub Releases): see [`linux/README.md`](linux/README.md)

## Installation

Requirements: a Mac with Apple Silicon (M1 or newer), at least 8 GB of memory, 7–11 GB of free disk space.

```bash
git clone https://github.com/petergerov/soniq.git ~/soniq
open ~/soniq/install.command
```

The installer

1. checks chip, memory and free disk space,
2. suggests the matching language model (0.6B below 12 GB, 1.7B up to 24 GB, 4B above),
3. installs what is missing: Apple developer tools, Node.js (portable, in `runtime/`), `cmake` (no Homebrew, no password),
4. builds acestep.cpp in the tested version (`b7ba6d9`),
5. downloads only the models it needs (resumable),
6. tests whether the language model computes correctly on the graphics chip (otherwise CPU, see below),
7. sets up the icons for **start / stop** and starts the app.

It can be run again at any time; finished steps are skipped.
Options: `--yes` (no questions), `--lm 0.6B|1.7B|4B`, `--xl`, `--no-start`.

**XL sound model (optional):** The installer asks whether to also download the larger sound model ACE-Step 1.5 XL (4 instead of 2 billion parameters, 5.3 GB). According to the developers it sounds better; it takes about twice as long and needs more memory (16 GB RAM or 12 GB graphics memory and up). The smaller model stays the default; you can switch to XL afterwards under Gear › Sound model. Measured on an M4 with 16 GB: a 30-second song took 49 s with Standard and 99 s with XL. Not tested much yet, feedback welcome.

## Usage

- **start** starts the model server and the app and opens http://localhost:8765
- **stop** stops everything and closes the browser tabs
- The interface is available in twelve languages (selector at the top right): German, English, Spanish, French, Italian, Portuguese, Turkish, Polish, Russian, Ukrainian, Japanese, Chinese. Corrections to `frontend/src/i18n/translations.ts` (interface) and `backend/src/i18n/messages.ts` (server messages) are welcome.

## Updating

In the app: Gear › **Check for updates** › **Update now** (fetches the new version from GitHub and restarts the app; if acestep.cpp changes, it tells you to run the installer). Or by hand:

```bash
cd ~/soniq && git pull
open install.command
```

Songs and settings in `data/` are kept.

## Uninstalling

- **Mac:** double-click `uninstall.command` (or run it in the Terminal)
- **Windows:** double-click `uninstall.bat`
- **Linux:** `./uninstall.sh` (or `./arch_linux.sh --uninstall`)

The script shows what it will remove and asks first. It stops the servers, deletes the model server, models, Node.js runtime and settings (on Windows also the shortcuts), and asks whether to keep your **songs and library** (titles, folders, favorites). The default is to keep them. With `--yes` (Windows: `-Yes`) it runs without questions and keeps songs and library. Not removed: the program folder itself, tools outside it (for example Git) and songs in a song folder you chose yourself. Finally, delete the program folder. The Linux version is based on an idea by ZeroDot1.

## Linux (Arch Linux & derivatives)

On Arch Linux (as well as CachyOS, EndeavourOS, Manjaro) there is an automatic all-in-one script (contributed by ZeroDot1):

```bash
git clone https://github.com/petergerov/soniq.git ~/soniq
cd ~/soniq
./arch_linux.sh
```

The script:
1. Checks system, RAM, disk and graphics card:
   - **AMD Radeon** (e.g. **RX 9070 XT** / Navi 48 / RDNA4): native acceleration via ROCm/HIP (`rocm-hip-sdk`) or Vulkan (`vulkan-radeon` / RADV).
   - **NVIDIA**: CUDA or Vulkan.
   - **Intel**: Vulkan (`vulkan-intel`).
   - **CPU**: automatic fallback if there is no GPU.
2. Installs missing dependencies via `pacman` or `yay` (`base-devel`, `cmake`, `git`, `curl`, `xdg-utils`, plus, depending on the backend, `rocm-hip-sdk` or `vulkan-headers`, `spirv-headers`, `shaderc`, `vulkan-icd-loader`).
3. Uses an installed Node.js 22.18 or newer, otherwise downloads a portable version to `runtime/node`.
4. Compiles `acestep.cpp` with the best hardware acceleration (ROCm/HIP for AMD, CUDA for NVIDIA, Vulkan or CPU).
5. Downloads the required GGUF models with SHA-256 verification.
6. Runs the graphics self-test, starts the servers and opens the browser at `http://localhost:8765`.

**Using it on Linux:**
- Start: `./arch_linux.sh` (or `./start.sh`)
- Stop: `./arch_linux.sh --stop` (or `./stop.sh`, or the “Stop servers” button in the web interface)
- Status: `./arch_linux.sh --status`
- Options: `--yes` (no questions), `--yay` (install packages via the AUR helper yay), `--backend [auto|rocm|hip|vulkan|cuda|cpu]`, `--lm [0.6B|1.7B|4B]`, `--xl`, `--rebuild`, `--no-browser`

**Multiple graphics cards:** By default the script uses the first card and prefers the dedicated one (`HIP_VISIBLE_DEVICES=0`, `DRI_PRIME=1`, `GGML_VK_VISIBLE_DEVICES=0`). If you need a different card, set the variable yourself before starting, for example `GGML_VK_VISIBLE_DEVICES=1 ./arch_linux.sh --start`. Your own values are not overwritten.

### Other Linux distributions (by hand)

The script requires `pacman`. On Ubuntu, Debian, Fedora and others you can set it up by hand. **Untested**, feedback welcome.

Requirements: git, cmake, a C++ compiler, [Node.js](https://nodejs.org) 22.18 or newer with npm (recommended: 24 LTS), for NVIDIA the CUDA Toolkit (AMD/Intel: Vulkan SDK).

```bash
git clone https://github.com/petergerov/soniq.git ~/soniq
cd ~/soniq
# Build the model server in the tested version (the hash is in scripts/common.sh)
git clone --recurse-submodules https://github.com/ServeurpersoCom/acestep.cpp engine/acestep.cpp
(cd engine/acestep.cpp && git checkout b7ba6d9 && ./buildcuda.sh)     # or ./buildvulkan.sh, ./buildcpu.sh
# Download models: the three fixed ones plus one language model (URL and SHA-256 in scripts/common.sh)
(cd engine/acestep.cpp && ./models.sh --lm 1.7B --sft) && mkdir -p models && mv engine/acestep.cpp/models/*.gguf models/
# Operating mode: one server for everything
mkdir -p data && printf 'MODE=single\nLM_FILE=acestep-5Hz-lm-1.7B-Q8_0.gguf\n' > data/engine.conf
# Build the interface (the app also does this by itself on start if it is missing)
node scripts/build-frontend.mjs
```

After that, starting and stopping work with `./arch_linux.sh --start` and `--stop`, even without `pacman` (not tested). Alternatively, start both servers by hand:

```bash
engine/acestep.cpp/build/ace-server --host 127.0.0.1 --port 8085 --models models --max-batch 1
node --disable-warning=ExperimentalWarning backend/src/main.ts --port 8765
```

`models.sh` downloads more variants than needed; what you need is `vae-BF16`, `Qwen3-Embedding-0.6B-Q8_0`, `acestep-v15-sft-Q8_0` and the chosen `acestep-5Hz-lm-*-Q8_0`. As everywhere, songs are stored in `data/songs`.

## Project structure

| Path | Contents |
|---|---|
| `install.command` | Installer (Mac) |
| `uninstall.command`, `uninstall.bat` / `.ps1`, `uninstall.sh` | Uninstall (Mac, Windows, Linux); `scripts/uninstall.sh` is shared by Mac and Linux |
| `start.command`, `stop.command` | Start and stop (Mac) |
| `install.ps1`, `start.ps1`, `stop.ps1` + `.bat` | Installer, start and stop (Windows) |
| `arch_linux.sh`, `install.sh`, `start.sh`, `stop.sh` | Installer, start and stop (Arch Linux & Linux) |
| `linux/` | Debian/Ubuntu server `.deb` (`build-deb.sh`, systemd unit); CI: `.github/workflows/debian-server.yml` |
| `scripts/common.sh` | Shared paths, ports, acestep.cpp version, model checksums |
| `scripts/common.ps1` | Windows counterpart, reads its values from `common.sh` |
| `backend/` | Server in TypeScript (Node.js, no runtime dependencies, runs without a build step), see below |
| `frontend/` | Interface in TypeScript (Vite); `frontend/dist/` is the built version, not in the repo: every installation builds it (`scripts/build-frontend.mjs`) |
| `shared/api.ts` | HTTP API types, shared by backend and frontend |
| `runtime/` | Portable Node.js runtime (and on the Mac possibly cmake), from the installer, not in the repo |
| `docs/guide/` | Guide with pictures (Markdown). `capture.py` takes the screenshots in `images/` from the running app (`uv run --with websockets python docs/guide/capture.py`) |
| `engine/` | acestep.cpp model server (from the installer, not in the repo) |
| `models/` | GGUF models (from the installer, not in the repo) |
| `data/` | Songs, database, logs, `engine.conf` (not in the repo) |

## Development

Backend and frontend are TypeScript. Node.js runs `backend/src` directly (type stripping, Node 22.18 or newer).
The interface is built on each computer into `frontend/dist` (not in the repo): the installer runs `scripts/build-frontend.mjs`
(`npm ci` if needed, then `vite build`), and the app runs it on every start when the build is missing or older than its sources,
for example after an update. Until it is done the app shows a short "getting ready" page; the output goes to `data/frontend-build.log`.

```bash
npm install            # developer tools (TypeScript, Vite, wavesurfer.js)
npm run dev            # backend with --watch on :8765 and Vite with hot reload on :5173 (proxies /api)
npm run typecheck      # type-check both parts
npm run build          # type-check and build the interface into frontend/dist (not committed)
```

`MG_DATA_DIR=/path` makes the backend use a different data folder (e.g. for testing with a copy of the library).
`MG_MODELS_DIR=/path` does the same for the models. `MG_PACKAGED=1` is set by a packaged app (e.g. `SONIQ.app`):
the interface ships pre-built, updates come as new app versions instead of `git pull`, and “Stop servers” only ends the
web server (the app stops the model server).
In this mode the backend also starts and stops the model server itself (`MG_ENGINE_BIN`, ports `MG_SYNTH_PORT` / `MG_LM_PORT`,
default 8085 / 8086) and, while models are missing, the interface shows a setup: pick the language model, download the
models (resumable, SHA-256 checked, list from `scripts/common.sh`; `MG_HF_BASE` replaces the download address, e.g. for
tests), graphics self-test, then the model server starts. It does the same as `install.command`, see `services/setup-service.ts`.

**Backend** (`backend/src`), layers from the outside in; dependencies only point inwards and are passed in via
constructors in `main.ts` (composition root):

| Folder | Responsibility |
|---|---|
| `http/` | Router, request/response, validation, errors → HTTP status; `routes/` per resource |
| `services/` | Application logic: generation + queue, library, folders, settings, analysis, updates, system |
| `domain/` | Business rules and interfaces without technology: songs, error kinds, `MusicEngine` |
| `infrastructure/` | Technology: SQLite (`node:sqlite`), repositories, acestep.cpp client, files, ZIP, Git, processes, keep-awake |
| `config/`, `i18n/` | Paths/ports, server messages in twelve languages |
| `cli/selftest.ts` | The installer's language model test |

**Frontend** (`frontend/src`): `core/` (API client, DOM, formatting, storage), `i18n/`, and one folder per feature
under `features/` (`generator`, `analyze`, `library`, `player`, `settings`, `status`). `main.ts` wires everything together.


### Mac app (SONIQ.app)

`macos/build-app.sh [--dmg]` builds `dist-mac/SONIQ.app` (and `SONIQ.dmg`): a small menu bar app (`macos/SONIQ/main.swift`)
that starts the backend with `MG_PACKAGED=1`; the backend starts the model server and shows the setup while models are
missing. Inside the app: `Contents/MacOS/{SONIQ,node,ace-server}`, the model server's libraries in `Contents/Frameworks`,
the web app in `Contents/Resources/app`. Songs, settings and models live in `~/Library/Application Support/SONIQ`.
Needs Apple Silicon and the Xcode command line tools; the model server is built from `engine/acestep.cpp` (built if missing).
Without `SIGN_IDENTITY` the app is signed ad hoc (runs on this Mac). For testing next to a running SONIQ:
`SONIQ_PORT=8793 SONIQ_HOME=/tmp/soniq-test MG_SYNTH_PORT=8185 MG_LM_PORT=8186 dist-mac/SONIQ.app/Contents/MacOS/SONIQ`.
The model server in the app is a separate portable build (`engine/acestep.cpp/build-app`, `GGML_NATIVE=OFF`, macOS 13.5+,
with acestep.cpp's own float parser instead of `std::from_chars`, which Apple only ships from macOS 26).

Releases: on every tag `v*`, GitHub Actions attach platform packages to the same release:

- **Mac:** `.github/workflows/mac-app.yml` → `SONIQ-<version>.dmg` (sign/notarize when secrets are set; see [`macos/README.md`](macos/README.md))
- **Debian/Ubuntu server:** `.github/workflows/debian-server.yml` → `soniq_<version>_amd64.deb` (Vulkan + systemd; see [`linux/README.md`](linux/README.md))
## Graphics chip and the two modes

On the Apple M4, the language model produces wrong results under Metal in acestep.cpp `b7ba6d9`
(0 audio codes). The installer detects this with a short trial run and writes to `data/engine.conf`:

- `MODE=split` – language model on the CPU (port 8086), sound generation on Metal (port 8085)
- `MODE=single` – everything on one Metal server (port 8085)

After an update of acestep.cpp (`ACESTEP_REV` in `scripts/common.sh`) the installer tests again.

## Model license

ACE-Step 1.5 is licensed under the MIT License. The models are downloaded from
[Hugging Face](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF) during installation and are not part of this repository.
Check the license and training data situation yourself before any commercial use.

## License

The code in this repository is licensed under the [MIT License](LICENSE).
The player uses [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) (BSD-3-Clause), bundled into the built interface.
