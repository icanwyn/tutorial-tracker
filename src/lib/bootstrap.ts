/**
 * Hardcoded people allowed to become the first admin(s).
 * Match is case-insensitive on display name.
 *
 * After bootstrap, those admins can grant access to other admins in the UI.
 * You can also set BOOTSTRAP_ADMIN_NAMES=Name1,Name2 in the environment.
 */
const DEFAULT_BOOTSTRAP_ADMINS = [
  "Lisa",
  "Principal Lee",
  "Admin",
];

export function getBootstrapAdminNames(): string[] {
  const fromEnv =
    typeof process !== "undefined" && process.env.BOOTSTRAP_ADMIN_NAMES
      ? process.env.BOOTSTRAP_ADMIN_NAMES.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  return [...new Set([...DEFAULT_BOOTSTRAP_ADMINS, ...fromEnv])];
}

export function isBootstrapAdminName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return getBootstrapAdminNames().some((b) => b.trim().toLowerCase() === n);
}
