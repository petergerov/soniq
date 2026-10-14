import type { FolderFilter } from "../../domain/song.ts";
import { StoredZip } from "../../infrastructure/zip-writer.ts";
import type { FolderService } from "../../services/folder-service.ts";
import type { LibraryService } from "../../services/library-service.ts";
import { readJson } from "../request.ts";
import { ZipResponse } from "../responses.ts";
import type { Router } from "../router.ts";
import { parseFolderName } from "../validation.ts";

export function registerFolderRoutes(router: Router, folders: FolderService, library: LibraryService): void {
  router
    .get("/api/folders", () => folders.overview())
    .post("/api/folders", async ({ req }) => folders.create(parseFolderName(await readJson(req))))
    .patch("/api/folders/:id", async ({ req, params }) => folders.rename(params.id!, parseFolderName(await readJson(req))))
    .delete("/api/folders/:id", ({ params }) => {
      folders.delete(params.id!);
      return { deleted: true };
    })
    // Alle fertigen Songs der Ansicht als ZIP
    .get("/api/download", async ({ url }) => {
      const { archiveName, entries } = await library.exportEntries((url.searchParams.get("folder") ?? "") as FolderFilter);
      return new ZipResponse(await StoredZip.prepare(entries), `${archiveName}.zip`);
    });
}
