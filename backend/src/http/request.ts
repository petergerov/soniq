// Lesen von Anfragen: Body (mit Größenlimit), JSON, Formulardaten, Query-Parameter.
import type { IncomingMessage } from "node:http";
import type { Translate } from "../i18n/translator.ts";

/** Fehler, die direkt aus der HTTP-Schicht kommen (kaputte Anfrage, fehlender Header …). */
export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export interface RequestContext {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  /** Sprache der Oberfläche aus dem Header X-Lang */
  lang: string | undefined;
  t: Translate;
}

const DEFAULT_LIMIT = 1024 * 1024;

export async function readBody(req: IncomingMessage, limit = DEFAULT_LIMIT, onTooLarge?: () => Error): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  const tooLarge = () => onTooLarge?.() ?? new HttpError(413, "Request body too large");
  if (declared > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw tooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const text = (await readBody(req)).toString("utf8");
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
    return value as T;
  } catch {
    throw new HttpError(422, "Invalid JSON body");
  }
}

/** multipart/form-data über die eingebaute Web-API von Node auswerten. */
export async function readFormData(req: IncomingMessage, limit: number, onTooLarge: () => Error): Promise<FormData> {
  const body = await readBody(req, limit, onTooLarge);
  const contentType = req.headers["content-type"] ?? "";
  try {
    return await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new HttpError(422, "Invalid form data");
  }
}

export function queryBool(url: URL, name: string): boolean {
  return ["1", "true", "yes", "on"].includes((url.searchParams.get(name) ?? "").toLowerCase());
}

/** Pflicht-Header X-Lang: fremde Webseiten können ihn ohne CORS-Freigabe nicht mitschicken (Schutz vor CSRF). */
export function requireLangHeader(ctx: RequestContext): void {
  if (ctx.lang === undefined) throw new HttpError(422, "Header X-Lang missing");
}
