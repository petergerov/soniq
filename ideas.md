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
