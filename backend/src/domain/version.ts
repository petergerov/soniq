// Versionsnummern wie "1.2.3" (auch mit führendem "v" oder Zusatz "-beta"): nur die Zahlen zählen.

function parts(version: string): number[] {
  return version.replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((p) => Number.parseInt(p, 10) || 0);
}

/** > 0, wenn a neuer ist als b; 0 bei gleicher Version. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
