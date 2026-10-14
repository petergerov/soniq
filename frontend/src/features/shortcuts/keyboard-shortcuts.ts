// Tastenkürzel: R Zufall, V Variation, U Würfeln zurücknehmen, Strg/⌘+Enter Generieren,
// J/K nächster/vorheriger Song, C nächste Version (A/B-Vergleich), Leertaste startet den ersten Song (danach übernimmt der Player sie).
import type { Song } from "../../../../shared/api.ts";
import { closest } from "../../core/dom.ts";
import type { PlaybackState } from "../library/song-list.ts";

export interface ShortcutDeps {
  form: { random(): void; vary(): void; undo(): void; submit(): void };
  playback: PlaybackState;
  /** Songs in der angezeigten Reihenfolge */
  songs: () => readonly Song[];
  play: (song: Song) => void;
  /** A/B-Vergleich: zur nächsten Version desselben Prompts an derselben Stelle */
  nextVersion: () => void;
  /** Formular-Kürzel (R, V, U, Strg/⌘+Enter) nur auf der Seite „Erzeugen“ */
  formVisible: () => boolean;
}

export function bindKeyboardShortcuts(deps: ShortcutDeps): void {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    // Generieren geht auch beim Tippen im Formular
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      if (document.querySelector("dialog[open]") || !deps.formVisible()) return;
      e.preventDefault();
      deps.form.submit();
      return;
    }
    // Einzelne Tasten nur, wenn gerade nicht getippt wird und kein Dialog offen ist; Strg+R usw. bleiben beim Browser
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (closest(e.target, 'input, textarea, select, [contenteditable="true"]') || document.querySelector("dialog[open]")) return;
    const action = actionFor(e, deps);
    if (!action) return;
    e.preventDefault();
    action();
  });
}

function actionFor(e: KeyboardEvent, deps: ShortcutDeps): (() => void) | null {
  const key = e.key.toLowerCase();
  if (["r", "v", "u"].includes(key) && !deps.formVisible()) return null;
  switch (key) {
    case "r": return () => deps.form.random();
    case "v": return () => deps.form.vary();
    case "u": return () => deps.form.undo();
    case "j": return () => step(deps, 1);
    case "k": return () => step(deps, -1);
    case "c": return () => deps.nextVersion();
  }
  // Leertaste: Läuft schon ein Song, kümmert sich der Player darum
  if (e.code === "Space" && !deps.playback.currentId && !closest(e.target, 'button, a, [role="button"]')) return () => step(deps, 1);
  return null;
}

/** Nächsten (1) oder vorherigen (-1) fertigen Song abspielen; ohne aktuellen Song beginnt J oben, K unten. */
function step(deps: ShortcutDeps, direction: 1 | -1): void {
  const playable = deps.songs().filter((s) => s.status === "done" && s.url);
  if (!playable.length) return;
  const index = playable.findIndex((s) => s.id === deps.playback.currentId);
  const next = index < 0 ? (direction === 1 ? 0 : playable.length - 1) : index + direction;
  const song = playable[next];
  if (song) deps.play(song);
}
