// Verbindet Node-HTTP mit Router, statischen Dateien und Fehlerbehandlung.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { translatorFor } from "../i18n/translator.ts";
import { mapError } from "./error-mapper.ts";
import type { RequestContext } from "./request.ts";
import { isHttpResponse, sendJson } from "./responses.ts";
import type { Router } from "./router.ts";
import type { StaticFiles } from "./static-files.ts";

/** Nur Aufrufe an localhost annehmen: schützt gegen DNS-Rebinding (fremde Domain, die auf 127.0.0.1 zeigt). */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type Logger = (message: string) => void;

function hostName(hostHeader: string | undefined): string {
  return (hostHeader ?? "").replace(/:\d+$/, "").toLowerCase();
}

export class HttpServer {
  private readonly router: Router;
  private readonly staticFiles: StaticFiles;
  private readonly log: Logger;
  private readonly server: Server;

  constructor(router: Router, staticFiles: StaticFiles, log: Logger) {
    this.router = router;
    this.staticFiles = staticFiles;
    this.log = log;
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const langHeader = req.headers["x-lang"];
    const lang = Array.isArray(langHeader) ? langHeader[0] : langHeader;
    const t = translatorFor(lang ?? "de");
    try {
      if (!ALLOWED_HOSTS.has(hostName(req.headers.host))) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Invalid host header");
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const match = this.router.match(req.method ?? "GET", url.pathname);
      if (match === "method") return sendJson(res, 405, { detail: "Method Not Allowed" });
      if (match) {
        const ctx: RequestContext = { req, url, params: match.params, lang, t };
        const result = await match.handler(ctx);
        if (isHttpResponse(result)) await result.send(res, req.headers.range);
        else sendJson(res, 200, result);
        return;
      }
      const file = req.method === "GET" || req.method === "HEAD" ? await this.staticFiles.resolve(url.pathname) : undefined;
      if (file) await file.send(res, req.headers.range);
      else sendJson(res, 404, { detail: "Not Found" });
    } catch (e) {
      this.fail(req, res, e, t);
    }
  }

  private fail(req: IncomingMessage, res: ServerResponse, e: unknown, t: ReturnType<typeof translatorFor>): void {
    const { status, detail, unexpected } = mapError(e, t);
    if (unexpected) this.log(`Unerwarteter Fehler bei ${req.method} ${req.url}: ${(e as Error)?.stack ?? String(e)}`);
    if (res.headersSent) {
      res.destroy();   // Datei-/ZIP-Übertragung abgebrochen
      return;
    }
    sendJson(res, status, { detail });
  }
}
