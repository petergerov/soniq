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

## Compare and choose

| # | Idea | Status | Notes |
|---|---|---|---|
| 11 | **A/B comparison:** switch between versions of one prompt at the same playback position | 💡 | |
| 12 | **Quick rating:** 👎 / hide to sort out misses without deleting; the dice could learn from favorites | 💡 | |
| 13 | **Waveform in the player:** see build-ups, drops and quiet parts, jump directly | ✅ | Already existed: the player bar uses WaveSurfer (`audio-player.ts`). |

## Workflow

| # | Idea | Status | Notes |
|---|---|---|---|
| 14 | **Queue with time estimate:** "about 3:20 left" per song, from past run times | 💡 | |
| 15 | **Notify when done:** browser notification or short sound | 💡 | |
| 16 | **Presets:** save the current settings (style, length, tempo, vocals) under a name and load them with one click | 💡 | |
