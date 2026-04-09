"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
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
        router.push(`/dashboard?next=${encodeURIComponent(`/contacts/${profileId}`)}`);
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

  if (!profileId) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <p className="text-sm text-(--bearhacks-muted)">Missing contact id.</p>
      </main>
    );
  }

  if (!validProfileId) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Contact profile</h1>
        <p className="mt-2 text-sm text-(--bearhacks-muted)">
          This route needs a real profile UUID. The sample `demo-id` is only a placeholder.
        </p>
        <nav className="mt-4 flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
            Dashboard
          </Link>
          <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
            Home
          </Link>
        </nav>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Contact profile</h1>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Public profile view works without login. Favouriting sends you to sign in on the dashboard.
        </p>
      </header>

      {profileQuery.isLoading && <p className="text-sm text-(--bearhacks-muted)">Loading profile…</p>}
      {profileQuery.isError && (
        <p className="text-sm text-red-700">
          {profileQuery.error instanceof ApiError ? profileQuery.error.message : "Failed to load profile"}
        </p>
      )}

      {profileQuery.data && (
        <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
          <h2 className="text-lg font-medium text-(--bearhacks-fg)">
            {profileQuery.data.display_name ?? "Unnamed attendee"}
          </h2>
          {profileQuery.data.role && (
            <p className="mt-1 text-sm text-(--bearhacks-muted)">
              Role: <span className="text-(--bearhacks-fg)">{profileQuery.data.role}</span>
            </p>
          )}
          {profileQuery.data.bio && <p className="mt-3 text-sm text-(--bearhacks-fg)">{profileQuery.data.bio}</p>}

          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {profileQuery.data.linkedin_url && (
              <a
                href={profileQuery.data.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-(--bearhacks-touch-min) items-center underline"
              >
                LinkedIn
              </a>
            )}
            {profileQuery.data.github_url && (
              <a
                href={profileQuery.data.github_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-(--bearhacks-touch-min) items-center underline"
              >
                GitHub
              </a>
            )}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => {
                if (!auth?.user) {
                  router.push(`/dashboard?next=${encodeURIComponent(`/contacts/${profileId}`)}`);
                  return;
                }
                favouriteMutation.mutate();
              }}
              disabled={favouriteMutation.isPending}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              {favouriteMutation.isPending ? "Saving…" : auth?.user ? "Favourite" : "Sign in to favourite"}
            </button>
          </div>
        </section>
      )}

      <nav className="flex items-center gap-4 text-sm">
        <Link href="/dashboard" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Dashboard
        </Link>
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Home
        </Link>
      </nav>
    </main>
  );
}
