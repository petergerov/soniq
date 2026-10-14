// Vorlagen: benannte Einstellungen des Formulars (alles außer Idee, Titel, Lyrics und Seed).
import type { Preset, PresetValues } from "../../../shared/api.ts";
import { AppError } from "../domain/errors.ts";
import type { PresetRepository } from "../infrastructure/preset-repository.ts";

const MAX_NAME_LENGTH = 60;
const MAX_PRESETS = 100;

function validName(name: string): string {
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) throw new AppError("invalid", "no_name");
  return clean;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class PresetService {
  private readonly presets: PresetRepository;

  constructor(presets: PresetRepository) {
    this.presets = presets;
  }

  list(): Preset[] {
    return this.presets.list().sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Speichert unter dem Namen; eine Vorlage gleichen Namens (Groß/klein egal) wird ersetzt. */
  save(name: string, values: PresetValues): Preset[] {
    const clean = validName(name);
    const rest = this.presets.list().filter((p) => !sameName(p.name, clean));
    this.presets.replaceAll([...rest, { name: clean, values }].slice(-MAX_PRESETS));
    return this.list();
  }

  remove(name: string): Preset[] {
    this.presets.replaceAll(this.presets.list().filter((p) => !sameName(p.name, name)));
    return this.list();
  }
}
