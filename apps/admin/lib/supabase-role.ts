import type { User } from "@supabase/supabase-js";

/**
 * Reads `user.app_metadata.role` set by Supabase Auth (custom claims / admin API).
 * Does not reflect the server-side `SUPER_ADMINS` email allowlist — that exists only on FastAPI.
 */
export function appMetadataRole(user: User | null | undefined): string | undefined {
  const r = user?.app_metadata?.role;
  return typeof r === "string" ? r : undefined;
}

/** JWT indicates staff (`admin` or `super_admin`). Used for coarse UI hints only; API enforces `require_admin`. */
export function isStaffUser(user: User | null | undefined): boolean {
  const role = appMetadataRole(user);
  return role === "admin" || role === "super_admin";
}

/**
 * Whether the **client** should show super-admin-only screens (e.g. `/profiles`).
 * Matches one branch of FastAPI `require_super_admin` (JWT role). Allowlisted emails without
 * `super_admin` in JWT will get 403 from the API until `app_metadata.role` is updated in Supabase.
 */
export function isSuperAdminUser(user: User | null | undefined): boolean {
  return appMetadataRole(user) === "super_admin";
}
