"use client";

import { useMeAuth } from "@/app/providers";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { getOAuthDisplayName } from "@/lib/oauth-display-name";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  ApiError,
  describeApiError,
  getApiErrorCode,
} from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ClaimStatus = {
  id: string;
  claimed: boolean;
  claimed_by?: string | null;
  claimed_at?: string | null;
};

type Profile = {
  id: string;
  qr_id?: string | null;
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

// Mirrors `core.auth.PORTAL_ELEVATED_PROFILE_ROLES`. These roles can only be
// assigned to `profiles.role` by a super-admin via `PATCH /profiles/{id}`;
// seeing one on a user's row is proof that a super-admin vouched for them and
// is sufficient for `require_accepted_hacker` to grant portal access (QR
// claim, boba orders, wallet, etc.) even when the user isn't on the accepted
// hacker allowlist.
const PORTAL_ELEVATED_PROFILE_ROLES: ReadonlySet<string> = new Set([
  "Organizer",
  "Mentor",
  "Sponsor",
  "Volunteer",
  "Founder",
  "Director",
]);

function isElevatedPortalRole(role: string | null | undefined): boolean {
  return typeof role === "string" && PORTAL_ELEVATED_PROFILE_ROLES.has(role);
}

function describeClaimError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Sign in to your participant account first.";
    }
    if (error.status === 403) {
      const code = getApiErrorCode(error);
      if (code === "email_not_accepted") {
        return "You are not in the Approved Hackers List. Please be sure you are using the same email that you applied with. Open a ticket with an organizer if there is a mistake.";
      }
      if (code === "missing_email") {
        return "We couldn't read the email on your account. Sign in again with a provider that shares your email (Google or LinkedIn).";
      }
    }
    if (error.status === 404) {
      return "That QR code doesn't exist. Double-check the link and try again.";
    }
    if (error.status === 409) {
      const detailText = typeof error.detail === "string" ? error.detail : null;
      if (detailText === "QR already claimed") {
        return "This QR has already been claimed by another attendee.";
      }
      if (detailText === "User already claimed a QR") {
        return "You've already claimed a QR. You can only claim one per account.";
      }
    }
    if (error.status === 429) {
      return "Too many attempts. Please wait a few seconds and try again.";
    }
  }
  return describeApiError(error, "Claim failed");
}

function describeClaimStatusError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return "That QR code doesn't exist. Double-check the link and try again.";
  }
  return describeApiError(error, "Failed to load QR status");
}

