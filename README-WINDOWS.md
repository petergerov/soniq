# SONIQ for Windows

Same app as on the Mac; the model server runs via CUDA on the NVIDIA graphics card.
The installer downloads the ready-made Windows binaries of acestep.cpp (no compiler needed).

Detailed guide with pictures: **[Installation on Windows](docs/guide/install-windows.md)**

## Installation

Requirements: Windows 10/11 (64-bit), an NVIDIA graphics card with a current driver,
at least 8 GB of memory, 7–11 GB of free disk space.

The ready-made binaries are built with CUDA 13 and only contain code for RTX 30xx and newer.
Older cards (GTX 10xx/16xx, RTX 20xx) automatically run via Vulkan, which is slower but works:
on a GTX 1060 (6 GB) a 30-second song takes about 1 minute, a 90-second song about 2.5 minutes.

1. If `git` is missing: open PowerShell and run `winget install Git.Git` (or let the installer do it).
2. In PowerShell:

```powershell
git clone https://github.com/petergerov/soniq.git $HOME\soniq
```

3. In the `soniq` folder, double-click **install.bat**.

The installer

1. checks graphics card, memory and free disk space,
2. suggests the matching language model (by memory: 0.6B below 12 GB, 1.7B up to 24 GB, 4B above;
   graphics memory limits it further: below 6 GB 0.6B, 6–7 GB 1.7B, 8 GB and up 4B),
3. installs what is missing: `git`, Node.js (portable, in `runtime\node`, no admin rights),
4. downloads the ready-made acestep.cpp binaries (about 180 MB),
5. downloads only the models it needs (resumable),
6. tests whether the language model computes correctly on the graphics card (otherwise CPU),
7. creates the shortcuts **SONIQ Start / SONIQ Stop** in the program folder and on the desktop and starts the app.

It can be run again at any time; finished steps are skipped.
Options (in PowerShell): `.\install.ps1 -Yes`, `-LM 0.6B|1.7B|4B`, `-XL` (also the larger XL sound model, 5.3 GB, from 12 GB graphics memory; selectable afterwards under Gear › Sound model), `-NoStart`,
`-Build` (compile it yourself, needs Visual Studio Build Tools and the CUDA Toolkit).

## Usage

- **SONIQ Start** (or `start.bat`) starts the model server and the app and opens http://localhost:8765
- **SONIQ Stop** (or `stop.bat`) stops everything (browser tabs stay open)

## Uninstalling

Double-click `uninstall.bat`. It shows what will be removed and asks whether to keep songs and library (default: keep). Then delete the program folder. Git stays installed.

## Differences from the Mac

| | Mac | Windows |
|---|---|---|
| Start/stop | `.command` files | `.bat` / `.ps1` plus shortcuts with icons |
| Model server | compiled locally (Metal) | ready-made binaries (CUDA, Vulkan, CPU; the backend is chosen at runtime) |
| Shared values | `scripts/common.sh` | `scripts/common.ps1` reads ports and URLs from `common.sh` |
| Logs | `data/*.log` | `data/*.log` and `data/*.err.log` |

## If something goes wrong

- **Model server doesn't start, message about a missing DLL:** update the NVIDIA driver.
  The binaries bring their own CUDA, but need a driver that matches the CUDA version.
- **Everything is very slow:** check in `data/ace-server.err.log` which backend was chosen
  (`[Load] ... backend: CUDA0` or `Vulkan0` is right, `CPU` is wrong).
- **`ErrorOutOfDeviceMemory` in the log, song ends with an error:** not enough graphics memory.
  For this the installer sets the tile size of the VAE decoder in `data/engine.conf` (`VAE_CHUNK`, e.g. 128 with 6 GB);
  if needed, set it lower (64) or choose a smaller language model with `.\install.ps1 -LM 0.6B`, then **SONIQ Stop** and **SONIQ Start**.
- **Updating in the app** works as on the Mac: it fetches the new version from GitHub and restarts.
