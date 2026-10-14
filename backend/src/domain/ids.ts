import { randomBytes, randomInt } from "node:crypto";

/** Kurze, zufällige ID (12 Hex-Zeichen) für Songs, Gruppen und Ordner. */
export function newId(): string {
  return randomBytes(6).toString("hex");
}

export function randomSeed(): number {
  return randomInt(0, 2 ** 31 - 1);
}
