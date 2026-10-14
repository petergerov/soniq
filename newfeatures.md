# New features: separate tracks

Plan for three related features. All of them work with **single instrument tracks (stems)** and use task types of
ACE-Step 1.5 that SONIQ does not use yet. Nothing here is built yet; the experiments in
[Background](#background-what-acestepcpp-can-do) were run on 2026-10-14.

| # | Feature | In short | Status |
|---|---|---|---|
| B | **Track by track** | Generate a new song as separate tracks, one after the other, each fitting the ones before. The mix is the sum of the tracks. | 💡 planned |
| A | **Extract tracks** | Pull single tracks out of a finished song from the library. | 💡 planned |
| C | **Replace instruments / new accompaniment** | Upload a file and generate replacement tracks for chosen instruments (or all), or a new accompaniment around it. | 💡 planned, needs an experiment first |

Status: ✅ done · 🚧 in progress · 💡 open

---

## Background: what acestep.cpp can do

acestep.cpp (`engine/acestep.cpp`, see `docs/ARCHITECTURE.md` there) has, besides `text2music`, three task types for
single tracks. They are sent to `POST /synth` as `task_type` together with `track` and a source file (`audio`):

| Task | Input | Output | Used for |
|---|---|---|---|
| `lego` | a backing track + `track` | a **new** track of that instrument that fits the backing | B, C |
| `extract` | a mixed song + `track` | that instrument, isolated (re-generated, not cut out) | A, C |
| `complete` | a single isolated track + `track` (one or several, e.g. `"DRUMS \| BASS"`) | a full mix built around it | C |

Track names (fixed list in `src/task-types.h`): `vocals`, `backing_vocals`, `drums`, `bass`, `guitar`, `keyboard`,
`percussion`, `strings`, `synth`, `fx`, `brass`, `woodwinds`. Other names only give a warning.

`lego`, `extract` and `complete` need the **base model** `acestep-v15-base-Q8_0.gguf` (2.55 GB, same Hugging Face
revision as the other models, SHA-256 `10329f32…ee150`). SFT and turbo are not trained for them. `lego` also takes an
optional region (`repainting_start` / `repainting_end`) to generate the new track only in part of the song.

### Experiments (2026-10-14, base model, 50 steps, 60 s of audio, Apple Silicon)

Files in `data/stem-test/` (not in the repo). Scripts: `stems.py` (requests) and `rhythm.py` (tempo and onset
alignment), kept in the session scratchpad.

**A — extract** from "Amber Echoes" (acoustic, male vocals, upright bass, acoustic guitar):

| Track | Time | Level | Onsets vs original |
|---|---|---|---|
| vocals | 76 s | −17.1 dB | in time (0 ms) |
| bass | 74 s | −18.9 dB | in time (0 ms) |
| guitar | 75 s | −20.9 dB | in time (0 ms) |
| sum of the three | – | – | **not** the original: overlapping content, difference almost as loud as the song (−18.3 dB vs −16.7 dB) |

→ The tracks are re-generated: they follow the song but are no clean, lossless split.

**B — track by track** with `lego`, new song (100 BPM, G major), each track on top of the sum of the ones before,
first one on silence:

| Track | Share of the backing in the output | Tempo | Onsets vs drums |
|---|---|---|---|
| drums (on silence) | – | 50 BPM (half time of 100) | – |
| bass | 0.02 | 102 BPM | in time (−10 ms) |
| guitar | 0.00 | 133 BPM | **off** (−340 ms) |
| vocals | 0.02 | 50 BPM (half time) | in time (−20 ms) |

→ `lego` returns **clean single tracks** (the backing is not in the output), so the mix is exactly their sum.
Bass and vocals locked to the drums, the guitar did not. Drums from silence were rather quiet (−21 dB).
Listening test: **sounds good** (user, 2026-10-14).

**Cost:** about **75 s per track per minute of music**. A 2:30 song with five tracks ≈ 15 minutes.

---

## Shared building blocks

Used by all three features; built once, in the first step that needs them.

- **Base model** in the model catalog (`scripts/common.sh`, `MODEL_FILES`) as an optional file like XL.
  - Installer (Mac, Windows, Linux): extra question "Download the track model (2.5 GB)?" and option `--stems` / `-Stems`.
  - Mac app: button "Download track model (2.5 GB)" in the settings, through the existing setup (progress, checksum,
    model server restart), like the XL button.
  - Without the file: the features are greyed out with a hint how to get it.
  - Model server: it lists models only at start, so it is restarted after the download (Mac app: automatic;
    project folder: `stop` / `start`, the installer does it).
- **Tracks table** `stems`: `id`, `song_id`, `track`, `kind` (`generated` / `extracted` / `replacement` /
  `accompaniment`), `status` (`queued` / `running` / `done` / `error`), `file`, `message`, `position` (order),
  `created_at`, `finished_at`. Files next to the song: `<song id>.<track>.wav` in the song folder.
  Deleting a song deletes its tracks.
- **Engine** (`ace-step-engine.ts`): new methods `lego(backing, track, request)`, `extract(song, track, request)`,
  `complete(stem, tracks, request)`; all post multipart (`request` JSON + `audio` file) to `/synth` with
  `synth_model` = base model. Shared helper for mixing (sum of tracks, peak normalized, same length).
- **Queue**: track jobs run in the existing worker one after another. Progress text like "Track 2/5: bass · 1:23".
  Cancelling stops the current track and drops the rest. The time estimate counts each track as one synthesis pass
  (`queue-estimate.ts` learns a separate rate for track jobs).
- **Track list on a song** (library): button **"Tracks"** on every song that has tracks. It opens a list under the
  row: per track play (in the player bar), download, and **"All as ZIP"** (existing `ZipResponse`). Labels per kind
  ("extracted", "replacement" …).
- **API** (sketch): `GET /api/songs/:id/stems`, `GET /api/songs/:id/stems/:stem/audio`, `GET /api/songs/:id/stems.zip`,
  `POST /api/songs/:id/stems` (extract), `POST /api/stems/upload` (feature C), `DELETE /api/stems/:id`.
- **Translations**: all new texts in the 12 interface languages.

---

## B — Track by track

**Goal:** a new song as separate tracks, without separating afterwards, so no quality is lost.

**Interface (form):**
- New switch **"Whole song | Track by track"** above "Generate".
- With "Track by track": choice of tracks as chips from the 12 names, in a fixed order (rhythm first):
  drums → percussion → bass → guitar → keyboard → synth → strings → brass → woodwinds → fx → vocals → backing vocals.
  Default: drums, bass, guitar, keyboard; in song mode also vocals. "Vocals" only in song mode.
- Style, prompt, BPM, key, length and the other fields work as before.
- The generate button shows the estimated time (e.g. "5 tracks · about 12 min").

**Flow (worker):**
1. Language model as today (`/lm`): plans BPM, key, time signature, length and, if empty, the lyrics, so that all
   tracks share them. The audio codes are not used.
2. For every chosen track, in order: `lego` with the sum of the tracks so far as backing (first track: silence of
   the song length). Caption = track description + style, e.g. "bass, warm electric bass line, upbeat indie pop";
   lyrics only for vocals, otherwise `[Instrumental]`; BPM, key, time signature, length from step 1.
3. Save each track, mix = sum of all tracks (peak normalized) as the song's normal file. Playing, A/B compare,
   download, presets and reuse keep working unchanged.

**To try in this step** (guitar was off-beat in the experiment): always send `timesignature`; more steps for
melodic tracks; an order with keyboard or guitar before bass; describe the rhythm in the caption ("on the beat",
"eighth notes"). Measure with `rhythm.py`, then listen.

## A — Extract tracks

**Goal:** single tracks from a finished song (generated or uploaded via the analysis).

**Interface:** on normal songs the "Tracks" button offers **"Extract tracks …"**: choose tracks (chips, default
from the style text: e.g. "male vocals, upright bass" → vocals, bass), then they are queued. Result appears in the
track list, marked "extracted".

**Flow:** per track one `extract` with the song file (or the latent the server returned at generation, which skips
the VAE encode) and the song's caption. The song file stays unchanged.

**Honest label in the interface:** "re-generated by the model, the tracks are not an exact split of the mix"
(experiment A).

## C — Replace instruments / new accompaniment

**Goal:** upload any file (own recording or song) and let ACE-Step generate new tracks for it.

**Interface:** new area on the Create page **"Replace / accompany"** with a drop zone (WAV, MP3, M4A, FLAC, OGG like
the analysis), then:
- **What do you want?**
  - **Replace instruments**: choose which instruments get a replacement track (chips) or **"All"**.
  - **New accompaniment**: the file is e.g. vocals or a single instrument; choose which instruments to add.
- Style / prompt for the new tracks (filled from the analysis of the file, editable).
- Result is a new library entry ("Replacement for …" / "Accompaniment for …") with all tracks in the track list:
  the uploaded original, every new track, and the mixes (see below).

**Flow, replace instruments** (per chosen instrument X):
1. Analysis of the upload (`/understand`, exists): BPM, key, caption.
2. New X track with `lego`, backing = uploaded file. → "replacement X".
3. The original X is still inside the upload. Two results:
   - **"Original + new X"**: upload + new track (the old X stays audible).
   - **"Without original X"** (true replacement): sum of the *other* instruments, extracted with `extract` (feature A)
     plus the new X. Costs one extract per other instrument and carries the quality limits of experiment A.
   - With **"All"**: every chosen instrument gets a new track, each with `lego` over the upload; the mix of only the
     new tracks is a completely new arrangement of the song.
4. Option for a part of the song only: `repainting_start` / `repainting_end` (lego region), e.g. new guitar only in
   the chorus.

**Flow, new accompaniment:**
- Variant 1: `lego` for each chosen instrument, one after the other like feature B, first backing = upload.
- Variant 2: one `complete` with all chosen instruments (`"DRUMS | BASS | GUITAR"`): one pass instead of several,
  but returns one mix, not separate tracks.
- Default: variant 1 (separate tracks); variant 2 as a fast option if the experiment shows it sounds better.

**Experiment before building C** (like A and B):
1. Replacement: upload "Amber Echoes", new `guitar` (electric instead of acoustic) with `lego`: does it follow the
   song? Mix with the original and the "without original guitar" variant.
2. Accompaniment: the extracted vocals from experiment A as upload, add drums, bass, keyboard with `lego` one after
   the other and once with `complete`. Compare.
3. Measure (`rhythm.py`, level, share of backing), then listen.

---

## Order of work

Each step works on its own, is tested (API, browser, measurements) and committed separately.

Step 1 in the code: `scripts/common.sh` (base model, optional; installers and the app setup skip it by default),
`backend/src/infrastructure/wav.ts` (read / mix / write WAV), `domain/stem.ts`, `infrastructure/stem-repository.ts`,
`services/stem-service.ts`, `http/routes/stem-routes.ts` (`GET /api/songs/:id/stems`, `GET /api/songs/:id/stems.zip`,
`GET /api/stems/:id/audio`), engine methods `plan()` and `stem()` in `ace-step-engine.ts`, `stems_available` in the
settings. Deleting a song deletes its tracks.

Step 2 in the code: `services/track-by-track.ts`. `POST /api/generate` takes `mode: "tracks"` and `tracks: [...]`
(vocal tracks are dropped for instrumental songs, an error if the base model is missing). The plan uses the language
model without audio codes: `lm_mode: "inspire"` when lyrics have to be written (~15 s, the caption and length it
returns are ignored), otherwise `"format"` (~3 s) — the normal `generate` takes ~37 s. Tracks and mix are always WAV
(bit depth from the settings, 16 bit when MP3 is set). Progress "2/5 bass · 1:23"; cancel keeps finished tracks,
retry starts over. The time estimate counts each track as one pass (`units` in `queue-estimate.ts`).
Measured: 30 s song with drums, bass, vocals in 2:18.

Step 3 in the code: `features/generator/track-picker.ts` (switch "Whole song | Track by track" under Composition,
track chips in "rhythm first" order, vocals only in song mode, choice remembered per browser, taken over by "Reuse",
greyed out with a tooltip when the base model is missing); `song-row.ts` / `song-list.ts` (button "Tracks" on songs
with tracks, also while they are generated; list with play in the player bar, WAV download per track, ZIP of all;
reloads while generating). The library count only counts songs, track files only add to the size.
Not yet: presets do not store the generation mode and tracks.

| Step | Content | Depends on |
|---|---|---|
| 1 | ✅ Base model in the catalog; tracks table, storage, engine methods (`lego`, `extract`, mixing), API | – |
| 2 | ✅ **B** backend: track-by-track generation in the worker, time estimate | 1 |
| 3 | ✅ **B** interface: switch, track choice, track list on the song (play, download, ZIP) | 2 |
| 4 | **A**: extract in the worker + "Extract tracks …" in the track list | 1, 3 |
| 5 | Experiment **C**, then decide variants with the user | 1 |
| 6 | **C**: upload area, choice replace / accompany, instruments or "All", results | 4, 5 |
| 7 | Base model for everyone: installer question / `--stems`, Mac app button, guide (`docs/guide`), README | 1 |

## Open questions

- Track order in B: fixed (as above) or user-defined order? Own description per track?
- C "without original X": worth the extra extract passes, or offer only "original + new X"?
- Length limit for track-by-track and uploads (time grows with length × number of tracks)?
- Do the tracks count against the song folder size display and the library ZIP ("Download all")?
