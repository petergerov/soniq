# Using the app

[← Guide](README.md) · Next: [Help](troubleshooting.md)

## Start and stop

| | |
|---|---|
| <img src="../../assets/icon-on.png" width="48" alt=""> **start** | starts everything and opens the app in the browser |
| <img src="../../assets/icon-off.png" width="48" alt=""> **stop** | stops everything and closes the browser tabs |

Both are in the project folder, on Windows also on the desktop. Mac tip: drag them to the Dock.
The app runs at **http://localhost:8765**, the windows close by themselves after starting.
You can also stop the servers from inside the app: **Gear › Stop servers**.

## The screen

The app has two pages, switched with the tabs at the top: **Create** (the form) and **Library** (your songs).
While songs are being generated or waiting, the Library tab shows how many (hover it for when everything will be done). The player keeps playing when you switch.

**Time estimate:** running and waiting songs show “~2:10 left” or “done in ~6:40” in the library. The estimate comes from how long your last songs took per second of music, so it appears after the first finished song and gets better with every one.

**ⓘ** next to a label explains that control: click it (or tap it on a phone or tablet) for a short text; click
anywhere else or press Esc to close it. On a computer the same text also appears when you hover over the label.

**Bell** (top right, next to the gear): turn it on to hear a short sound when a song is done (two notes up) or failed (two notes down). If the tab is in the background, the browser also shows a notification; clicking it opens the library. The browser asks once for permission.

![The form with numbered elements](images/form.png)

