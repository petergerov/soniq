# Ideas

Ideas for better UX and creativity, with their status. Sorted by group, the number stays fixed so ideas
can be referenced ("idea 6").

Status: ✅ done · 🚧 in progress · 💡 open

## Quick wins

| # | Idea | Status | Notes |
|---|---|---|---|
| 1 | **Dice history (undo):** a ↶ next to "Random" to get the previous prompt/style back | ✅ | ↶ button left of "Random", key `U`. Remembers prompt and style before every Random, Variation and prompt/style dice roll (up to 30 steps, per page load). Disabled when there is nothing to undo. |
| 2 | **Lock fields:** a lock on Prompt and Style; "Random" and "Variation" only change unlocked fields | ✅ | Lock buttons next to the dice. Remembered per browser (`localStorage` key `lockedFields`). The single dice still work on locked fields. |
| 3 | **"More like this" on every song:** new versions with the same settings and a new seed | ✅ | Already existed as the ＋ button on each song row (`library-store.ts` → `generateAnother`): one more version in the same group (next letter). Possible follow-up: make it easier to spot, or let it use the versions slider. |
| 4 | **Themed random:** dice packs like "Film score", "Club", "Lo-fi study", "80s" | ✅ | Theme picker left of the ↶ button: All, Film score, Club, Lo-fi, 80s, Acoustic, Ambient, Hip-hop. Applies to Random, Variation, the prompt/style dice, the prompt building blocks and "Similar but different". Remembered per browser (`diceTheme`). Themes live in `random-content.ts` (`THEMES`). |
| 5 | **Keyboard shortcuts:** `R` random, `Ctrl+Enter` generate, space play/pause, `J`/`K` next/previous | ✅ | Plus `V` variation and `U` undo. Single keys are ignored while typing or with a dialog open; `Ctrl/⌘+Enter` also works in text fields. Space starts the first song when nothing is playing. Code: `features/shortcuts/keyboard-shortcuts.ts`; listed in `docs/guide/using-the-app.md`, hints in the tooltips. |

## Creativity

| # | Idea | Status | Notes |
|---|---|---|---|
| 6 | **Variation instead of re-rolling:** change prompt and style only slightly | ✅ | "Variation" button next to "Random". Prompt: swaps one known building block (mood, scene, detail); free text stays and gets a detail appended. Style: usually swaps one known tag for another of the same kind, sometimes adds an instrument or mood. Logic in `random-content.ts` (`varyPrompt`, `varyStyle`). |
| 7 | **Cross two songs:** style of A + scene of B as a new prompt | ✅ | Cross button on every song row: click it on song A (row gets a frame), then on song B; Esc or clicking A again cancels. The form gets the style of A and the prompt of A with the scene of B. Without a recognized scene in B, the whole prompt of B is used; without a style in A, the whole description of A. Can be undone with ↶. |
| 8 | **Style sliders:** calm ↔ energetic, acoustic ↔ electronic, dark ↔ bright, writing matching words into the style | ✅ | Three sliders below the style field (`style-axes.ts`, `style-axis-sliders.ts`), five steps each, the middle writes nothing. Words: very calm / calm / energetic / high energy, fully acoustic / organic / electronic / synthetic, very dark / dark / bright / sunny. The sliders follow the style text when you type. |
| 9 | **Visible prompt building blocks:** mood, scene, detail as three small pickers, each can be rolled on its own | ✅ | Row below the prompt (`prompt-blocks.ts`). Each picker shows the block it recognizes in the prompt text ("—" if none), offers the entries of the current theme and has its own dice. Choosing writes only that part; your own text stays. "—" removes the block. Changes can be undone with ↶. |
| 10 | **More from the analysis:** "similar but different" (same tempo and key, rolled style) | ✅ | Button under the upload field, appears after an analysis. Each click restores tempo, key, time signature, length, vocals and description from the last analysis and rolls a new style from the current theme (locks respected). |
| 18 | **Choose the voice:** female / male / duet and a type of voice | ✅ | In song mode under Language: Auto, Female, Male, Duet and a list with range (soprano … bass) and character (soft, powerful, breathy, raspy, soulful, falsetto, whispered, operatic, rap, choir, Auto-Tune). Like the style sliders it writes English words into the style (`voice.ts`, `voice-picker.ts`) and follows the style text; saved with presets, undo with ↶. The dice roll a voice too in song mode: Random adds female/male (duet 15 %) and in half the rolls a type, Variation can swap them (`VOICE_POOL` in `random-content.ts`). |

## Compare and choose

| # | Idea | Status | Notes |
|---|---|---|---|
| 11 | **A/B comparison:** switch between versions of one prompt at the same playback position | ✅ | Letter buttons A, B, C … in the player bar while a song with several finished versions plays; key `C` cycles. The new version continues at the same position (and stays paused if paused). Versions come from the current library view. |
| 12 | **Quick rating:** 👎 / hide to sort out misses without deleting; the dice could learn from favorites | ✅ | Thumb-down button on finished songs sets `hidden` (new DB column, `PATCH /api/songs/:id {hidden}`); the library leaves them out unless the eye button next to the search is on (`GET /api/songs?hidden=true`). Learning: terms from style and prompt of all favorites are picked more often by every dice (20 % chance per pick when a list contains one, `PREFER_CHANCE` in `random-content.ts`). |
| 13 | **Waveform in the player:** see build-ups, drops and quiet parts, jump directly | ✅ | Already existed: the player bar draws its own waveform (`waveform.ts`). |

