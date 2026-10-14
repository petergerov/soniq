import { AppError } from "../../domain/errors.ts";
import { MAX_UPLOAD_BYTES, type AnalysisService } from "../../services/analysis-service.ts";
import type { SettingsService } from "../../services/settings-service.ts";
import type { SystemService } from "../../services/system-service.ts";
import type { UpdateService } from "../../services/update-service.ts";
import { HttpError, readFormData, readJson, requireLangHeader } from "../request.ts";
import type { Router } from "../router.ts";

export interface SystemRouteServices {
  settings: SettingsService;
  analysis: AnalysisService;
  system: SystemService;
  updates: UpdateService;
}

export function registerSystemRoutes(router: Router, s: SystemRouteServices): void {
  router
    .get("/api/settings", () => s.settings.view())
    .put("/api/settings", async ({ req }) => s.settings.update(await readJson(req)))
    .get("/api/health", () => s.system.health())
    .post("/api/analyze", async ({ req }) => {
      // Etwas Spielraum für die Multipart-Hülle; die eigentliche Dateigröße prüft der Service
      const form = await readFormData(req, MAX_UPLOAD_BYTES + 64 * 1024, () => new AppError("too_large", "too_big"));
      const audio = form.get("audio");
      if (!(audio instanceof File)) throw new HttpError(422, "audio: file expected");
      return s.analysis.analyze(audio);
    })
    .post("/api/shutdown", (ctx) => {
      requireLangHeader(ctx);
      s.system.shutdown();
      return { ok: true, packaged: s.system.packaged };
    })
    .get("/api/update/check", async ({ t }) => {
      try {
        return { ok: true, ...(await s.updates.status(t)) };
      } catch (e) {
        return { ok: false, error: e instanceof AppError && e.messageKey ? t(e.messageKey) : s.updates.describe(e, t) };
      }
    })
    .post("/api/update/apply", async (ctx) => {
      requireLangHeader(ctx);
      try {
        const result = await s.updates.apply(ctx.t);
        s.updates.scheduleRestart();
        return { ok: true, ...result };
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw AppError.raw("bad_request", s.updates.describe(e, ctx.t));
      }
    });
}
