import type { Database } from "./types";
import { isBootstrapAdminName } from "./bootstrap";

export function normAdminName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Can this display name sign in / act as admin? */
export function canBecomeAdmin(db: Database, name: string): boolean {
  if (isBootstrapAdminName(name)) return true;
  const n = normAdminName(name);
  return db.adminGrants.some((g) => normAdminName(g.name) === n);
}

export function listAllowedAdminNames(db: Database): string[] {
  const fromGrants = db.adminGrants.map((g) => g.name);
  // Include existing admin people
  const existing = db.people.filter((p) => p.role === "admin").map((p) => p.name);
  return [...new Set([...fromGrants, ...existing])];
}
