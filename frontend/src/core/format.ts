/** Sekunden als m:ss ("" bei ungültigem Wert). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Bytes als MB bzw. GB, im Zahlenformat der Sprache. */
export function formatSize(bytes: number, locale: string): string {
  const mb = bytes / 1048576;
  const nf = (v: number, digits: number) => v.toLocaleString(locale, { maximumFractionDigits: digits });
  return mb >= 1024 ? `${nf(mb / 1024, 1)} GB` : `${nf(mb, 0)} MB`;
}

/** Rechenzeit eines Songs (Erstellung bis Fertigstellung) als m:ss, sonst null. */
export function generationTime(createdAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const seconds = (Date.parse(finishedAt) - Date.parse(createdAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? formatDuration(seconds) : null;
}
