"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { queuePendingScan } from "@/lib/pending-scans";
import { useApiClient } from "@/lib/use-api-client";

const log = createLogger("me/contact-page");

type PublicProfile = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  personal_url?: string | null;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.host}${path}${u.search}`;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export default function ContactPage() {
  const params = useParams();
  const router = useRouter();
  const profileId = typeof params.id === "string" ? params.id : "";
  const validProfileId = isUuidLike(profileId);
  const auth = useMeAuth();
  const client = useApiClient();
  const didTrackScanRef = useRef(false);
  const isOwnProfile = Boolean(auth?.user?.id && auth.user.id === profileId);

  const profileQuery = useQuery({
    queryKey: ["public-profile", profileId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<PublicProfile>(`/profiles/${profileId}`);
      } catch (error) {
        log.error("Failed to load public profile", { profileId, error });
        throw error;
      }
    },
    enabled: Boolean(client && validProfileId),
  });

  const favouriteMutation = useMutation({
    mutationFn: () =>
      client!.fetchJson<{ favourited: boolean }>(`/social/favourite/${profileId}`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      toast.success(result.favourited ? "Added to favourites" : "Removed from favourites");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        router.push(`/?next=${encodeURIComponent(`/contacts/${profileId}`)}`);
        return;
      }
      log.error("Failed to update favourite", { profileId, error });
      toast.error(error instanceof ApiError ? error.message : "Failed to update favourite");
    },
  });

  useEffect(() => {
    if (!validProfileId || !profileQuery.data) return;
    if (didTrackScanRef.current) return;
    didTrackScanRef.current = true;

    if (!auth?.user) {
      queuePendingScan(profileId);
      return;
    }

    if (auth.user.id === profileId) return;

    void client
      ?.fetchJson<{ success: boolean }>(`/social/scan/${profileId}`, { method: "POST" })
      .catch((error) => {
        log.warn("Failed to auto-save scan from contact page", { profileId, error });
      });
  }, [auth?.user, client, profileId, profileQuery.data, validProfileId]);

  if (!profileId || !validProfileId) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
        <PageHeader title="Profile not found" showBack backHref="/" />
        <Card>
          <CardDescription>
            This route needs a real attendee profile id.
          </CardDescription>
        </Card>
      </main>
    );
  }

  const profile = profileQuery.data;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <PageHeader
        title={isOwnProfile ? "My profile" : "Attendee profile"}
        subtitle={
          isOwnProfile
            ? "This is what other attendees see when they scan your QR."
            : undefined
        }
        showBack
        backHref={isOwnProfile ? "/" : undefined}
        tone="marketing"
      />

      {profileQuery.isLoading && (
        <p className="text-sm text-(--bearhacks-muted)">Loading profile…</p>
      )}
      {profileQuery.isError && (
        <p className="text-sm text-red-700">
          {profileQuery.error instanceof ApiError
            ? profileQuery.error.message
            : "Failed to load profile"}
        </p>
      )}

      {profile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-extrabold text-(--bearhacks-text-marketing) sm:text-3xl">
              {profile.display_name ?? "Unnamed attendee"}
            </CardTitle>
            {profile.role ? (
              <CardDescription className="uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                {profile.role}
              </CardDescription>
            ) : null}
          </CardHeader>

          {profile.bio ? (
            <p className="whitespace-pre-line text-sm text-(--bearhacks-fg)">
              {profile.bio}
            </p>
          ) : null}

          {(profile.linkedin_url || profile.github_url || profile.personal_url) && (
            <ul className="mt-4 flex flex-col gap-2">
              {profile.linkedin_url ? (
                <li>
                  <a
                    href={profile.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-(--bearhacks-touch-min) items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3 no-underline hover:bg-(--bearhacks-accent-soft)"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-5 w-5 shrink-0 text-(--bearhacks-primary)"
                    >
                      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.38 4.28 5.47v6.27zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
                    </svg>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-xs font-semibold uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                        LinkedIn
                      </span>
                      <span className="truncate text-sm font-medium text-(--bearhacks-primary) underline underline-offset-2">
                        {displayUrl(profile.linkedin_url)}
                      </span>
                    </div>
                  </a>
                </li>
              ) : null}
              {profile.github_url ? (
                <li>
                  <a
                    href={profile.github_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-(--bearhacks-touch-min) items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3 no-underline hover:bg-(--bearhacks-accent-soft)"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-5 w-5 shrink-0 text-(--bearhacks-primary)"
                    >
                      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.97-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.07.78 2.16 0 1.56-.02 2.81-.02 3.19 0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
                    </svg>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-xs font-semibold uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                        GitHub
                      </span>
                      <span className="truncate text-sm font-medium text-(--bearhacks-primary) underline underline-offset-2">
                        {displayUrl(profile.github_url)}
                      </span>
                    </div>
                  </a>
                </li>
              ) : null}
              {profile.personal_url ? (
                <li>
                  <a
                    href={profile.personal_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-(--bearhacks-touch-min) items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3 no-underline hover:bg-(--bearhacks-accent-soft)"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5 shrink-0 text-(--bearhacks-primary)"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-xs font-semibold uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                        Personal site
                      </span>
                      <span className="truncate text-sm font-medium text-(--bearhacks-primary) underline underline-offset-2">
                        {displayUrl(profile.personal_url)}
                      </span>
                    </div>
                  </a>
                </li>
              ) : null}
            </ul>
          )}

          <div className="mt-6">
            {isOwnProfile ? (
              <Button onClick={() => router.push("/")}>Edit profile</Button>
            ) : (
              <Button
                onClick={() => {
                  if (!auth?.user) {
                    router.push(
                      `/?next=${encodeURIComponent(`/contacts/${profileId}`)}`,
                    );
                    return;
                  }
                  favouriteMutation.mutate();
                }}
                disabled={favouriteMutation.isPending}
              >
                {favouriteMutation.isPending
                  ? "Saving…"
                  : auth?.user
                    ? "Favourite"
                    : "Sign in to favourite"}
              </Button>
            )}
          </div>
        </Card>
      )}
    </main>
  );
}
