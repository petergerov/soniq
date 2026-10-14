// Stimme im Lyrics-Bereich: Auto | Weiblich | Männlich | Duett und eine Liste für die Art der Stimme.
// Liest den Stil-Text und schreibt nur den eigenen Begriff zurück (wie die Stil-Regler).
import { setVoice, voiceValue } from "./voice.ts";

export class VoicePicker {
  private readonly field: HTMLTextAreaElement;
  private readonly buttons: NodeListOf<HTMLButtonElement>;
  private readonly type: HTMLSelectElement;

  constructor(field: HTMLTextAreaElement, root: HTMLElement, beforeChange: () => void) {
    this.field = field;
    this.buttons = root.querySelectorAll<HTMLButtonElement>("[data-voice]");
    this.type = root.querySelector<HTMLSelectElement>("select")!;
    const write = (kind: "gender" | "type", id: string) => {
      beforeChange();
      field.value = setVoice(field.value, kind, id);
      field.dispatchEvent(new Event("input"));   // Stil-Karten und Regler ziehen mit
    };
    this.buttons.forEach((b) => b.addEventListener("click", () => write("gender", b.dataset.voice!)));
    this.type.addEventListener("change", () => write("type", this.type.value));
    field.addEventListener("input", () => this.sync());
    this.sync();
  }

  /** Auswahl an den Stil-Text anpassen; nach Änderungen von außen aufrufen. */
  sync(): void {
    const gender = voiceValue(this.field.value, "gender");
    this.buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.voice === gender)));
    this.type.value = voiceValue(this.field.value, "type");
  }
}