export default function ClaimQrPage() {
  const params = useParams();
  const router = useRouter();
  const qrId = typeof params.qrId === "string" ? params.qrId : "";
  const auth = useMeAuth();
  useDocumentTitle("Claim QR");
  const client = useApiClient();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const oauthDisplayName = getOAuthDisplayName(auth?.user);

  const claimStatusQuery = useQuery({
    queryKey: ["claim-status", qrId],
    queryFn: () => client!.fetchJson<ClaimStatus>(`/claim/${qrId}`),
    enabled: Boolean(client && qrId),
  });

  const viewerId = auth?.user?.id ?? null;
  const claimOwnerId = claimStatusQuery.data?.claimed_by ?? null;

  // Scanning a claimed QR is a "show me this attendee" intent, not a "claim"
  // intent — so as soon as the status query confirms the QR is claimed, send
  // the visitor to the owner's contact page where they can view the profile
  // and favourite them. `router.replace` keeps /claim/{qrId} out of history
  // so the browser back button doesn't bounce them right back here.
  useEffect(() => {
    if (claimStatusQuery.data?.claimed && claimOwnerId) {
      router.replace(`/contacts/${claimOwnerId}`);
    }
  }, [claimStatusQuery.data?.claimed, claimOwnerId, router]);

  const myProfileQuery = useQuery({
    queryKey: ["claim-my-profile", viewerId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<Profile>(`/profiles/${viewerId}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          const initialBody = oauthDisplayName
            ? { display_name: oauthDisplayName }
            : {};
          await client!.fetchJson<Profile>("/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(initialBody),
          });
          return await client!.fetchJson<Profile>(`/profiles/${viewerId}`);
        }
        throw error;
      }
    },
    enabled: Boolean(
      client &&
      viewerId &&
      claimStatusQuery.data &&
      !claimStatusQuery.data.claimed,
    ),
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const form = draft ?? {
        display_name: myProfileQuery.data?.display_name ?? oauthDisplayName,
        role: myProfileQuery.data?.role ?? "",
        bio: myProfileQuery.data?.bio ?? "",
        linkedin_url: myProfileQuery.data?.linkedin_url ?? "",
        github_url: myProfileQuery.data?.github_url ?? "",
        personal_url: myProfileQuery.data?.personal_url ?? "",
      };
      const originalRole = (myProfileQuery.data?.role ?? "").trim();
      const trimmedRole = form.role.trim();
      // `role` has the only self-assignment gate on PATCH /profiles/me
      // (`SELF_ASSIGNABLE_PROFILE_ROLES = {"Hacker"}` — see
      // `routers/profiles.py`). Skipping it when unchanged avoids both:
      //   1. 403 for users whose super-admin-assigned role (Sponsor, Mentor,
      //      Volunteer, Organizer, Founder, Director) is already correct,
      //      since re-sending it trips the escalation guard.
      //   2. Clobbering that super-admin assignment with "Hacker" if the user
      //      leaves the field as-is.
      const roleChanged = trimmedRole !== originalRole;
      if (!form.display_name.trim() || (roleChanged && !trimmedRole)) {
        throw new Error("Display name and role are required");
      }
      if (!trimmedRole && !originalRole) {
        throw new Error("Display name and role are required");
      }

      const profileUpdates: Record<string, string | undefined> = {
        display_name: form.display_name.trim(),
        bio: form.bio.trim() || undefined,
        linkedin_url: form.linkedin_url.trim() || undefined,
        github_url: form.github_url.trim() || undefined,
        personal_url: form.personal_url.trim() || undefined,
      };
      if (roleChanged && trimmedRole) {
        profileUpdates.role = trimmedRole;
      }

      await client!.fetchJson<Profile>("/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileUpdates),
      });

      return client!.fetchJson<{ success: boolean; qr_id: string }>(
        `/claim/${qrId}`,
        {
          method: "POST",
        },
      );
    },
    onSuccess: async () => {
      toast.success("QR claimed successfully");
      await claimStatusQuery.refetch();
    },
    onError: (error) => {
      toast.error(describeClaimError(error));
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
    display_name: myProfileQuery.data?.display_name ?? oauthDisplayName,
    role: myProfileQuery.data?.role ?? "",
    bio: myProfileQuery.data?.bio ?? "",
    linkedin_url: myProfileQuery.data?.linkedin_url ?? "",
    github_url: myProfileQuery.data?.github_url ?? "",
    personal_url: myProfileQuery.data?.personal_url ?? "",
  };
  const roleLocked = isElevatedPortalRole(myProfileQuery.data?.role);

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
          {describeClaimStatusError(claimStatusQuery.error)}
        </p>
      )}

      {claimStatusQuery.data?.claimed ? (
        <p className="text-sm text-(--bearhacks-muted)">
          Opening profile…
        </p>
      ) : null}

      {claimStatusQuery.data && !claimStatusQuery.data.claimed ? (
        <>
          {!auth?.isAuthReady ? (
            <p className="text-sm text-(--bearhacks-muted)">
              Checking session…
            </p>
          ) : !auth.user ? (
            <Card>
              <CardHeader>
                <CardTitle>Sign in to claim</CardTitle>
                <CardDescription>
                  Use Google or LinkedIn to link this QR to your attendee
                  account.
                </CardDescription>
              </CardHeader>
              <DashboardOAuthButtons />
            </Card>
          ) : myProfileQuery.isLoading ? (
            <p className="text-sm text-(--bearhacks-muted)">
              Checking your QR card…
            </p>
          ) : myProfileQuery.data?.qr_id ? (
            <Card className="bg-(--bearhacks-cream) border-b-4 border-b-(--bearhacks-text-marketing)">
              <CardHeader>
                <CardTitle className="text-(--bearhacks-text-marketing)">
                  You&apos;ve already claimed a QR
                </CardTitle>
                <CardDescription className="text-(--bearhacks-text-marketing)/80">
                  Each attendee can only claim one QR. Here&apos;s the card
                  that&apos;s linked to your account.
                </CardDescription>
              </CardHeader>
              <Link
                href={`/qr-card/${myProfileQuery.data.qr_id}`}
                className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-6 py-3 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
              >
                View my QR card →
              </Link>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Confirm your details</CardTitle>
                <CardDescription>
                  Display name and role are required. Everything else is
                  optional.
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
                    setDraft({
                      ...profileDraft,
                      display_name: event.target.value,
                    })
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
                  readOnly={roleLocked}
                  disabled={roleLocked}
                  hint={
                    roleLocked
                      ? "Your role was assigned by an organizer and can't be changed here."
                      : undefined
                  }
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
                    setDraft({
                      ...profileDraft,
                      linkedin_url: event.target.value,
                    })
                  }
                  placeholder="https://linkedin.com/in/you"
                />
                <InputField
                  label="GitHub URL"
                  type="url"
                  value={profileDraft.github_url}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({
                      ...profileDraft,
                      github_url: event.target.value,
                    })
                  }
                  placeholder="https://github.com/you"
                />
                <InputField
                  label="Personal link"
                  type="url"
                  value={profileDraft.personal_url}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({
                      ...profileDraft,
                      personal_url: event.target.value,
                    })
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
