import { statSync } from "node:fs";
import { stat } from "node:fs/promises";

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function isFileSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
