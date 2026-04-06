import { ApiError, createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = createLogger("me/portal-access");

export type PortalForbiddenReason = "not_accepted" | "missing_email";

function portalForbiddenReason(error: unknown): PortalForbiddenReason | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const d = error.detail;
  if (d && typeof d === "object" && "code" in d) {
    const code = (d as { code: string }).code;
    if (code === "email_not_accepted") return "not_accepted";
    if (code === "missing_email") return "missing_email";
  }
  return null;
}

export type PortalAccessResult =
  | { allowed: true }
  | { allowed: false; reason: PortalForbiddenReason };

/**
 * Verifies the signed-in user is on the accepted-hacker allowlist (or staff bypass on the API).
 * On network / unexpected errors, allows access so we do not sign users out.
 */
export async function checkPortalAccess(
  supabase: SupabaseClient,
): Promise<PortalAccessResult> {
  const env = tryPublicEnv();
  if (!env.ok) return { allowed: true };

  const api = createApiClient({
    baseUrl: env.data.NEXT_PUBLIC_API_URL,
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });

  try {
    await api.fetchJson<{ ok: boolean }>("/portal/access", { method: "GET" });
    return { allowed: true };
  } catch (e) {
    const r = portalForbiddenReason(e);
    if (r) {
      log.warn("Portal access denied", { reason: r });
      return { allowed: false, reason: r };
    }
    log.warn("Portal access check failed (non-fatal)", { error: e });
    return { allowed: true };
  }
}

function claimEmailDetailMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not verify that email.";
  const d = error.detail;
  const msg =
    d && typeof d === "object" && "message" in d && typeof (d as { message: unknown }).message === "string"
      ? (d as { message: string }).message
      : undefined;
  if (error.status === 409) {
    return msg ?? "This acceptance email is already linked to another account.";
  }
  if (error.status === 400) {
    return msg ?? "That email is not on the accepted hacker list.";
  }
  return "Could not verify that email.";
}

/**
 * Stores the application email for this Supabase user; must exist in ``accepted_hacker_emails``.
 */
export async function claimPortalEmail(supabase: SupabaseClient, email: string): Promise<void> {
  const env = tryPublicEnv();
  if (!env.ok) throw new Error("App configuration is incomplete.");

  const api = createApiClient({
    baseUrl: env.data.NEXT_PUBLIC_API_URL,
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });

  try {
    await api.fetchJson<{ ok: boolean }>("/portal/claim-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch (e) {
    throw new Error(claimEmailDetailMessage(e));
  }
}
