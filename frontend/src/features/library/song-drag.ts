// Gemeinsamer Zustand beim Ziehen eines Songs auf einen Ordner (Liste und Ordnerleiste).
// Während des Ziehens wird nicht neu gezeichnet, sonst bricht der Browser das Ziehen ab.

export const SONG_DRAG_TYPE = "text/song";

export class SongDrag {
  active = false;

  constructor() {
    document.addEventListener("dragend", () => this.end());
  }

  start(e: DragEvent, songId: string): void {
    this.active = true;
    e.dataTransfer?.setData(SONG_DRAG_TYPE, songId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  end(): void {
    this.active = false;
    document.querySelectorAll(".chip.drop").forEach((c) => c.classList.remove("drop"));
  }

  static carriesSong(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes(SONG_DRAG_TYPE);
  }
}
