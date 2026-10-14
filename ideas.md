# Ideas

Ideas for better UX and creativity, with their status. Sorted by group, the number stays fixed so ideas
can be referenced ("idea 6").

Status: ✅ done · 🚧 in progress · 💡 open

## Quick wins

| # | Idea | Status | Notes |
|---|---|---|---|
| 1 | **Dice history (undo):** a ↶ next to "Random" to get the previous prompt/style back | 💡 | |
| 2 | **Lock fields:** a lock on Prompt and Style; "Random" and "Variation" only change unlocked fields | ✅ | Lock buttons next to the dice. Remembered per browser (`localStorage` key `lockedFields`). The single dice still work on locked fields. |
| 3 | **"More like this" on every song:** new versions with the same settings and a new seed | ✅ | Already existed as the ＋ button on each song row (`library-store.ts` → `generateAnother`): one more version in the same group (next letter). Possible follow-up: make it easier to spot, or let it use the versions slider. |
| 4 | **Themed random:** dice packs like "Film score", "Club", "Lo-fi study", "80s" | 💡 | |
| 5 | **Keyboard shortcuts:** `R` random, `Ctrl+Enter` generate, space play/pause, `J`/`K` next/previous | 💡 | |

## Creativity

| # | Idea | Status | Notes |
|---|---|---|---|
| 6 | **Variation instead of re-rolling:** change prompt and style only slightly | ✅ | "Variation" button next to "Random". Prompt: swaps one known building block (mood, scene, detail); free text stays and gets a detail appended. Style: usually swaps one known tag for another of the same kind, sometimes adds an instrument or mood. Logic in `random-content.ts` (`varyPrompt`, `varyStyle`). |
| 7 | **Cross two songs:** style of A + scene of B as a new prompt | 💡 | |
| 8 | **Style sliders:** calm ↔ energetic, acoustic ↔ electronic, dark ↔ bright, writing matching words into the style | 💡 | |
| 9 | **Visible prompt building blocks:** mood, scene, detail as three small pickers, each can be rolled on its own | 💡 | |
| 10 | **More from the analysis:** "similar but different" (same tempo and key, rolled style) | 💡 | |

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
