import { randomBytes } from "crypto";

export function uid(prefix = ""): string {
  const id = randomBytes(6).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

/** Short human-friendly join codes (e.g. K7M2PQ) */
export function joinCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Unique student IDs like STU-A3F9C2 */
export function studentId(): string {
  return `STU-${randomBytes(3).toString("hex").toUpperCase()}`;
}
