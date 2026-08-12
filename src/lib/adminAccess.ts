import type { Database } from "./types";
import { isBootstrapAdminName } from "./bootstrap";

export function normAdminName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Can this display name sign in / act as admin? */
export function canBecomeAdmin(db: Database, name: string): boolean {
  if (isBootstrapAdminName(name)) return true;
  const n = normAdminName(name);
  if (db.adminGrants.some((g) => normAdminName(g.name) === n)) return true;
  // Empty school DB: first successful admin sign-in becomes the bootstrap admin
  // (secure when ADMIN_PASSWORD is set; for local empty demos allows any name once)
  const hasAnyAdmin =
    db.people.some((p) => p.role === "admin") || db.adminGrants.length > 0;
  if (!hasAnyAdmin) return true;
  return false;
}

export function listAllowedAdminNames(db: Database): string[] {
  const fromGrants = db.adminGrants.map((g) => g.name);
  // Include existing admin people
  const existing = db.people.filter((p) => p.role === "admin").map((p) => p.name);
  return [...new Set([...fromGrants, ...existing])];
}
