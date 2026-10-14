import type { PresetService } from "../../services/preset-service.ts";
import { readJson } from "../request.ts";
import type { Router } from "../router.ts";
import { parsePresetValues } from "../validation.ts";

export function registerPresetRoutes(router: Router, presets: PresetService): void {
  router
    .get("/api/presets", () => presets.list())
    .put("/api/presets/:name", async ({ req, params }) => presets.save(params.name!, parsePresetValues(await readJson(req))))
    .delete("/api/presets/:name", ({ params }) => presets.remove(params.name!));
}
