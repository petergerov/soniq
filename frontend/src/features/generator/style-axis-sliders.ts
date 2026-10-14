// Drei Regler unter dem Stil-Feld; sie lesen den Stil-Text und schreiben nur ihren eigenen Begriff zurück.
import { AXIS_IDS, axisValue, setAxis, type StyleAxis } from "./style-axes.ts";

export class StyleAxisSliders {
  private readonly field: HTMLTextAreaElement;
  private readonly root: HTMLElement;

  constructor(field: HTMLTextAreaElement, root: HTMLElement, beforeChange: () => void) {
    this.field = field;
    this.root = root;
    field.addEventListener("input", () => this.sync());
    root.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      const axis = input.dataset.axis as StyleAxis | undefined;
      if (!axis) return;
      beforeChange();
      field.value = setAxis(field.value, axis, Number(input.value));
      field.dispatchEvent(new Event("input"));   // Stil-Karten ziehen mit
    });
    this.sync();
  }

  /** Regler an den Stil-Text anpassen; nach Änderungen von außen aufrufen. */
  sync(): void {
    for (const axis of AXIS_IDS) {
      const input = this.root.querySelector<HTMLInputElement>(`input[data-axis="${axis}"]`)!;
      const value = axisValue(this.field.value, axis);
      input.value = String(value);
      input.closest(".axis")?.classList.toggle("set", value !== 0);
    }
  }
}
