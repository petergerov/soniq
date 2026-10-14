# Installation on the Mac

[← Guide](README.md) · Next: [Using the app](using-the-app.md)

## 1. Get the project

Open the **Terminal** app (Spotlight: <kbd>Cmd</kbd>+<kbd>Space</kbd>, type “Terminal”) and paste this command.
It downloads the project into the folder **MusicGenerator** in your home folder:

```bash
git clone https://github.com/petergerov/soniq.git ~/MusicGenerator
```

If the Apple developer tools are missing, macOS now asks automatically whether to install them: confirm with
**Install**, wait, then run the command again.

> [!TIP]
> **Without Git:** If you received the project folder as a ZIP or via AirDrop, unpack it to a permanent place,
> for example your home folder. Don't leave it in Downloads, that folder tends to get cleaned up.

## 2. Run the installer

Open the folder in Finder and **double-click “Install”**. A Terminal window opens in which the installer works.
Alternatively in the Terminal:

```bash
open ~/MusicGenerator/Install.command
```

The installer shows what it found on your Mac and suggests the matching language model:

```text
  MUSIC GENERATOR · Installation

▸ Checking Mac
  Chip:        Apple M4 (arm64)
  Memory:      16 GB
  Free disk space: 40 GB

  Language model (plans structure, tempo, key; bigger = better songs, more memory):
    1) 0.6B  – 0.7 GB, for 8 GB RAM
    2) 1.7B  – 2.0 GB, for 16 GB
    3) 4B    – 4.5 GB, from 24 GB
  Choice [Enter = 1.7B recommended] _
```

<kbd>Enter</kbd> accepts the recommendation, <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd> lets you choose.
Then <kbd>Enter</kbd> once more to start, the rest runs by itself.

> [!WARNING]
> **macOS warning:** If macOS only offers “Move to Trash” or “Cancel”, choose **Cancel**, then open
> **System Settings › Privacy & Security**, scroll to the bottom and click **Open Anyway** next to “Install”
> (password or Touch ID). Then double-click Install again. Faster: see [If macOS blocks the file](#if-macos-blocks-the-file).

## What the installer does

| Step | What happens |
|---|---|
| **Check the Mac** | Detect chip, memory, macOS version and free space. |
| **Choose a model** | Suggest the matching language model size, check disk space. |
| **Tools** | Apple developer tools, Node.js and cmake, without password and without Homebrew. |
| **Build the model server** | Download acestep.cpp in the tested version and compile it for your Mac. |
| **Download models** | Only the files your Mac needs, with progress bar, resumable, checksums verified. |
| **Test the graphics chip** | Trial run: does the language model compute correctly on the graphics chip? Otherwise it uses the CPU. |
| **Set up icons** | Green start and red stop icon for “Music Generator ON/OFF”. |
| **Go** | Start the servers and open the app in the browser. |

## Which model?

Bigger means song structure, tempo and lyrics are matched better. The sound model (SFT, high quality) is the same for all.

| Language model | Size | Memory | Total download |
|---|---|---|---|
| 0.6B | 0.7 GB | from 8 GB RAM | about 4.4 GB |
| **1.7B** (most common) | 2.0 GB | from 16 GB RAM | about 5.6 GB |
| 4B | 4.5 GB | from 24 GB RAM | about 8.1 GB |

> [!NOTE]
> **Optional: XL sound model.** The installer asks once whether to also download the larger sound model
> **ACE-Step 1.5 XL** (4 instead of 2 billion parameters, 5.3 GB, <kbd>Enter</kbd> = no). According to the developers
> it sounds better, but takes about twice as long: on an M4 with 16 GB a 30-second song took 99 instead of 49 seconds.
> Recommended from 16 GB RAM. Switch under **Gear › Sound model**, Standard stays preselected.
> To add it later, run `./Install.command --xl`.

## How long?

| Step | Duration |
|---|---|
| Build model server | 2 to 5 min. |
| Download models | depends on your connection |
| Graphics chip test | 1 to 2 min. |
| One song (1:30) | about 2 to 4 min. |

## If macOS blocks the file

This happens with files from the internet, especially a ZIP. Instead of going through System Settings, one Terminal
command fixes the whole folder in one go. Afterwards Install and Music Generator ON/OFF open without a prompt:

```bash
xattr -dr com.apple.quarantine ~/MusicGenerator
```

With `git clone` (step 1) the warning never appears in the first place.

## Installer options

```bash
./Install.command --yes        # no questions, take the recommendation
./Install.command --lm 4B      # force a language model: 0.6B, 1.7B or 4B
./Install.command --xl         # also download the XL sound model
./Install.command --no-start   # don't start the app at the end
```

---

Continue with [Using the app](using-the-app.md).
