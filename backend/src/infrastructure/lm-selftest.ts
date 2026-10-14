// Grafik-Selbsttest des Sprachmodells (siehe cli/selftest.ts für die Hintergründe). Gemeinsam genutzt vom
// Installer (über die CLI) und von der Einrichtung der fertigen App.
import { setTimeout as sleep } from "node:timers/promises";

const DURATION = 10;                 // Sekunden -> erwartet ~50 Codes (5 pro Sekunde)
const DEADLINE_MS = 300_000;

type Json = Record<string, unknown>;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return r.json();
}

export async function runLanguageModel(base: string, lmFile: string): Promise<Json> {
  const req: Json = { caption: "calm ambient pad, soft piano", lyrics: "[Instrumental]", duration: DURATION, vocal_language: "unknown", seed: 42 };
  if (lmFile) req.lm_model = lmFile;
  const job = String(((await getJson(`${base}/lm`, {
    method: "POST", body: JSON.stringify(req), headers: { "content-type": "application/json" },
  })) as Json).id);
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const status = String(((await getJson(`${base}/job?id=${job}`)) as Json).status ?? "").toLowerCase();
    if (status === "done") {
      const result = await getJson(`${base}/job?id=${job}&result=1`);
      return (Array.isArray(result) ? result[0] : result) as Json;
    }
    if (["err", "fail", "cancel"].some((w) => status.includes(w))) throw new Error(`job failed (${status})`);
    await sleep(1000);
  }
  throw new Error("timeout");
}

export function judge(data: Json): { ok: boolean; summary: string } {
  const codes = String(data.audio_codes ?? "").split(",").filter((x) => x.trim());
  const expected = DURATION * 5;
  const uniqueRatio = codes.length ? new Set(codes).size / codes.length : 0;
  const bpm = Number(data.bpm) || 0;
  // Phase 1: nur prüfen, dass überhaupt geplant wurde. Das 0.6B-Modell wählt auch mal 37 BPM, das ist kein GPU-Fehler.
  const planned = bpm > 0 && Boolean(data.keyscale);
  const coded = codes.length >= 0.6 * expected && codes.length <= 1.4 * expected && uniqueRatio > 0.3;   // Phase 2
  const ok = planned && coded;
  const summary = `planning ${planned ? "ok" : "faulty"} (BPM ${String(data.bpm)}, ${String(data.keyscale || "no key")}), ` +
    `${codes.length} codes (expected ~${expected}), variety ${uniqueRatio.toFixed(2)} -> ${ok ? "ok" : "unusable"}`;
  return { ok, summary };
}

/** Läuft das Sprachmodell auf dem Server unter `base` brauchbar? (false auch bei Fehlern und Zeitüberschreitung) */
export async function languageModelWorks(base: string, lmFile: string): Promise<{ ok: boolean; summary: string }> {
  try {
    return judge(await runLanguageModel(base, lmFile));
  } catch (e) {
    return { ok: false, summary: (e as Error).message };
  }
}
