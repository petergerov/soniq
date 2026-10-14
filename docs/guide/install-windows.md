# Installation on Windows

[← Guide](README.md) · Next: [Using the app](using-the-app.md)

## 1. Get the project

Open **PowerShell** (Start menu, type “PowerShell”) and paste this command. It downloads the project into the
folder **soniq** in your user folder:

```powershell
git clone https://github.com/petergerov/soniq.git $HOME\soniq
```

If Windows doesn't know the `git` command, run `winget install Git.Git` once first and reopen PowerShell.
A ZIP works too: unpack it and put the folder in a permanent place.

## 2. Run the installer

In the **soniq** folder, **double-click “Install”** (the file `Install.bat`). A PowerShell window opens;
the questions are the same as [on the Mac](install-mac.md#2-run-the-installer): choose the language model, confirm
with <kbd>Enter</kbd>, wait. Alternatively without questions:

```powershell
.\Install.ps1 -Yes
```

The installer needs no admin rights and no compiler. It downloads Node.js and ready-made program files of the model
server (about 180 MB) and the models, verifies their checksums, tests the graphics card and places
**Music Generator ON** and **OFF** as shortcuts in the folder and on the desktop.

> [!WARNING]
> If Windows says “Windows protected your PC”, click **More info** and then **Run anyway**.
> This only happens with an unpacked ZIP, not after `git clone`.

## What's different on Windows

| Topic | Windows |
|---|---|
| **Graphics card** | RTX 30xx and newer run on CUDA. Older cards (GTX 10xx/16xx, RTX 20xx) automatically use Vulkan: a 30-second song takes about 1 minute on a GTX 1060, 90 seconds about 2.5 minutes. |
| **Language model** | Graphics memory limits the choice as well: below 6 GB 0.6B, 6 to 7 GB 1.7B, from 8 GB 4B. The installer suggests a fitting one. |
| **XL sound model** | Recommended from 12 GB graphics memory. Add it later with `.\Install.ps1 -XL`. |
| **Start and stop** | Shortcuts on the desktop and in the folder. OFF stops the servers but leaves the browser tab open. |
| **Log files** | In the `data` folder: `server.log`, `ace-server.log` and an `.err.log` with error messages for each. |

## Installer options

```powershell
.\Install.ps1 -Yes          # no questions, take the recommendation
.\Install.ps1 -LM 1.7B      # force a language model: 0.6B, 1.7B or 4B
.\Install.ps1 -XL           # also download the XL sound model
.\Install.ps1 -NoStart      # don't start the app at the end
.\Install.ps1 -Build        # compile the model server yourself (needs Visual Studio Build Tools + CUDA Toolkit)
```

---

From here on everything works as on the Mac: continue with [Using the app](using-the-app.md).
Windows-specific problems are in [Help](troubleshooting.md#windows-only).
