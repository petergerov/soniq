// Anbindung an acestep.cpp (ace-server). Der Server arbeitet asynchron:
//   POST /lm    -> {"id": ...}   Sprachmodell ergänzt Metadaten, Lyrics und audio_codes
//   POST /synth -> {"id": ...}   DiT + VAE rendern Audio
//   GET  /job?id=X            -> {"status": ...}
//   GET  /job?id=X&result=1   -> Ergebnis (/lm: JSON-Array, /synth: multipart/mixed)
import { setTimeout as sleep } from "node:timers/promises";
import type { HealthInfo, Settings } from "../../../shared/api.ts";
import type { SongResultMeta } from "../../../shared/api.ts";
import {
  DIT_MODELS, EngineError, STEM_GUIDANCE, STEM_MODELS, STEM_SHIFT, STEM_STEPS,
  type AnalysisResult, type AudioFile, type CoverRequest, type GeneratedAudio, type MusicEngine, type ProgressReporter, type RepaintRequest,
  type StemRequest,
} from "../domain/music-engine.ts";
import { DEFAULT_OUTPUT_FORMAT, OUTPUT_FORMATS, type AceOutputFormat } from "../domain/output-format.ts";
import { parseMultipart } from "./multipart.ts";
import { wavSeconds } from "./wav.ts";

/** Felder, die an ace-server durchgereicht werden (Rest bleibt auf Server-Vorgaben). */
const ACE_FIELDS = new Set([
  "caption", "lyrics", "bpm", "duration", "keyscale", "timesignature", "vocal_language", "seed", "lm_temperature",
  "lm_cfg_scale", "inference_steps", "guidance_scale", "output_format", "mp3_bitrate", "lm_model", "synth_model", "use_cot_caption",
]);
const META_FIELDS = ["bpm", "duration", "keyscale", "timesignature", "vocal_language", "lyrics", "caption"] as const;
const REQUEST_TIMEOUT_MS = 60_000;
const CANCEL_TIMEOUT_MS = 5_000;

type Json = Record<string, unknown>;

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function extensionFor(contentType: string): "wav" | "mp3" {
  return contentType.includes("mpeg") || contentType.includes("mp3") ? "mp3" : "wav";
}

function audioType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".flac")) return "audio/flac";
  if (n.endsWith(".ogg")) return "audio/ogg";
  return "audio/wav";
}

function isConnectionError(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } }).cause?.code ?? "";
  return e instanceof TypeError && (e.message === "fetch failed" || ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"].includes(code));
}

function firstItem(value: unknown): Json {
  return (Array.isArray(value) ? value[0] : value) as Json;
}

/** /synth als Multipart: Anfrage-JSON plus Vorlage ("audio") und Klang-Referenz ("ref_audio") */
function synthForm(req: Json, files: { audio?: AudioFile | undefined; ref_audio?: AudioFile | undefined }): FormData {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(req)], { type: "application/json" }), "request.json");
  for (const [part, file] of Object.entries(files)) {
    if (file) form.append(part, new Blob([new Uint8Array(file.data)], { type: audioType(file.name) }), file.name);
  }
  return form;
}

/** Felder für den Modellserver; leere Werte bleiben auf seinen Vorgaben */
function aceFields(params: Json, skip: readonly string[] = []): Json {
  return Object.fromEntries(
    Object.entries(params).filter(([k, v]) => ACE_FIELDS.has(k) && !skip.includes(k) && v !== null && v !== undefined && v !== ""),
  );
}

export class AceStepEngine implements MusicEngine {
  readonly name = "acestep_cpp";
  private readonly base: string;
  private readonly lmBase: string;
  private readonly pollMs: number;
  private readonly timeoutSeconds: number;
  private readonly lmModel: string;
  private readonly ditModel: string;
  private readonly stemModel: string;
  private readonly outputFormat: AceOutputFormat;

