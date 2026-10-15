# New features: separate tracks

Plan for three related features. All of them work with **single instrument tracks (stems)** and use task types of
ACE-Step 1.5 that SONIQ did not use before. Experiments in
[Background](#background-what-acestepcpp-can-do) were run on 2026-10-14.

| # | Feature | In short | Status |
|---|---|---|---|
| B | **Track by track** | Generate a new song as separate tracks, one after the other, each fitting the ones before. The mix is the sum of the tracks. | ✅ done |
| A | **Extract tracks** | Pull single tracks out of a finished song from the library. | ✅ done |
| C | **Replace instruments / new accompaniment** | Upload a file; **extract the keepers first**, then `lego` replacements on their sum (or accompany an isolated take). | ✅ done |

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
  ("extracted", "replacement" …). **"Mixer"** opens `#/mixer/:songId`: waveforms, volume, mute and solo per track,
  synced playback (main player bar hidden while on that page).
- **Replace / accompany** is its own page `#/replace` (nav tab), not part of Create — upload, choose replace vs
  accompany, keepers/new tracks, then queue.
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

**Clean tracks (2026-10-15).** With the whole song style in every track's caption, the first track (drums on
silence) came out as a mini mix with bass and vocals ("Acoustic Male" preset: "… upright bass … male vocals").
Measured with that preset, 30 s, several seeds:
- Caption (`legoCaption` / `styleForTrack` in `domain/stem.ts`): only the style parts that fit the track: mood, genre
  and scene stay; vocal parts (also "singer-songwriter", voice ranges, "choir") only for vocal tracks; instrument parts
  only for their own track ("upright bass" stays with the bass); sound words of the style slider (acoustic, organic,
  electronic, synthetic) are dropped; instrument tracks end with "instrumental" (works better than "no vocals").
  Drums, tonal share 200–3000 Hz, mean of 3 seeds: whole style 0.140, filter with "no vocals" 0.096, this 0.064.
- `guidance_scale` 5 for `lego` (`LEGO_GUIDANCE` in `domain/music-engine.ts`; 1.0 = CFG off was the default):
  bass on drums, energy above 400 Hz, 2 seeds: 1.0 → 0.076, 3.0 → 0.033, 5.0 → 0.011 (a good bass: 0.019);
  the caption variants made almost no difference. About 45 % more time per track. `extract` stays at 1.0 (untested).
- Lyrics for the vocal track: the plan uses `lm_mode: "generate"` (see step 2 notes), `"inspire"` often returned
  `[Instrumental]`.
End to end (drums, bass, guitar, vocals, 30 s): drums 0.018 (tonal), bass 0.005 (above 400 Hz), 4:13 in total.

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

**Decision (user, 2026-10-15):** for a mixed song, **separate first, then replace**. `lego` directly on the
full mix does not follow the song (experiment C1). `extract` follows the song (experiment A). `lego` on a
**sum of clean tracks** locks (experiment B). So the backing for a replacement is the extracted keepers, not
the upload.

**Interface:** new area on the Create page **"Replace / accompany"** with a drop zone (WAV, MP3, M4A, FLAC, OGG like
the analysis), then:
- **What do you want?**
  - **Replace instruments** (upload is a mix): choose which instruments to replace (chips). The others are
    extracted and kept. No **"All"** — that is a new arrangement and belongs to track-by-track (B), using
    style/tempo/key from the analysis.
  - **New accompaniment** (upload is already a single take): choose which instruments to add. No extract.
- Style / prompt for the new tracks (filled from the analysis of the file, editable).
- Result is a new library entry ("Replacement for …" / "Accompaniment for …") with the original, extracted
  keepers, replacements, and the mix.

**Flow, replace instruments** (chosen set R, keepers K = the other tracks the user wants to keep):
1. Analysis of the upload (`/understand`, exists): BPM, key, caption, length.
2. `extract` each keeper K (feature A). Honest label: re-generated, not a lossless split.
3. For each replacement X in R, in order (rhythm first): `lego` with backing = **sum of extracted keepers +
   replacements so far**. Caption = track description + style; BPM, key, time signature, length from step 1.
4. Mix = extracted keepers + new replacements (peak normalized). The upload is stored but not in the mix, so
   the old X is gone.
5. Optional later: `repainting_start` / `repainting_end` for a part of the song only.

**Cost:** one extract per keeper + one `lego` per replacement (~75 s per track per minute). Replacing guitar
in a five-track song ≈ four extracts + one lego.

**Flow, new accompaniment:**
- Default: `lego` for each chosen instrument, one after the other like feature B, first backing = the upload
  (already isolated).
- Optional later: one `complete` (`"DRUMS | BASS | GUITAR"`) as a faster one-mix pass, if a listening test
  prefers it.

**Experiment C1 — replace all** (2026-10-14, base model, `lego` per track, backing = full mix of
"Cajun Moon", ~2:28). Seven tracks independently on the same upload (not sequential like B): drums, percussion,
bass, guitar, keyboard, vocals, backing vocals. Files: `tmp/CajunMoon.m4a`, `tmp/generated/96ca0d9bce70.*.wav`.

| Track | Level | Bleed of original | Corr vs original | Onsets vs original |
|---|---|---|---|---|
| drums | −16.9 dB | 0.00 | 0 | **off** (−245 ms) |
| percussion | −22.4 dB | 0.00 | 0 | +43 ms |
| bass | −25.6 dB | 0.00 | 0 | **off** (+96 ms) |
| guitar | −20.8 dB | 0.00 | 0 | **off** (+203 ms) |
| keyboard | −21.0 dB | 0.00 | 0 | **off** (+160 ms) |
| vocals | −19.8 dB | 0.00 | 0 | **off** (−139 ms) |
| backing vocals | −14.9 dB | 0.00 | 0 | **off** (+224 ms) |
| sum of the seven | −16.9 dB | 0.00 | 0 | **not** the song (difference louder than the mix) |

→ `lego` still returns **clean** tracks (no original in the output), same as B. They do **not** follow the song
and do **not** lock to each other (pairwise corr ≈ 0). Bass has almost no sub energy. Listening: **not
convincing** (user, 2026-10-14).

→ Do not `lego` a replacement on the full mix. **Extract keepers, then `lego` the new track on their sum**
(user, 2026-10-15). "Replace all" is out (that is B). "Original + new X" is out (old X stays, and the new
track does not follow).

**Still to try** (accompaniment only): isolated take as upload, add drums/bass/keyboard with `lego` one after
the other (like B) and once with `complete`. Compare.

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
model: `lm_mode: "generate"` when lyrics have to be written (like a whole song, ~10 s per 30 s of music; `"inspire"`
would be faster but chose `[Instrumental]` in 3 of 4 tries with the "Acoustic Male" preset), otherwise `"format"`
(~3 s, no audio codes). Tracks and mix are always WAV
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
| 4 | ✅ **A**: extract in the worker + "Extract tracks …" in the track list | 1, 3 |
| 5 | ✅ Experiment **C**: replace-on-mix rejected; **extract then replace** decided | 1 |
| 6 | ✅ **C**: upload area, replace = extract keepers then lego; accompany = lego on the take | 4, 5 |
| 7 | Base model for everyone: installer question / `--stems`, Mac app button, guide (`docs/guide`), README | 1 |

## Open questions

- Track order in B: fixed (as above) or user-defined order? Own description per track?
- C accompaniment: sequential `lego` vs one `complete`?
- Length limit for track-by-track and uploads (time grows with length × number of tracks)?
- Do the tracks count against the song folder size display and the library ZIP ("Download all")?
