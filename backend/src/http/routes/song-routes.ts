import type { FolderFilter } from "../../domain/song.ts";
import type { GenerationService } from "../../services/generation-service.ts";
import type { LibraryService } from "../../services/library-service.ts";
import { queryBool, readJson } from "../request.ts";
import { FileResponse } from "../responses.ts";
import type { Router } from "../router.ts";
import { parseGenerateCommand, parseSongPatch } from "../validation.ts";

export function registerSongRoutes(router: Router, generation: GenerationService, library: LibraryService): void {
  router
    .post("/api/generate", async ({ req }) => generation.enqueue(parseGenerateCommand(await readJson(req))))
    .get("/api/songs", ({ url }) => library.list({
      search: url.searchParams.get("q") ?? "",
      favoritesOnly: queryBool(url, "favorites"),
      showHidden: url.searchParams.has("hidden") ? queryBool(url, "hidden") : undefined,
      groupId: url.searchParams.get("group") ?? "",
      folder: (url.searchParams.get("folder") ?? "") as FolderFilter,
    }))
    .get("/api/songs/:id", ({ params }) => library.get(params.id!))
    .patch("/api/songs/:id", async ({ req, params }) => library.update(params.id!, parseSongPatch(await readJson(req))))
    .post("/api/songs/:id/retry", ({ params }) => {
      generation.retry(params.id!);
      return library.get(params.id!);
    })
    .delete("/api/songs/:id", ({ params }) => generation.remove(params.id!))
    .get("/api/songs/:id/audio", async ({ params, url }) => {
      const file = await library.audio(params.id!, queryBool(url, "download"));
      return new FileResponse(file.path, { downloadName: file.downloadName });
    })
    .get("/api/queue", () => library.queue());
}
