import type { User } from "@supabase/supabase-js";

type MetadataRecord = Record<string, unknown>;

function pickStringValue(record: MetadataRecord, key: string): string | null {
  const raw = record[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readIdentityMetadata(user: User): MetadataRecord {
  const firstIdentity = user.identities?.[0];
  const identityData = firstIdentity?.identity_data;
  if (identityData && typeof identityData === "object") {
    return identityData as MetadataRecord;
  }
  return {};
}

/**
 * Best-effort display name from OAuth metadata (Google/LinkedIn),
 * with email local-part fallback so new profiles are never blank.
 */
export function getOAuthDisplayName(user: User | null | undefined): string {
  if (!user) return "";

  const userMetadata = (user.user_metadata ?? {}) as MetadataRecord;
  const identityMetadata = readIdentityMetadata(user);
  const sources = [userMetadata, identityMetadata];

  for (const source of sources) {
    const direct =
      pickStringValue(source, "full_name") ||
      pickStringValue(source, "name") ||
      pickStringValue(source, "preferred_username");
    if (direct) return direct;

    const first = pickStringValue(source, "given_name") || pickStringValue(source, "first_name");
    const last = pickStringValue(source, "family_name") || pickStringValue(source, "last_name");
    const combined = [first, last].filter(Boolean).join(" ").trim();
    if (combined) return combined;
  }

  const email = user.email?.trim();
  if (!email) return "";
  return email.split("@")[0] ?? "";
}
