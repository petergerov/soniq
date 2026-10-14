import { StoredZip } from "../../infrastructure/zip-writer.ts";
import type { StemService } from "../../services/stem-service.ts";
import { queryBool } from "../request.ts";
import { FileResponse, ZipResponse } from "../responses.ts";
import type { Router } from "../router.ts";

export function registerStemRoutes(router: Router, stems: StemService): void {
  router
    .get("/api/songs/:id/stems", ({ params }) => stems.list(params.id!))
    .get("/api/songs/:id/stems.zip", async ({ params }) => {
      const { archiveName, entries } = await stems.zipEntries(params.id!);
      return new ZipResponse(await StoredZip.prepare(entries), `${archiveName}.zip`);
    })
    .get("/api/stems/:id/audio", async ({ params, url }) => {
      const file = await stems.audio(params.id!, queryBool(url, "download"));
      return new FileResponse(file.path, { downloadName: file.downloadName });
    });
}