| # | Element | What it does |
|---|---|---|
| 1 | **Song as a starting point** | Upload field at the top of the form: drop a song on it or click it, then choose. **Take tempo & style**: the app analyzes it and fills in prompt, tempo and length for a new song. **Cover it**: the file becomes the original of a cover (see below). Works with WAV, MP3, M4A, FLAC and OGG. |
| 2 | **Title** | Only for finding the song again. The dice suggests a name. |
| 3 | **Prompt** | Your idea: mood, scene, sound. The dice rolls an idea. |
| 4 | **Style** | Genre and instruments. Dice: a suggestion. Under “Styles”, cards add terms. |
| 5 | **Length** | 10 seconds to 5 minutes, default 1:30. |
| 6 | **BPM** | Tempo. Far left = Auto, the model decides. |
| 7 | **Composition** | Below the presets: switch between **Instrumental** and **Song**. With Song: pick the language and the **voice**: Female, Male or Duet, plus a type (a range like soprano or baritone, or a character like breathy, raspy or rap). The voice is written as words into the style, so it also works when you type them there yourself. Then type your own lyrics, or leave the field empty (dice: “Automatic”) and the model writes its own lyrics when generating. |
| 8 | **Advanced** | Iterations (quality), variance (variety), key, time signature, seed, and **Sampling** (see below). |
| 9 | **Generate** | Pick the number of versions (1 to 10) and go. Several versions are named A, B, C … The bar stays visible while scrolling. |
| 10 | **Gear** | Settings, see [below](#settings). Next to it: interface language (twelve languages, from German to Chinese). |
| 11 | **Presets** | Save the current settings under a name and load them again, see below. |
| 12 | **Bell** | Sound and notification when a song is done, see above. |

Above the prompt sit three more buttons:

- **Random** rolls prompt and style together. In song mode the style also gets a voice (female, male or now and then a duet, often with a type like breathy or tenor).
- **Variation** changes them only slightly: one building block of the prompt (mood, scene, detail) or one style term is swapped, or a term is added. Your own text stays.
- **↶** takes back the last roll, step by step.

**Presets** at the top of the form save the current settings under a name: style, composition (instrumental or song) and vocal language, length, BPM, key, time signature, iterations, variance, number of versions and dice theme. Prompt, title, lyrics and seed are not saved. Pick a preset from the list to load it (↶ brings back the previous style), **Save** with the same name overwrites it, **✕** deletes it.
Below your own presets, **Examples** holds eight built-in songs (funk rock, synthwave, folk ballad, boom bap rap, lo-fi,
film score, chiptune, deep house). Unlike a preset, an example also fills in title, prompt and complete lyrics with
`[verse]` / `[chorus]` markers: a good starting point to see what a full description looks like, or to edit into your own
song. Iterations, variance, number of versions and dice theme stay as they are; ↶ brings back the previous prompt and
style. Examples cannot be deleted.

**Sampling** (Advanced › Sampling, collapsed) is for fine-tuning; the defaults almost always fit. **Prompt
adherence** (1–4, default 2.0) sets how strictly the language model follows the prompt when it plans the music; higher
sticks closer to it with less variety, 1 turns it off. **Top-P** and **Top-K** limit the language model to its most
likely choices (lower = safer; Top-K far left = off). **Avoid** names what the music should not be, e.g. "distorted,
harsh vocals"; it works through prompt adherence, so not at 1.0. **Solver** is how the sound model computes: Euler
(default), SDE, DPM++ 3M or STORK 4; with the same seed, DPM++ 3M and STORK 4 give almost the same song as Euler, SDE a
clearly different one. **Defaults** resets all five. Changed values are shown in
the song's line in the library (e.g. `3.0CFG · K40 · SDE`) and are kept by presets, the arrow (reuse) and the plus
button.

The **lock** next to the prompt and style dice keeps that field as it is: Random and Variation then only change the other one.

The **theme** picker left of these buttons keeps the dice inside one world: Film score, Club, Lo-fi, 80s, Acoustic, Ambient or Hip-hop (or All).

Below the prompt, **Mood**, **Scene** and **Detail** show the building blocks of the prompt. Pick one from the list or roll just that one with its dice; the rest of the prompt stays.

Below the style, three **sliders** (calm ↔ energetic, acoustic ↔ electronic, dark ↔ bright) write a matching word into the style. The middle position writes nothing.

After **Take tempo & style**, **Similar but different** appears under the upload field. Each click keeps tempo, key, length and description of the analyzed song and rolls a new style.

**Cover** (Generation › Cover): plays an existing song in a new style. The original is a file from **Song as a
starting point › Cover it** (the app also reads its lyrics, tempo and key), or in the library ⋮ › **Cover …** on a
song (that fills in its lyrics and a title). Prompt, style, dice and
sliders then describe the new style; length and structure come from the original, so the Length slider disappears.
BPM, key and time signature on Auto take those of the original. **Closeness to the original** goes from 1 (freely
replayed, new sound) to 5 (melody, harmonies and sound stay close to the original); 2 is the default. The model sings
the lyrics as they are; leave them empty and it writes new ones first (that can take several minutes). A cover takes
about as long as a new song of the same length. **✕** next to the original removes it.

## Keyboard shortcuts

They work as long as the cursor is not in a text field (except Ctrl/⌘ + Enter).

| Key | Action |
|---|---|
| **R** | Random: roll prompt and style |
| **V** | Variation |
| **U** | Undo the last roll |
| **Ctrl/⌘ + Enter** | Generate, also while typing |
| **Space** | Play / pause (starts the first song if nothing is playing) |
| **J / K** | Next / previous song |
| **C** | Next version of the same prompt (A → B → …) at the same position |

R, V, U and Ctrl/⌘ + Enter work on the Create page only.

## A song in the library

![A song row with numbered buttons](images/song-row.png)

| # | Button | What it does |
|---|---|---|
| 1 | **Play** | play, with waveform in the player at the bottom |
| 2 | **Star** | mark as favorite |
| 3 | **WAV / MP3** | download the song |
| 4 | **TXT** | show the lyrics the model wrote (only for songs with vocals) |
| 5 | **Folder** | move to a folder |
| 6 | **Plus** | another version with a new seed |
| 7 | **Arrow** | copy the settings back into the form, with a new random seed (to get the very same song again, enter the old seed under Advanced) |
|   | **Thumb down** | hide a miss: it disappears from the list but is kept. The crossed-out eye next to the search shows hidden songs again; there the same button brings a song back. |
|   | **Crossed arrows** | cross two songs: click it on the first song, then on a second one. The form gets the style of the first and the scene of the second. Esc cancels. |
| 8 | **Cross** | delete, or cancel a running song |

**Comparing versions:** while a song with several versions (A, B, C …) is playing, the player shows their letters. Click one (or press **C**) and that version continues at the same position, so you hear the difference directly.

**Repaint a section:** ⋮ › **Repaint section** opens the song's waveform. Drag across it to choose the part to
regenerate (at least 2 seconds; drag an edge to adjust it, click to play from that spot, ▶ plays the section with a
second of lead-in). Change the description or the lines of the lyrics in that section if you like, choose 1–3
versions and click **Repaint**. Everything outside the section stays exactly as it was. The result is a new version
of the song (B, C …) with "repainted 1:40–1:55" in its line, so you can compare it with the original at the same
spot. It takes about as long as generating the whole song, because the sound model goes over the full length. The
plus button on a repainted version repaints the same section again with a new seed. Deleting the original before a
waiting repaint has started makes that repaint fail.

**The dice learn from your favorites:** terms that appear in the style or prompt of songs with a star come up more often when rolling.

Click a title to rename it. The line below shows **BPM · IT** (iterations) **· VAR** (variance) · key · length.
“Created in …” disappears once you play the song for the first time.

## Single tracks

Three features work with single instrument tracks (stems). They need the **track model** (2.5 GB): the installer asks
for it (or `install --stems`), the Mac app downloads it under **Gear › Track model**. Without it they are greyed out.
There is also an **XL track model** (5.3 GB, 4 instead of 2 billion parameters, about twice as long): add it with
`install --xl-stems` or, in the Mac app, under **Gear › Track model**. Standard stays the default: in a listening test
its drums came out cleaner.
Each track takes about as long as a whole song of the same length.

- **Track by track** (Create › Generation): a new song built instrument by instrument, each track fitting the ones
  before. The mix is exactly the sum of the tracks. If it stops (error, cancel, restart), **Retry** keeps the finished
  tracks and continues with the first missing one.
- **Stem Separation** (library, ⋮ menu of a song): split a finished song into tracks. **Demucs · 4 stems** (best quality:
  drums, bass, vocals, other) or **Demucs · 6 stems** (adds guitar and piano) split the actual mix, all tracks in one
  pass; WAV songs only. On a Mac both run on the GPU, a 2–3 minute song in about 10–15 seconds. Gear › Demucs ›
  **Computes on** switches to the CPU: for 4 stems just as fast and accurate, for 6 stems about half as fast but a
  little more accurate, mainly on the bass. Linux uses the CPU (minutes per song). In the Mac app and the Debian
  package, download the Demucs models once under Gear › Demucs (Mac 710 MB, Linux 390 MB). **ACE-Step** re-generates 2, 4 or 6 tracks with the track model, so they follow the
  song but are no exact split of the mix.
- **Replace / accompany** (tab **Replace**): upload a file and replace chosen instruments, or add new accompaniment
  tracks to a single take, for example vocals. The upload is ready at once; length comes from the file. **Detect tempo
  and key** is optional and fills BPM, key, time signature and a short genre, not the full description.

Songs with tracks get a **Tracks** button (play, download each track, all as ZIP) and a **Mixer** (waveform, volume,
mute and solo per track). The mixer downloads each track (**↓**), all tracks as **ZIP**, or the **Mix** exactly as it
sounds with the current settings. Replace and accompany keep your upload as **Original**: playable and downloadable in
the track list, a channel in the mixer (muted after replacing, for comparing) and part of the ZIP.
**+ Track** below the mixer's tracks adds an instrument the song does not have yet: pick it, add wishes as for a new
version if you like, and **Generate**. The new track hears all other tracks in their selected version (mute and solo
do not matter). Like a new version it changes the mixer, the mix download and the ZIP, not the song in the library.
Vocal tracks need a song with lyrics. An added track can be deleted again with ✕.
Details: [docs/stems.md](../stems.md) (German).

## Folders

![The folder bar](images/folders.png)

Create a folder with **+**. Drag songs onto a folder, or move them with the folder button of the song row
(each version separately). Clicking a folder shows only its songs; new songs land in the folder that is currently open.
**Download all** or **Download folder** downloads the finished songs of the view as a ZIP.
Deleting a folder removes only the folder, not the songs.

## Settings

Open them with the **gear** at the top right.

| Setting | Meaning |
|---|---|
| **Synthesis server / Language model server** | Addresses of the model servers. The installer sets them, normally there's nothing to change. |
| **Timeout** | How long a song may take before it is aborted (minutes). |
| **Sound model** | Standard or, if installed, XL (better sound, about twice as slow). |
| **Output format** | File format of new songs: **WAV 16 bit** (default, lossless, plays everywhere), **WAV 24 bit** or **WAV 32 bit float** for further editing (larger files), **MP3** with 320, 192 or 128 kbit/s to save space. |
| **Song folder** | Where finished songs are stored, see below. |
| **Version** | Check for updates and install them. |
| **Servers** | Stop the app and the model servers. |

## Where the songs are

Finished songs are stored in the subfolder `data/songs` of the program folder, i.e. `~/soniq/data/songs` on
the Mac or `C:\Users\<Name>\soniq\data\songs` on Windows. The file names are IDs; the titles live in the app.

To use a different place, go to **Gear › Song folder**, enter a full path and save. The app creates the folder and
moves the existing songs there. Leaving the field empty means back to default.

## Updating

In the app: **Gear › Check for updates › Update now**. The app fetches the new version from GitHub and restarts;
your songs are kept. If it reports a new installer version, run **install** once afterwards.

**Mac app (SONIQ.app):** at start the app looks for a new version on GitHub; if there is one, the gear gets a dot.
**Gear › Check for updates** then shows what is new and **Download new version**: open the DMG and drag SONIQ to
Applications (replace). Songs, settings and models stay in `~/Library/Application Support/SONIQ`.
In the Mac app, a missing XL sound model can be downloaded under **Gear › Sound model**, the track model under
**Gear › Track model**.

---

Something not working? See [Help](troubleshooting.md).
