import { isLmSize } from "../../domain/model-plan.ts";
import type { SetupService } from "../../services/setup-service.ts";
import { HttpError, readJson, requireLangHeader } from "../request.ts";
import type { Router } from "../router.ts";

export function registerSetupRoutes(router: Router, setup: SetupService): void {
  router
    .get("/api/setup", () => setup.status())
    .post("/api/setup", async (ctx) => {
      requireLangHeader(ctx);
      const body = await readJson(ctx.req);
      if (!isLmSize(body.lm)) throw new HttpError(422, 'lm: "0.6B", "1.7B" or "4B" expected');
      return setup.start({ lm: body.lm, xl: body.xl === true, stems: body.stems === true });
    })
    .post("/api/setup/xl", (ctx) => {
      requireLangHeader(ctx);
      return setup.addXl();
    })
    .post("/api/setup/stems", (ctx) => {
      requireLangHeader(ctx);
      return setup.addStems();
    })
    .post("/api/setup/stems-xl", (ctx) => {
      requireLangHeader(ctx);
      return setup.addXlStems();
    })
    .post("/api/setup/demucs", (ctx) => {
      requireLangHeader(ctx);
      return setup.addDemucs();
    })
    .post("/api/setup/cancel", () => setup.cancel());
}
