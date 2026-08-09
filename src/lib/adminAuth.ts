import { timingSafeEqual } from "crypto";

/**
 * Shared admin password for the site (set in env).
 * When unset, name-only admin login still works (local / early testing).
 * When set, every admin sign-in must include this password.
 *
 * Future: per-admin passwords / hashed secrets in the database.
 */
export function getAdminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD?.trim();
  return p ? p : null;
}

export function adminPasswordRequired(): boolean {
  return !!getAdminPassword();
}

export function verifyAdminPassword(password: string | undefined | null): {
  ok: boolean;
  error?: string;
} {
  const expected = getAdminPassword();
  if (!expected) {
    // Not configured — allow name-only (dev / early rollouts)
    return { ok: true };
  }
  if (!password || !password.trim()) {
    return { ok: false, error: "Admin password is required." };
  }
  try {
    const a = Buffer.from(password, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) {
      // Still run a compare-ish path; reject
      return { ok: false, error: "Incorrect admin password." };
    }
    if (!timingSafeEqual(a, b)) {
      return { ok: false, error: "Incorrect admin password." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Incorrect admin password." };
  }
}
