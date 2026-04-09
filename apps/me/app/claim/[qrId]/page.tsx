"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { useApiClient } from "@/lib/use-api-client";

const log = createLogger("me/claim-page");

type ClaimStatus = {
  id: string;
  claimed: boolean;
  claimed_by?: string | null;
  claimed_at?: string | null;
};

type Profile = {
  id: string;
  display_name?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  role?: string | null;
};

type ProfileDraft = {
  display_name: string;
  role: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
};

export default function ClaimQrPage() {
  const params = useParams();
  const qrId = typeof params.qrId === "string" ? params.qrId : "";
  const auth = useMeAuth();
  const client = useApiClient();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  const claimStatusQuery = useQuery({
    queryKey: ["claim-status", qrId],
    queryFn: () => client!.fetchJson<ClaimStatus>(`/claim/${qrId}`),
    enabled: Boolean(client && qrId),
  });

  const viewerId = auth?.user?.id ?? null;
  const claimOwnerId = claimStatusQuery.data?.claimed_by ?? null;

  const ownerProfileQuery = useQuery({
    queryKey: ["claim-owner-profile", claimOwnerId],
    queryFn: () => client!.fetchJson<Profile>(`/profiles/${claimOwnerId}`),
    enabled: Boolean(client && claimStatusQuery.data?.claimed && claimOwnerId),
  });

  const myProfileQuery = useQuery({
    queryKey: ["claim-my-profile", viewerId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<Profile>(`/profiles/${viewerId}`);
      } catch (error) {
        // First-time OAuth users may not have a row until first write.
        if (error instanceof ApiError && error.status === 404) {
          await client!.fetchJson<Profile>("/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          return await client!.fetchJson<Profile>(`/profiles/${viewerId}`);
        }
        throw error;
      }
    },
    enabled: Boolean(client && viewerId && claimStatusQuery.data && !claimStatusQuery.data.claimed),
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const form = draft ?? {
        display_name: myProfileQuery.data?.display_name ?? "",
        role: myProfileQuery.data?.role ?? "",
        bio: myProfileQuery.data?.bio ?? "",
        linkedin_url: myProfileQuery.data?.linkedin_url ?? "",
        github_url: myProfileQuery.data?.github_url ?? "",
      };
      if (!form.display_name.trim() || !form.role.trim()) {
        throw new Error("Display name and role are required");
      }

      await client!.fetchJson<Profile>("/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          role: form.role.trim(),
          bio: form.bio.trim() || undefined,
          linkedin_url: form.linkedin_url.trim() || undefined,
          github_url: form.github_url.trim() || undefined,
        }),
      });

      return client!.fetchJson<{ success: boolean; qr_id: string }>(`/claim/${qrId}`, {
        method: "POST",
      });
    },
    onSuccess: async () => {
      toast.success("QR claimed successfully");
      await claimStatusQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          toast.error("Sign in to your participant account first");
          return;
        }
        if (error.status === 409) {
          toast.error(error.message);
          return;
        }
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Claim failed");
    },
  });

  if (!qrId) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <p className="text-sm text-(--bearhacks-muted)">Missing QR id.</p>
      </main>
    );
  }

  const profileDraft: ProfileDraft = draft ?? {
    display_name: myProfileQuery.data?.display_name ?? "",
    role: myProfileQuery.data?.role ?? "",
    bio: myProfileQuery.data?.bio ?? "",
    linkedin_url: myProfileQuery.data?.linkedin_url ?? "",
    github_url: myProfileQuery.data?.github_url ?? "",
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Claim QR</h1>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Scan flow: authenticate, complete required profile fields, then claim once.
        </p>
      </header>

      {claimStatusQuery.isLoading && <p className="text-sm text-(--bearhacks-muted)">Checking QR status…</p>}
      {claimStatusQuery.isError && (
        <p className="text-sm text-red-700">
          {claimStatusQuery.error instanceof ApiError ? claimStatusQuery.error.message : "Failed to load QR status"}
        </p>
      )}

      {claimStatusQuery.data?.claimed ? (
        <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
          <h2 className="text-base font-medium text-(--bearhacks-fg)">This QR is already claimed</h2>
          {ownerProfileQuery.data ? (
            <>
              <p className="mt-2 text-sm text-(--bearhacks-muted)">
                Claimed by <span className="text-(--bearhacks-fg)">{ownerProfileQuery.data.display_name ?? "an attendee"}</span>
              </p>
              <Link href={`/contacts/${ownerProfileQuery.data.id}`} className="mt-3 inline-flex min-h-(--bearhacks-touch-min) items-center underline">
                View public profile
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-(--bearhacks-muted)">Loading claimed profile…</p>
          )}
        </section>
      ) : null}

      {claimStatusQuery.data && !claimStatusQuery.data.claimed ? (
        <>
          {!auth?.isAuthReady ? (
            <p className="text-sm text-(--bearhacks-muted)">Checking session…</p>
          ) : !auth.user ? (
            <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
              <p className="text-sm text-(--bearhacks-muted)">
                Claiming links this QR to your attendee account. Sign in with Google, Apple, LinkedIn, or Meta (use
                the JOIN flow on the home page only for Discord server access).
              </p>
              <div className="mt-3">
                <DashboardOAuthButtons />
              </div>
            </section>
          ) : (
            <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
              <h2 className="text-base font-medium text-(--bearhacks-fg)">Complete required profile fields</h2>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  claimMutation.mutate();
                }}
              >
                <input
                  value={profileDraft.display_name}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      display_name: event.target.value,
                      role: prev?.role ?? profileDraft.role,
                      bio: prev?.bio ?? profileDraft.bio,
                      linkedin_url: prev?.linkedin_url ?? profileDraft.linkedin_url,
                      github_url: prev?.github_url ?? profileDraft.github_url,
                    }))
                  }
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                  placeholder="Display name (required)"
                />
                <input
                  value={profileDraft.role}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      display_name: prev?.display_name ?? profileDraft.display_name,
                      role: event.target.value,
                      bio: prev?.bio ?? profileDraft.bio,
                      linkedin_url: prev?.linkedin_url ?? profileDraft.linkedin_url,
                      github_url: prev?.github_url ?? profileDraft.github_url,
                    }))
                  }
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                  placeholder="Role (required)"
                />
                <textarea
                  value={profileDraft.bio}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      display_name: prev?.display_name ?? profileDraft.display_name,
                      role: prev?.role ?? profileDraft.role,
                      bio: event.target.value,
                      linkedin_url: prev?.linkedin_url ?? profileDraft.linkedin_url,
                      github_url: prev?.github_url ?? profileDraft.github_url,
                    }))
                  }
                  rows={3}
                  className="rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 py-2 text-base"
                  placeholder="Bio (optional)"
                />
                <button
                  type="submit"
                  disabled={claimMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:opacity-60"
                >
                  {claimMutation.isPending ? "Claiming…" : "Claim this QR"}
                </button>
              </form>
            </section>
          )}
        </>
      ) : null}

      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Portal
        </Link>
      </nav>
    </main>
  );
}
