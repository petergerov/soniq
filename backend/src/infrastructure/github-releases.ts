// Neuestes Release auf GitHub (für die fertige App, die als DMG statt per git aktualisiert wird).
// Ohne Anmeldung: GitHub erlaubt 60 Abfragen pro Stunde und IP, das reicht für "Nach Updates suchen".
export interface LatestRelease {
  version: string;
  /** Release-Seite */
  url: string;
  /** Direkter Download (.dmg / .deb je Plattform), sonst die Release-Seite */
  downloadUrl: string;
  /** Zeilen der Release-Notizen (ohne Leerzeilen) */
  notes: string[];
}

interface ReleaseJson {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  assets?: { name?: string; browser_download_url?: string }[];
}

export async function latestRelease(repo: string): Promise<LatestRelease | undefined> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "SONIQ" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return undefined;   // noch kein Release
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
  const r = (await res.json()) as ReleaseJson;
  const assets = r.assets ?? [];
  const byExt = (ext: string) => assets.find((a) => a.name?.toLowerCase().endsWith(ext))?.browser_download_url;
  // Fertige App: passendes Paket je Plattform, sonst die Release-Seite
  const download = process.platform === "linux" ? byExt(".deb") ?? byExt(".dmg")
    : process.platform === "darwin" ? byExt(".dmg")
    : byExt(".dmg") ?? byExt(".deb");
  const url = r.html_url ?? `https://github.com/${repo}/releases`;
  return {
    version: (r.tag_name ?? "").replace(/^v/, ""),
    url,
    downloadUrl: download ?? url,
    notes: (r.body ?? "").split(/\r?\n/).map((l) => l.replace(/^[-*#\s]+/, "").trim()).filter(Boolean).slice(0, 15),
  };
}
