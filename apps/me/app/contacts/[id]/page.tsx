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
            <CardTitle>{profile.display_name ?? "Unnamed attendee"}</CardTitle>
            {profile.role ? (
              <CardDescription>{profile.role}</CardDescription>
            ) : null}
          </CardHeader>

          {profile.bio ? (
            <p className="whitespace-pre-line text-sm text-(--bearhacks-fg)">
              {profile.bio}
            </p>
          ) : null}

          {(profile.linkedin_url || profile.github_url || profile.personal_url) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {profile.linkedin_url ? (
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
                >
                  LinkedIn
                </a>
              ) : null}
              {profile.github_url ? (
                <a
                  href={profile.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
                >
                  GitHub
                </a>
              ) : null}
              {profile.personal_url ? (
                <a
                  href={profile.personal_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
                >
                  Personal site
                </a>
              ) : null}
            </div>
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
