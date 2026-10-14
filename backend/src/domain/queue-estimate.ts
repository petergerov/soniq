// Schätzt, wann wartende und laufende Songs fertig sind. Grundlage: Sekunden Rechenzeit je Sekunde Musik
// aus den letzten fertigen Songs (Median, robust gegen Ausreißer). Reine Funktionen, die Zeit kommt von außen.

export interface RunRecord {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Länge der Musik in Sekunden (0 = unbekannt / Modell entscheidet) */
  duration: number;
}

export interface RunRate {
  /** Sekunden Rechenzeit je Sekunde Musik */
  rate: number;
  /** Übliche Länge, für Songs ohne feste Länge */
  typicalDuration: number;
}

const MAX_SAMPLES = 20;

function seconds(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Rechenzeit lernen. `finished` sind alle Songs mit Endzeit (auch Fehler/Abbrüche), nach Endzeit sortiert.
 *  Ältere Songs ohne Startzeit: Der Worker rechnet immer nur einen Song, also begann er frühestens,
 *  als der vorige fertig war, und nicht vor seiner Erstellung. */
export function learnRate(finished: readonly RunRecord[]): RunRate | null {
  const rates: number[] = [];
  const durations: number[] = [];
  let previousEnd: string | null = null;
  for (const r of finished) {
    if (!r.finished_at) continue;
    const start = r.started_at ?? (previousEnd && previousEnd > r.created_at ? previousEnd : r.created_at);
    const took = seconds(start, r.finished_at);
    if (r.status === "done" && r.duration > 0 && took > 0) {
      rates.push(took / r.duration);
      durations.push(r.duration);
    }
    previousEnd = r.finished_at;
  }
  if (!rates.length) return null;
  return { rate: median(rates.slice(-MAX_SAMPLES)), typicalDuration: median(durations.slice(-MAX_SAMPLES)) };
}

/** Sekunden bis „fertig“ je Song. `active` in Abarbeitungsreihenfolge (der laufende zuerst). */
export function estimateQueue(active: readonly RunRecord[], rate: RunRate, now: string): Record<string, number> {
  const out: Record<string, number> = {};
  let ahead = 0;
  for (const r of active) {
    const total = rate.rate * (r.duration > 0 ? r.duration : rate.typicalDuration);
    const elapsed = r.status === "running" && r.started_at ? Math.max(0, seconds(r.started_at, now)) : 0;
    ahead += Math.max(0, total - elapsed);
    out[r.id] = Math.round(ahead);
  }
  return out;
}
