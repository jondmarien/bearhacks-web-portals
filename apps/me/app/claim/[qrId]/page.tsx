"use client";

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";

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
  personal_url?: string | null;
  role?: string | null;
};

type ProfileDraft = {
  display_name: string;
  role: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
  personal_url: string;
};

export default function ClaimQrPage() {
  const params = useParams();
  const qrId = typeof params.qrId === "string" ? params.qrId : "";
  const auth = useMeAuth();
  useDocumentTitle("Claim QR");
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
        personal_url: myProfileQuery.data?.personal_url ?? "",
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
          personal_url: form.personal_url.trim() || undefined,
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
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Claim failed");
    },
  });

  if (!qrId) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
        <PageHeader title="Claim QR" showBack backHref="/" />
        <Card>
          <CardDescription>Missing QR id.</CardDescription>
        </Card>
      </main>
    );
  }

  const profileDraft: ProfileDraft = draft ?? {
    display_name: myProfileQuery.data?.display_name ?? "",
    role: myProfileQuery.data?.role ?? "",
    bio: myProfileQuery.data?.bio ?? "",
    linkedin_url: myProfileQuery.data?.linkedin_url ?? "",
    github_url: myProfileQuery.data?.github_url ?? "",
    personal_url: myProfileQuery.data?.personal_url ?? "",
  };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <PageHeader
        title="Claim your QR"
        subtitle="Confirm your details to link this QR code to your account."
        showBack
        backHref="/"
      />

      {claimStatusQuery.isLoading && (
        <p className="text-sm text-(--bearhacks-muted)">Checking QR status…</p>
      )}
      {claimStatusQuery.isError && (
        <p className="text-sm text-(--bearhacks-danger)">
          {claimStatusQuery.error instanceof ApiError
            ? claimStatusQuery.error.message
            : "Failed to load QR status"}
        </p>
      )}

      {claimStatusQuery.data?.claimed ? (
        <Card className="bg-(--bearhacks-cream) border-b-4 border-b-(--bearhacks-text-marketing)">
          <CardHeader>
            <CardTitle className="text-(--bearhacks-text-marketing)">
              This QR is already claimed
            </CardTitle>
            {ownerProfileQuery.data ? (
              <CardDescription className="text-(--bearhacks-text-marketing)/80">
                Claimed by{" "}
                <span className="font-semibold text-(--bearhacks-text-marketing)">
                  {ownerProfileQuery.data.display_name ?? "an attendee"}
                </span>
                .
              </CardDescription>
            ) : (
              <CardDescription className="text-(--bearhacks-text-marketing)/80">
                Loading owner profile…
              </CardDescription>
            )}
          </CardHeader>
          {ownerProfileQuery.data ? (
            <Link
              href={`/contacts/${ownerProfileQuery.data.id}`}
              className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-6 py-3 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
            >
              View profile →
            </Link>
          ) : null}
        </Card>
      ) : null}

      {claimStatusQuery.data && !claimStatusQuery.data.claimed ? (
        <>
          {!auth?.isAuthReady ? (
            <p className="text-sm text-(--bearhacks-muted)">Checking session…</p>
          ) : !auth.user ? (
            <Card>
              <CardHeader>
                <CardTitle>Sign in to claim</CardTitle>
                <CardDescription>
                  Use Google or LinkedIn to link this QR to your attendee account.
                </CardDescription>
              </CardHeader>
              <DashboardOAuthButtons />
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Confirm your details</CardTitle>
                <CardDescription>
                  Display name and role are required. Everything else is optional.
                </CardDescription>
              </CardHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  claimMutation.mutate();
                }}
              >
                <InputField
                  label="Display name"
                  required
                  value={profileDraft.display_name}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...profileDraft, display_name: event.target.value })
                  }
                  placeholder="Your name"
                  autoComplete="name"
                />
                <InputField
                  label="Role or title"
                  required
                  value={profileDraft.role}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...profileDraft, role: event.target.value })
                  }
                  placeholder="Hacker, Mentor, Sponsor…"
                />
                <TextareaField
                  label="Bio"
                  value={profileDraft.bio}
                  rows={3}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft({ ...profileDraft, bio: event.target.value })
                  }
                  placeholder="Optional"
                />
                <InputField
                  label="LinkedIn URL"
                  type="url"
                  value={profileDraft.linkedin_url}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...profileDraft, linkedin_url: event.target.value })
                  }
                  placeholder="https://linkedin.com/in/you"
                />
                <InputField
                  label="GitHub URL"
                  type="url"
                  value={profileDraft.github_url}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...profileDraft, github_url: event.target.value })
                  }
                  placeholder="https://github.com/you"
                />
                <InputField
                  label="Personal link"
                  type="url"
                  value={profileDraft.personal_url}
                  onChange={(event: React.ChangeEvent<HTMLInputElement> ) =>
                    setDraft({ ...profileDraft, personal_url: event.target.value })
                  }
                  placeholder="https://yourportfolio.com"
                  hint="Portfolio, project, or anything you want to share."
                />
                <div>
                  <Button type="submit" disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? "Claiming…" : "Claim this QR"}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </>
      ) : null}
    </main>
  );
}
