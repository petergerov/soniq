import { AppError } from "../../domain/errors.ts";
import { StoredZip } from "../../infrastructure/zip-writer.ts";
import { MAX_UPLOAD_BYTES } from "../../services/analysis-service.ts";
import type { ExtractTracks } from "../../services/extract.ts";
import type { GenerationService } from "../../services/generation-service.ts";
import type { JobRunner } from "../../services/generation-worker.ts";
import type { StemService } from "../../services/stem-service.ts";
import { HttpError, queryBool, readFormData, readJson } from "../request.ts";
import { DownloadResponse, FileResponse, ZipResponse } from "../responses.ts";
import type { Router } from "../router.ts";
import { parseExtractTracks, parseMixGains, parseStemUploadCommand } from "../validation.ts";

export interface StemRouteServices {
  stems: StemService;
  extract: ExtractTracks;
  generation: GenerationService;
  jobs: JobRunner;
}

export function registerStemRoutes(router: Router, s: StemRouteServices): void {
  router
    .get("/api/songs/:id/stems", ({ params }) => s.stems.list(params.id!))
    .post("/api/songs/:id/stems", async ({ req, params }) => {
      s.extract.enqueue(params.id!, parseExtractTracks(await readJson(req)));
      s.jobs.wake();
      return s.stems.list(params.id!);
    })
    .post("/api/songs/:id/stems/cancel", ({ params }) => {
      s.jobs.cancel(params.id!);
      s.extract.cancel(params.id!);
      return s.stems.list(params.id!);
    })
    .get("/api/songs/:id/stems.zip", async ({ params }) => {
      const { archiveName, entries } = await s.stems.zipEntries(params.id!);
      return new ZipResponse(await StoredZip.prepare(entries), `${archiveName}.zip`);
    })
    .get("/api/songs/:id/mix", async ({ params, url }) => {
      const mix = await s.stems.mixdown(params.id!, parseMixGains(url.searchParams.get("gains")));
      return new DownloadResponse(mix.data, mix.downloadName);
    })
    .get("/api/songs/:id/source", async ({ params, url }) => {
      const file = await s.stems.source(params.id!, queryBool(url, "download"));
      return new FileResponse(file.path, { downloadName: file.downloadName });
    })
    .get("/api/stems/:id/audio", async ({ params, url }) => {
      const file = await s.stems.audio(params.id!, queryBool(url, "download"));
      return new FileResponse(file.path, { downloadName: file.downloadName });
    })
    .delete("/api/stems/:id", ({ params }) => s.stems.remove(params.id!))
    .delete("/api/songs/:id/stems", ({ params }) => {
      s.jobs.cancel(params.id!);
      s.extract.cancel(params.id!);
      return s.stems.removeAll(params.id!);
    })
    .post("/api/stems/upload", async ({ req }) => {
      const form = await readFormData(req, MAX_UPLOAD_BYTES + 64 * 1024, () => new AppError("too_large", "too_big"));
      const audio = form.get("audio");
      const raw = form.get("request");
      if (!(audio instanceof File)) throw new HttpError(422, "audio: file expected");
      const text = typeof raw === "string" ? raw : raw instanceof File ? await raw.text() : "";
      let body: Record<string, unknown>;
      try {
        body = text ? JSON.parse(text) as Record<string, unknown> : {};
      } catch {
        throw new HttpError(422, "request: invalid JSON");
      }
      return s.generation.enqueueUpload(audio, parseStemUploadCommand(body));
    });
}