## Workflow

| # | Idea | Status | Notes |
|---|---|---|---|
| 14 | **Queue with time estimate:** "about 3:20 left" per song, from past run times | ✅ | Running and waiting songs show "~2:10 left" / "done in ~6:40"; the Library tab tooltip shows when everything is done. Learned as the median of computing seconds per second of music over the last 20 finished songs (`domain/queue-estimate.ts`); songs without a fixed length use the typical length. New column `started_at`; older songs fall back to the end of the previous song. `GET /api/queue` returns `estimates` (song id → seconds). |
| 15 | **Notify when done:** browser notification or short sound | ✅ | Bell button in the header, remembered per browser (`notify`). Short chime (up = done, down = error, nothing when cancelled); browser notification only while the tab is in the background, click opens the library. Code: `features/status/notifier.ts`. |
| 16 | **Presets:** save the current settings (style, length, tempo, vocals) under a name and load them with one click | ✅ | Row at the top of the form: picker, Save, ✕. Saves everything except prompt, title, lyrics and seed (incl. dice theme). Stored on the server (`settings` key `presets`, `/api/presets/:name` GET/PUT/DELETE), same name (case-insensitive) overwrites. ↶ after loading restores only the style (undo history holds prompt and style). |

## Structure

| # | Idea | Status | Notes |
|---|---|---|---|
| 17 | **Library on its own page:** form and library were too much for one screen | ✅ | Two pages with tabs in the header: Create (`#/`) and Library (`#/library`), see `core/router.ts`. The library tab shows the number of running and waiting songs. Reuse and Cross switch to Create. Replaces the former Layout setting (stacked / side by side). |

## Edit and transform songs

Ideas 19–25 come from [Ace-Step-Web](https://github.com/Saganaki22/Ace-Step-Web) (2026-10-18). acestep.cpp already
supports everything they need (`src/task-types.h`, `tools/ace-server.cpp`), SONIQ does not use it yet.

| # | Idea | Status | Notes |
|---|---|---|---|
| 19 | **Repaint a section:** regenerate only seconds X–Y of a song, optionally with new lyrics or caption | ✅ | Song menu ⋮ › "Repaint section" opens a dialog with the waveform: drag to select (min. 2 s, `MIN_REPAINT_SECONDS`), edges adjustable, ▶ plays the section, description and lyrics editable, 1–3 versions (`features/repaint/repaint-dialog.ts`). `POST /api/songs/:id/repaint` queues new songs in the group (`mode: "repaint"`, `params.repaint` = source song id + region); the worker reads the source file only when it runs (`services/repaint.ts`) and sends `task_type: "repaint"` to the standard sound model, no language model. Measured 2026-10-18 on "Amber Echoes" (2:45): outside the region identical to the original (difference −100 dB), seams within the normal sample-to-sample range (no crossfade needed), about 4 min, as long as a full song. ＋ on a repainted version repaints the same region again; Stem Separation works on it. Possible follow-ups: snap the selection to bars (BPM is known), select directly on the player waveform, outpainting (extend the song: negative start / end past the length). |
| 20 | **Cover / remix:** a library song or an uploaded file in a new style | 💡 | `task_type: "cover"`, `audio_cover_strength` (how far from the source, default 1.0), `cover_noise_strength`. "Cover…" in the song menu (source = that song) and as an option next to the analysis upload. Dice, style sliders and themes work on the new style as usual. |
| 21 | **Reference audio:** "make it sound like this file" | 💡 | Optional `ref_audio` part on `/synth` (timbre reference, shared by every request of a batch). Next to the upload on Create; the analysis takes tempo and key from a file, the reference would carry its sound as well. |
| 22 | **Example songs:** read-only starter presets with full caption and tagged lyrics | 💡 | Ace-Step-Web ships 14 genre examples (funk rock, hip hop, lo-fi, phonk, chiptune …). A few in the preset picker (idea 16), marked as built-in, show beginners what a good caption and `[Verse]` / `[Chorus]` lyrics look like, which the dice do not. Translated names, English content. |
| 23 | **Advanced sampling:** LM top-p / top-k / CFG / negative prompt, DiT solver | 💡 | Request fields `lm_top_p` (0.9), `lm_top_k` (0 = off), `lm_cfg_scale`, `lm_negative_prompt`, `solver` (`euler` default, `sde`, `dpm3m`, `stork4`). Collapsed "Advanced" block in the form, shown in the song row's parameter summary like the temperature. Low priority for most users. |
| 24 | **ⓘ help on every control:** a short explanation next to each field and slider | 💡 | Ace-Step-Web has one on nearly every control. Check which SONIQ controls still lack a tooltip; texts in all 12 languages. |
| 25 | **LoRA adapters:** pick a style adapter and its strength | 💡 | Not from Ace-Step-Web. acestep.cpp loads PEFT, ComfyUI and LyCORIS adapters from `--adapters <folder>`, per request `adapter` and `adapter_scale` (default 1.0), see `engine/acestep.cpp/adapters/README.md`. Gear › Adapters (folder, list) and a picker in the form; saved with presets. |
