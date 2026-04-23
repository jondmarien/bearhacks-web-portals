import { ApiError, createApiClient, describeApiError } from "@bearhacks/api-client";
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

function isOtpRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const d = error.detail;
  return Boolean(d && typeof d === "object" && "code" in d && (d as { code: string }).code === "otp_required");
}

function createPortalApi(supabase: SupabaseClient) {
  const env = tryPublicEnv();
  if (!env.ok) throw new Error("App configuration is incomplete.");
  return createApiClient({
    baseUrl: env.data.NEXT_PUBLIC_API_URL,
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
}

/**
 * Try to link acceptance email when it matches the OAuth email (no OTP).
 * Otherwise returns ``otp_required`` for the verification-code flow.
 */
export async function submitPortalClaimEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<"verified" | "otp_required"> {
  const api = createPortalApi(supabase);
  try {
    await api.fetchJson<{ ok: boolean }>("/portal/claim-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    return "verified";
  } catch (e) {
    if (isOtpRequiredError(e)) return "otp_required";
    throw new Error(describeApiError(e));
  }
}

/** Send a one-time code to the acceptance email (after ``otp_required``). */
export async function requestPortalClaimOtp(supabase: SupabaseClient, email: string): Promise<void> {
  const api = createPortalApi(supabase);
  try {
    await api.fetchJson<{ ok: boolean }>("/portal/claim-email/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch (e) {
    throw new Error(describeApiError(e));
  }
}

/** Verify OTP and complete ``portal_email_claims``. */
export async function verifyPortalClaimOtp(
  supabase: SupabaseClient,
  email: string,
  code: string,
): Promise<void> {
  const api = createPortalApi(supabase);
  try {
    await api.fetchJson<{ ok: boolean }>("/portal/claim-email/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        code: code.trim(),
      }),
    });
  } catch (e) {
    throw new Error(describeApiError(e));
  }
}
