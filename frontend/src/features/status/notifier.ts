// Meldet, wenn ein Song fertig ist (oder scheitert): kurzer Ton und, wenn der Tab im Hintergrund liegt,
// eine Benachrichtigung des Browsers. Ein-/Ausschalter mit der Glocke oben, pro Browser gemerkt.
import type { Song } from "../../../../shared/api.ts";
import type { ApiClient } from "../../core/api-client.ts";
import { byId } from "../../core/dom.ts";
import { storage } from "../../core/storage.ts";
import type { Translate } from "../../i18n/i18n.ts";
import { displayTitle } from "../library/song-row.ts";

const KEY = "notify";

export class Notifier {
  private readonly api: ApiClient;
  private readonly t: Translate;
  /** Klick auf eine Benachrichtigung: zur Bibliothek */
  private readonly onOpen: () => void;
  private readonly button = byId<HTMLButtonElement>("notifyBtn");
  private enabled = storage.get(KEY) === "1";
  private running: Set<string> | null = null;
  private audio: AudioContext | undefined;

  constructor(api: ApiClient, t: Translate, onOpen: () => void) {
    this.api = api;
    this.t = t;
    this.onOpen = onOpen;
    this.button.addEventListener("click", () => void this.toggle());
    // Browser erlauben Ton erst nach einer Bedienung der Seite: Tonausgabe beim ersten Klick vorbereiten
    document.addEventListener("pointerdown", () => { if (this.enabled) void this.context().resume(); }, { once: true });
    this.render();
  }

  /** Nach jeder Aktualisierung der Warteschlange: Songs, die nicht mehr laufen, sind fertig oder gescheitert. */
  observe(runningIds: readonly string[]): void {
    const previous = this.running;
    this.running = new Set(runningIds);
    if (!previous || !this.enabled) return;
    for (const id of previous) if (!this.running.has(id)) void this.finished(id);
  }

  render(): void {
    this.button.setAttribute("aria-pressed", String(this.enabled));
    this.button.title = this.t(this.enabled ? "notify_on" : "notify_off");
    this.button.setAttribute("aria-label", this.button.title);
  }

  private async toggle(): Promise<void> {
    this.enabled = !this.enabled;
    storage.set(KEY, this.enabled ? "1" : "0");
    this.render();
    if (!this.enabled) return;
    this.chime(true);   // hörbare Bestätigung
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  }

  private async finished(id: string): Promise<void> {
    let song: Song;
    try {
      song = await this.api.song(id);
    } catch {
      return;   // inzwischen gelöscht
    }
    if (song.status !== "done" && song.status !== "error") return;   // abgebrochen: keine Meldung
    const ok = song.status === "done";
    this.chime(ok);
    if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
    const note = new Notification(displayTitle(song), { body: this.t(ok ? "notify_done" : "notify_error"), icon: "/favicon.svg", tag: id });
    note.onclick = () => {
      window.focus();
      this.onOpen();
      note.close();
    };
  }

  private context(): AudioContext {
    this.audio ??= new AudioContext();
    return this.audio;
  }

  /** Zwei kurze Töne: aufwärts = fertig, abwärts = Fehler. */
  private chime(ok: boolean): void {
    const ctx = this.context();
    void ctx.resume();
    const notes = ok ? [660, 990] : [440, 330];
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }
}