  constructor(settings: Settings) {
    this.base = settings.server_url.replace(/\/+$/, "");
    // Auf Apple M4 liefert das Sprachmodell unter Metal Unsinn (0 Codes) -> eigener CPU-Server
    this.lmBase = (settings.lm_url || settings.server_url).replace(/\/+$/, "");
    this.pollMs = settings.poll_interval * 1000;
    this.timeoutSeconds = settings.timeout_minutes * 60;
    // Liegen mehrere Sprachmodelle im Ordner, nähme der Server sonst das erste (alphabetisch)
    this.lmModel = settings.lm_model;
    this.ditModel = DIT_MODELS[settings.dit] ?? DIT_MODELS.standard;
    this.stemModel = STEM_MODELS[settings.stem_model] ?? STEM_MODELS.standard;
    this.outputFormat = OUTPUT_FORMATS[settings.output_format] ?? OUTPUT_FORMATS[DEFAULT_OUTPUT_FORMAT];
  }

  async health(): Promise<HealthInfo> {
    const r = await this.request(`${this.base}/health`, {}, CANCEL_TIMEOUT_MS);
    if (!r.ok) throw new EngineError(`HTTP ${r.status}`);
    if (this.lmBase !== this.base) {
      const lm = await this.request(`${this.lmBase}/health`, {}, CANCEL_TIMEOUT_MS).catch(() => undefined);
      if (!lm?.ok) throw new EngineError(`LM-Server ${this.lmBase} nicht erreichbar`);
    }
    const info: HealthInfo = { ok: true, health: await r.json() };
    try {
      const props = await this.request(`${this.base}/props`, {}, CANCEL_TIMEOUT_MS);
      if (props.status === 200) info.props = (await props.json()) as HealthInfo["props"];
    } catch {
      // Zusatzinfo, nicht nötig
    }
    return info;
  }

