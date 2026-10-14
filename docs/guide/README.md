# SONIQ Music Generator – Guide

Create your own songs locally: no limits, no subscription, no cloud.

SONIQ creates songs directly on your computer. You describe style and mood, and the app composes studio-quality
music from it (48 kHz). Everything runs locally, so there are no download limits and your material stays on your machine.

Based on ACE-Step 1.5 (MIT license) via [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp).
No account needed.

## Contents

1. [Installation on the Mac](install-mac.md)
2. [Installation on Windows](install-windows.md)
3. [Using the app](using-the-app.md): starting and stopping, the form, library, folders, settings, updates
4. [Help](troubleshooting.md): common problems, uninstalling, model license

Linux (Arch) is covered in the [main README](../../README.md#linux-arch-linux--derivate).

## What you need

| Requirement | Why |
|---|---|
| **Mac:** Apple Silicon (M1 or newer) | Sound generation uses the graphics chip. Intel Macs are untested. |
| **Windows:** Windows 10/11, NVIDIA graphics card | RTX 30xx or newer runs on CUDA, older cards on Vulkan (slower). |
| **Memory:** at least 8 GB RAM, 16 GB recommended | Determines which language model fits. On Windows, graphics memory counts too. |
| **Disk:** 7 to 11 GB free, about 5 GB more with XL | Models, model server and room for your songs. |
| **Internet:** for the installation only | The models (4 to 8 GB) are downloaded once. After that everything works offline. |
| **Time:** about 15 to 30 minutes | Depends mostly on your download speed. |

## How the installation works

1. **Get the project.** Download the project folder via Git, or receive it as a folder.
2. **Run Install.** Double-click “Install”. The installer checks your computer and sets everything up.
3. **Make music.** “Music Generator ON” opens the app in your browser.

> [!NOTE]
> The installer hardly asks anything. You can run it again at any time: finished steps are skipped and
> interrupted downloads resume.

---

The screenshots in this guide are taken from the running app with [`capture.py`](capture.py)
(`uv run --with websockets python docs/guide/capture.py`).
