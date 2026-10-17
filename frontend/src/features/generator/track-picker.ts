// Erzeugung: "Ganzer Song | Spur für Spur" und die Auswahl der Spuren (newfeatures.md, Feature B).
// Gesangsspuren nur bei Songs mit Gesang. Ohne Spuren-Modell (Base) ist "Spur für Spur" gesperrt.
import { STEM_TRACKS, type GenerationMode, type SongParams, type StemTrack } from "../../../../shared/api.ts";
import { byId, closest } from "../../core/dom.ts";
import { storage } from "../../core/storage.ts";
import { stemsMissingText } from "../../core/stems-hint.ts";
import type { Translate } from "../../i18n/i18n.ts";

const MODE_KEY = "genMode";
const TRACKS_KEY = "genTracks";
const VOCAL_TRACKS: readonly StemTrack[] = ["vocals", "backing_vocals"];
/** Vorauswahl beim ersten Mal; Gesang kommt im Song-Modus dazu */
const DEFAULT_TRACKS: readonly StemTrack[] = ["drums", "bass", "guitar", "keyboard", "vocals"];

export interface TrackPickerDeps {
  t: Translate;
  /** Ist gerade "Instrumental" gewählt? */
  instrumental: () => boolean;
}

export class TrackPicker {
  private readonly deps: TrackPickerDeps;
  private readonly buttons = document.querySelectorAll<HTMLButtonElement>("[data-genmode]");
  private readonly chips = byId("trackChips");
  private readonly hint = byId("trackHint");
  private mode: GenerationMode = storage.get(MODE_KEY) === "tracks" ? "tracks" : "full";
  private readonly chosen = new Set<StemTrack>(storage.getJson<StemTrack[]>(TRACKS_KEY, [...DEFAULT_TRACKS]).filter((t) => (STEM_TRACKS as readonly string[]).includes(t)));
  /** Spuren-Modell vorhanden? Bis die Einstellungen geladen sind: ja (der Server prüft ohnehin) */
  private available = true;

  constructor(deps: TrackPickerDeps) {
    this.deps = deps;
    this.buttons.forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.genmode === "tracks" ? "tracks" : "full")));
    this.chips.addEventListener("click", (e) => {
      const track = closest<HTMLElement>(e.target, "[data-track]")?.dataset.track as StemTrack | undefined;
      if (!track) return;
      if (!this.chosen.delete(track)) this.chosen.add(track);
      storage.setJson(TRACKS_KEY, [...this.chosen]);
      this.render();
    });
    // Instrumental/Song umgeschaltet: Gesangsspuren sperren bzw. freigeben
    document.querySelectorAll("[data-vocals]").forEach((b) => b.addEventListener("click", () => queueMicrotask(() => this.render())));
    this.render();
  }

  /** Für den Auftrag: Spur für Spur nur mit mindestens einer möglichen Spur. */
  get request(): { mode: GenerationMode; tracks?: StemTrack[] } {
    const tracks = this.tracks;
    return this.mode === "tracks" && this.available && tracks.length ? { mode: "tracks", tracks } : { mode: "full" };
  }

  /** Spuren-Modell da? (aus den Einstellungen) */
  setAvailable(available: boolean): void {
    this.available = available;
    this.render();
  }

  /** "Wiederverwenden": Erzeugung und Spuren eines Songs übernehmen. */
  apply(params: SongParams): void {
    this.mode = params.mode === "tracks" ? "tracks" : "full";
    if (params.mode === "tracks" && params.tracks?.length) {
      this.chosen.clear();
      params.tracks.forEach((t) => this.chosen.add(t));
      storage.setJson(TRACKS_KEY, [...this.chosen]);
    }
    storage.set(MODE_KEY, this.mode);
    this.render();
  }

  refreshTexts(): void {
    this.render();
  }

  /** Gewählte und mögliche Spuren in Reihenfolge "Rhythmus zuerst" */
  private get tracks(): StemTrack[] {
    const instrumental = this.deps.instrumental();
    return STEM_TRACKS.filter((t) => this.chosen.has(t) && !(instrumental && VOCAL_TRACKS.includes(t)));
  }

  private setMode(mode: GenerationMode): void {
    this.mode = mode;
    storage.set(MODE_KEY, mode);
    this.render();
  }

  private render(): void {
    const { t } = this.deps;
    const tracksMode = this.mode === "tracks" && this.available;
    this.buttons.forEach((b) => {
      const isTracks = b.dataset.genmode === "tracks";
      b.setAttribute("aria-pressed", String(isTracks === tracksMode));
      if (isTracks) {
        b.disabled = !this.available;
        b.title = this.available ? t("gen_tracks_tip") : stemsMissingText(t);
      }
    });
    this.chips.hidden = !tracksMode;
    const instrumental = this.deps.instrumental();
    this.chips.innerHTML = STEM_TRACKS.map((track) => {
      const blocked = instrumental && VOCAL_TRACKS.includes(track);
      const on = this.chosen.has(track) && !blocked;
      return `<button type="button" class="chip ${on ? "on" : ""}" data-track="${track}" aria-pressed="${on}" ${blocked ? `disabled title="${t("track_vocals_only")}"` : ""}>${t(`track_${track}`)}</button>`;
    }).join("");
    const n = this.tracks.length;
    this.hint.hidden = !tracksMode;
    this.hint.className = `small ${n || !tracksMode ? "" : "err-t"}`.trim();
    this.hint.textContent = !this.available ? stemsMissingText(t) : n ? t("tracks_hint", n) : t("tracks_none");
  }
}
