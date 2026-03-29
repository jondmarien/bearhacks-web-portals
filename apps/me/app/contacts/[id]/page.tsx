"use client";

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";

type PublicProfile = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
};

export default function ContactPage() {
  const params = useParams();
  const profileId = typeof params.id === "string" ? params.id : "";
  const supabase = useSupabase();
  const client = useApiClient();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const profileQuery = useQuery({
    queryKey: ["public-profile", profileId],
    queryFn: () => client!.fetchJson<PublicProfile>(`/profiles/${profileId}`),
    enabled: Boolean(client && profileId),
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
        toast.error("Sign in to favourite this contact.");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Failed to update favourite");
    },
  });

  if (!profileId) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <p className="text-sm text-(--bearhacks-muted)">Missing contact id.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Contact profile</h1>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Public profile view works without auth. Favouriting requires sign-in.
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
                if (!user) {
                  toast.error("Sign in to favourite contacts.");
                  return;
                }
                favouriteMutation.mutate();
              }}
              disabled={favouriteMutation.isPending}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              {favouriteMutation.isPending ? "Saving…" : "Favourite"}
            </button>
          </div>
        </section>
      )}

      {!user && (
        <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-border)/15 p-4 text-sm text-(--bearhacks-muted)">
          Want to save favourites? Sign in first, then if you have not claimed a QR yet, scan an unclaimed event QR
          and complete your profile from dashboard.
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
