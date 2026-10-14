// Prüft, ob das Sprachmodell auf der Grafikkarte (Metal/CUDA/Vulkan) brauchbar rechnet.
//
// Beide Phasen werden getestet: Phase 1 plant Tempo, Tonart und Takt (deshalb geben wir sie
// nicht vor), Phase 2 erzeugt die Audio-Codes. Auf dem Apple M4 scheitert mit acestep.cpp b7ba6d9
// das 1.7B-Modell unter Metal an beidem (Phase 1 läuft ins Token-Limit, danach 0 Codes),
// das 0.6B-Modell dagegen funktioniert.
//
// Aufruf: node backend/src/cli/selftest.ts <port> [lm_datei]
// Exit 0 = Grafikkarte ok (ein Server reicht), Exit 1 = Sprachmodell muss auf die CPU.
import { judge, runLanguageModel } from "../infrastructure/lm-selftest.ts";

async function main(): Promise<number> {
  const [port, lmFile = ""] = process.argv.slice(2);
  if (!port) {
    console.log("Usage: selftest.ts <port> [lm_file]");
    return 2;
  }
  try {
    const { ok, summary } = judge(await runLanguageModel(`http://127.0.0.1:${port}`, lmFile));
    console.log(`Self-test: ${summary}`);
    return ok ? 0 : 1;
  } catch (e) {
    console.log(`Self-test: ${(e as Error).message}`);
    return 1;
  }
}

process.exitCode = await main();
