import { ApiError, createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = createLogger("me/discord-guild");

const STORAGE_PREFIX = "bh:guild_sync_v1:";
const pendingSync = new Set<string>();

/**
 * After Discord OAuth, Supabase exposes a short-lived ``provider_token`` with
 * ``guilds.join`` (if configured). Sends it to the API once so the backend can
 * add the user to the guild — no invite URL is ever shown in the UI.
 */
export async function trySyncDiscordGuild(
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) return;

  const session = data.session;
  const providerToken = session.provider_token;
  if (!providerToken) return;

  const meta = session.user.app_metadata;
  const isDiscord =
    (Array.isArray(meta?.providers) && meta.providers.includes("discord")) ||
    meta?.provider === "discord";
  if (!isDiscord) return;

  const uid = session.user.id;
  if (
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem(`${STORAGE_PREFIX}${uid}`)
  ) {
    return;
  }
  if (pendingSync.has(uid)) return;
  pendingSync.add(uid);

  const env = tryPublicEnv();
  if (!env.ok) {
    pendingSync.delete(uid);
    return;
  }

  const api = createApiClient({
    baseUrl: env.data.NEXT_PUBLIC_API_URL,
    getAccessToken: async () => {
      const { data: d } = await supabase.auth.getSession();
      return d.session?.access_token ?? null;
    },
  });

  try {
    await api.fetchJson<{ ok: boolean }>("/discord/join-guild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider_token: providerToken }),
    });
    sessionStorage.setItem(`${STORAGE_PREFIX}${uid}`, "1");
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) {
      log.debug("Discord guild sync skipped (API not configured)");
      return;
    }
    log.warn("Discord guild sync failed", { error: e });
  } finally {
    pendingSync.delete(uid);
  }
}
