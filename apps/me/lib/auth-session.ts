import type { User } from "@supabase/supabase-js";

/** True when the active Supabase user last signed in with Discord (guild join path). */
export function isDiscordBackedUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata;
  return (
    (Array.isArray(meta?.providers) && meta.providers.includes("discord")) || meta?.provider === "discord"
  );
}

/** Human-readable label for the primary OAuth provider on this session. */
export function primaryAuthProviderLabel(user: User): string {
  const meta = user.app_metadata;
  const raw =
    (Array.isArray(meta?.providers) && meta.providers.length > 0 && meta.providers[0]) ||
    (typeof meta?.provider === "string" ? meta.provider : null);
  switch (raw) {
    case "google":
      return "Google";
    case "apple":
      return "Apple";
    case "facebook":
      return "Meta";
    case "linkedin_oidc":
      return "LinkedIn";
    case "discord":
      return "Discord";
    default:
      return raw ? raw.replace(/_/g, " ") : "OAuth";
  }
}
