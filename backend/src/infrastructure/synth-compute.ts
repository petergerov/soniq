// Ermittelt, ob der Synthese-Server auf CPU oder GPU läuft (aus ace-server.log).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SynthCompute } from "../../../shared/api.ts";

/** Letztes bekanntes DiT/VAE-Backend aus dem Synth-Log lesen. */
export function readSynthCompute(dataDir: string): SynthCompute {
  let text = "";
  try {
    text = readFileSync(join(dataDir, "ace-server.log"), "utf8");
  } catch {
    return { mode: "unknown", device: "", kind: "" };
  }
  // z. B. "[Load] DiT backend: MTL0 (CPU threads: 5)" oder "VAE-Enc backend: CUDA0"
  const loads = [...text.matchAll(/\[Load\]\s+\S+\s+backend:\s+(\S+)/g)];
  const device = loads.at(-1)?.[1] ?? "";
  if (!device) return { mode: "unknown", device: "", kind: "" };
  return classify(device);
}

function classify(device: string): SynthCompute {
  const d = device.toUpperCase();
  if (d === "CPU" || d.startsWith("BLAS")) return { mode: "cpu", device, kind: "CPU" };
  if (d.startsWith("MTL") || d.includes("METAL")) return { mode: "gpu", device, kind: "Metal" };
  if (d.startsWith("CUDA")) return { mode: "gpu", device, kind: "CUDA" };
  if (d.startsWith("VULKAN") || d.startsWith("VK")) return { mode: "gpu", device, kind: "Vulkan" };
  if (d.startsWith("HIP") || d.startsWith("ROCM")) return { mode: "gpu", device, kind: "ROCm" };
  // Unbekanntes GPU-Backend (nicht CPU)
  return { mode: "gpu", device, kind: device };
}