  async generate(params: Json, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio> {
    const req = aceFields(params);
    req.use_cot_caption ??= false;      // Prompt wörtlich übernehmen
    Object.assign(req, this.outputFormat);   // Dateiformat aus den Einstellungen (Vorgabe: WAV 16 Bit)
    req.synth_model = this.ditModel;
    if (this.lmModel) req.lm_model = this.lmModel;
    const start = performance.now();    // zählt über beide Phasen (Sprachmodell + Synthese) durch

    // 1) Sprachmodell: Songstruktur + Audio-Codes
    const lmJob = await this.startJob(this.lmBase, "/lm", { body: JSON.stringify(req), headers: { "content-type": "application/json" } }, signal);
    const lmResult = await this.waitForJob(this.lmBase, lmJob, "Sprachmodell", start, progress, signal);
    const enriched = firstItem(await lmResult.json());
    if (!enriched.audio_codes) {
      throw new EngineError("Sprachmodell hat keine Audio-Codes geliefert (LM auf Metal? LM-Server auf CPU nutzen)");
    }
    Object.assign(enriched, this.outputFormat);
    enriched.synth_model = req.synth_model;

    // 2) Synthese
    const synthJob = await this.startJob(this.base, "/synth", { body: JSON.stringify(enriched), headers: { "content-type": "application/json" } }, signal);
    const synthResult = await this.waitForJob(this.base, synthJob, "Synthese", start, progress, signal);
    const { audio, extension } = await this.extractAudio(synthResult);
    const meta = Object.fromEntries(META_FIELDS.map((k) => [k, enriched[k] ?? null]));
    return { audio, extension, meta };
  }

  async plan(params: Json, writeLyrics: boolean, progress: ProgressReporter, signal: AbortSignal): Promise<SongResultMeta> {
    const req = aceFields(params);
    req.use_cot_caption ??= false;
    // Lyrics schreibt "generate" verlässlich (Audio-Codes werden hier nicht gebraucht); sonst "format" ohne Codes, ~3 s
    req.lm_mode = writeLyrics ? "generate" : "format";
    if (this.lmModel) req.lm_model = this.lmModel;
    const job = await this.startJob(this.lmBase, "/lm", { body: JSON.stringify(req), headers: { "content-type": "application/json" } }, signal);
    const enriched = firstItem(await (await this.waitForJob(this.lmBase, job, "Sprachmodell", performance.now(), progress, signal)).json());
    return Object.fromEntries(META_FIELDS.map((k) => [k, enriched[k] ?? null])) as SongResultMeta;
  }

  async stem(r: StemRequest, progress: ProgressReporter, signal: AbortSignal): Promise<Uint8Array> {
    const req: Json = {
      synth_model: this.stemModel, task_type: r.task, track: r.track, lyrics: r.lyrics || "[Instrumental]",
      // extract ohne Caption, wie in der ACE-Step-Referenz: die Song-Beschreibung lenkt sonst auf das, was sie nennt
      // (extract drums aus "fingerpicked guitar, …" lieferte die Gitarre; ohne Caption die Drums ab ihrem Einsatz)
      caption: r.task === "extract" ? "" : r.caption,
      // Werte der ACE-Step-Referenz: ohne sie befolgt das Modell die Spur-Anweisung kaum (siehe STEM_SHIFT)
      inference_steps: STEM_STEPS, shift: STEM_SHIFT, guidance_scale: STEM_GUIDANCE,
      output_format: "wav32",   // Gleitkomma: Spuren werden danach addiert, ohne Rundung dazwischen
    };
    for (const k of ["bpm", "keyscale", "timesignature", "duration", "seed"] as const) if (r[k] !== undefined && r[k] !== null && r[k] !== "") req[k] = r[k];
    const form = synthForm(req, { audio: { data: r.source, name: r.sourceName || "source.wav" } });
    const job = await this.startJob(this.base, "/synth", { body: form }, signal);
    const res = await this.waitForJob(this.base, job, r.track, performance.now(), progress, signal);
    const { audio, extension } = await this.extractAudio(res);
    if (extension !== "wav") throw new EngineError(`Spur ${r.track}: WAV erwartet`);
    return audio;
  }

  async repaint(r: RepaintRequest, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio> {
    // Ohne Sprachmodell: Caption und Lyrics gehen wörtlich an das Klangmodell, die Länge gibt die Vorlage vor
    const req = aceFields(r.params, ["duration", "lm_model"]);
    Object.assign(req, this.outputFormat, {
      task_type: "repaint", synth_model: this.ditModel, repainting_start: r.start, repainting_end: r.end,
    });
    const form = synthForm(req, { audio: { data: r.source, name: r.sourceName } });
    const job = await this.startJob(this.base, "/synth", { body: form }, signal);
    const res = await this.waitForJob(this.base, job, "Repaint", performance.now(), progress, signal);
    const { audio, extension } = await this.extractAudio(res);
    const meta = Object.fromEntries(META_FIELDS.map((k) => [k, r.params[k] ?? null]));
    return { audio, extension, meta };
  }

  async cover(r: CoverRequest, progress: ProgressReporter, signal: AbortSignal): Promise<GeneratedAudio> {
    // Wie Repaint ohne Sprachmodell: Caption und Lyrics gehen wörtlich an das Klangmodell, die Länge gibt die Vorlage vor
    const req = aceFields(r.params, ["duration", "lm_model"]);
    Object.assign(req, this.outputFormat, { task_type: r.task, synth_model: this.ditModel, audio_cover_strength: r.strength });
    const form = synthForm(req, { audio: r.source, ref_audio: r.reference });
    const job = await this.startJob(this.base, "/synth", { body: form }, signal);
    const res = await this.waitForJob(this.base, job, "Cover", performance.now(), progress, signal);
    const { audio, extension } = await this.extractAudio(res);
    const meta: SongResultMeta = Object.fromEntries(META_FIELDS.map((k) => [k, r.params[k] ?? null]));
    meta.duration = (extension === "wav" ? Math.round(wavSeconds(audio) * 10) / 10 : 0) || meta.duration || null;
    return { audio, extension, meta };
  }

  /** Song hochladen, das Modell beschreibt Stil, Tempo, Tonart, Lyrics (/understand, läuft auf dem LM-Server). */
  async analyze(audio: Blob, filename: string): Promise<AnalysisResult> {
    const form = new FormData();
    form.append("audio", audio, filename);
    const signal = new AbortController().signal;
    const job = await this.startJob(this.lmBase, "/understand", { body: form }, signal);
    const result = await this.waitForJob(this.lmBase, job, "Analyse", performance.now(), () => {}, signal);
    return firstItem(await this.extractJson(result)) as AnalysisResult;
  }

  private async request(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      // Der Text "nicht erreichbar" wird in der Oberfläche erkannt und übersetzt
      if (isConnectionError(e)) throw new EngineError(`Modellserver nicht erreichbar (${new URL(url).origin}). Läuft ace-server?`);
      throw e;
    }
  }

  private async startJob(base: string, path: string, init: RequestInit, signal: AbortSignal): Promise<string> {
    const r = await this.request(`${base}${path}`, { ...init, method: "POST" }, REQUEST_TIMEOUT_MS, signal);
    if (r.status >= 400) throw new EngineError(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return String(((await r.json()) as Json).id);
  }

  private async waitForJob(
    base: string, jobId: string, label: string, start: number, progress: ProgressReporter, signal: AbortSignal,
  ): Promise<Response> {
    try {
      // start = Beginn des Gesamtauftrags (nicht dieser Phase) -> die Anzeige zählt einfach durch
      for (;;) {
        const r = await this.request(`${base}/job?id=${encodeURIComponent(jobId)}`, {}, REQUEST_TIMEOUT_MS, signal);
        if (!r.ok) throw new EngineError(`${label}: HTTP ${r.status}`);
        const text = await r.text();
        const status = String((JSON.parse(text) as Json).status ?? "").toLowerCase();
        if (status === "done") {
          const res = await this.request(`${base}/job?id=${encodeURIComponent(jobId)}&result=1`, {}, REQUEST_TIMEOUT_MS, signal);
          if (!res.ok) throw new EngineError(`${label}: HTTP ${res.status}`);
          return res;
        }
        if (["err", "fail", "cancel"].some((w) => status.includes(w))) throw new EngineError(`${label} fehlgeschlagen: ${text}`);
        const elapsed = Math.floor((performance.now() - start) / 1000);
        if (elapsed > this.timeoutSeconds) {
          await this.cancelJob(base, jobId);   // Modellserver nicht am alten Auftrag weiterrechnen lassen
          throw new EngineError(`${label}: Zeitüberschreitung nach ${elapsed}s`);
        }
        progress(formatElapsed(elapsed));
        await sleep(this.pollMs, undefined, { signal });
      }
    } catch (e) {
      if (signal.aborted) await this.cancelJob(base, jobId);   // vom Nutzer abgebrochen
      throw e;
    }
  }

  private async cancelJob(base: string, jobId: string): Promise<void> {
    await this.request(`${base}/job?id=${encodeURIComponent(jobId)}&cancel=1`, { method: "POST" }, CANCEL_TIMEOUT_MS).catch(() => undefined);
  }

  private async extractAudio(res: Response): Promise<{ audio: Uint8Array; extension: "wav" | "mp3" }> {
    const type = res.headers.get("content-type") ?? "";
    const body = new Uint8Array(await res.arrayBuffer());
    if (type.startsWith("audio/")) return { audio: body, extension: extensionFor(type) };
    if (!type.includes("multipart")) throw new EngineError(`Unerwartete Antwort von /synth: ${type}`);
    const part = parseMultipart(type, body).find((p) => p.contentType.startsWith("audio/"));
    if (!part) throw new EngineError("Kein Audio-Teil in der /synth-Antwort gefunden");
    return { audio: part.body, extension: extensionFor(part.contentType) };
  }

  /** /understand liefert wie /synth multipart/mixed: JSON-Teil (Metadaten) + Roh-Latents. */
  private async extractJson(res: Response): Promise<unknown> {
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("application/json")) return res.json();
    if (!type.includes("multipart")) throw new EngineError(`Unerwartete Antwort von /understand: ${type}`);
    const part = parseMultipart(type, new Uint8Array(await res.arrayBuffer())).find((p) => p.contentType.startsWith("application/json"));
    if (!part) throw new EngineError("Kein JSON-Teil in der /understand-Antwort gefunden");
    return JSON.parse(new TextDecoder().decode(part.body));
  }
}
