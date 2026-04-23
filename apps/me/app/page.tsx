"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { BobaPortalCard } from "@/components/boba-portal-card";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { FavouritesModal } from "@/components/favourites-modal";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/field";
import { QrPreview } from "@/components/ui/qr-preview";
import { useBobaMenuQuery, useMyBobaOrderQuery } from "@/lib/boba-queries";
import { getOAuthDisplayName } from "@/lib/oauth-display-name";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { MAX_DISPLAY_NAME_LENGTH } from "@/lib/profile-roles";

const log = createLogger("me/home");

type MyProfile = {
  id: string;
  qr_id?: string | null;
  display_name?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  personal_url?: string | null;
  role?: string | null;
};

type FavouriteProfile = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
};

type ProfileDraft = {
  display_name: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
  personal_url: string;
  role: string;
};

function draftFromProfile(
  profile: MyProfile | undefined | null,
  fallbackDisplayName: string,
): ProfileDraft {
  const storedDisplayName = profile?.display_name?.trim() ?? "";
  return {
    display_name: storedDisplayName || fallbackDisplayName,
    bio: profile?.bio ?? "",
    linkedin_url: profile?.linkedin_url ?? "",
    github_url: profile?.github_url ?? "",
    personal_url: profile?.personal_url ?? "",
    role: profile?.role ?? "",
  };
}

/**
 * `useSearchParams()` (below) forces Next.js to bail out of static
 * prerendering. The App Router requires such client components to sit
 * under a `<Suspense>` boundary so the prerender fallback has somewhere
 * to go. The default export wraps this inner component accordingly.
 */
function HomePageContent() {
  const auth = useMeAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useApiClient();
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  useDocumentTitle(auth?.user ? "Welcome back" : "Sign in");

  const user = auth?.user ?? null;
  const userId = user?.id ?? null;
  const oauthDisplayName = getOAuthDisplayName(user);

  useEffect(() => {
    if (!auth?.isAuthReady || !user) return;
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) {
      router.replace(next);
    }
  }, [auth?.isAuthReady, user, router]);

  const favouritesQuery = useQuery({
    queryKey: ["me-favourites", userId],
    queryFn: () => client!.fetchJson<FavouriteProfile[]>("/social/favourites"),
    enabled: Boolean(client && userId),
  });

  const menuQuery = useBobaMenuQuery();
  const myOrderQuery = useMyBobaOrderQuery(userId);

  // Deep-link highlight: /?payment=highlight scrolls the payment card into
  // view and flashes a transient ring. Same pattern as the old
  // `scrollAndHighlightPayment` on /boba; we then strip the query param so
  // a browser refresh doesn't re-trigger it.
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const [paymentHighlighted, setPaymentHighlighted] = useState(false);
  const paymentHighlightRequested = searchParams.get("payment") === "highlight";

  useEffect(() => {
    if (!paymentHighlightRequested) return;
    const raf = window.requestAnimationFrame(() => {
      paymentSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setPaymentHighlighted(true);
    });
    const fadeTimer = window.setTimeout(
      () => setPaymentHighlighted(false),
      2000,
    );
    const clearTimer = window.setTimeout(() => router.replace("/"), 2000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [paymentHighlightRequested, router]);

  const profileQuery = useQuery({
    queryKey: ["me-profile", userId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<MyProfile>(`/profiles/${userId}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          const initialBody = oauthDisplayName ? { display_name: oauthDisplayName } : {};
          await client!.fetchJson<MyProfile>("/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(initialBody),
          });
          return await client!.fetchJson<MyProfile>(`/profiles/${userId}`);
        }
        log.error("Failed to load profile", { userId, error });
        throw error;
      }
    },
    enabled: Boolean(client && userId),
  });

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      const current = profileQuery.data;
      const effective = profileDraft ?? draftFromProfile(current, oauthDisplayName);
      const body: Record<string, string> = {};
      if (effective.display_name !== (current?.display_name ?? "")) {
        body.display_name = effective.display_name;
      }
      if (effective.bio !== (current?.bio ?? "")) body.bio = effective.bio;
      if (effective.linkedin_url !== (current?.linkedin_url ?? "")) {
        body.linkedin_url = effective.linkedin_url;
      }
      if (effective.github_url !== (current?.github_url ?? "")) {
        body.github_url = effective.github_url;
      }
      if (effective.personal_url !== (current?.personal_url ?? "")) {
        body.personal_url = effective.personal_url;
      }
      // `role` is intentionally never sent from this form. Self-service role
      // changes are blocked server-side (see routers/profiles.py) and the
      // UI shows it read-only; a super-admin manages promotions from the
      // admin portal.
      return client!.fetchJson<MyProfile>("/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      void profileQuery.refetch();
      toast.success("Profile saved");
      if (userId) {
        router.push(`/contacts/${userId}`);
      }
      setProfileDraft(draftFromProfile(data, oauthDisplayName));
    },
    onError: (error) => {
      log.error("Profile update failed", { userId, error });
      toast.error(error instanceof ApiError ? error.message : "Profile update failed");
    },
  });

  if (!auth?.isAuthReady) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
        <p className="text-sm text-(--bearhacks-muted)">Checking session…</p>
      </main>
    );
  }

  if (!client) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Configuration missing</CardTitle>
            <CardDescription>
              Set <code>NEXT_PUBLIC_SUPABASE_*</code> and <code>NEXT_PUBLIC_API_URL</code> to continue.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-10">
        <section className="flex flex-col items-center text-center">
          <Image
            src="/brand/wordmark_hero.webp"
            alt="BearHacks 2026"
            width={738}
            height={220}
            priority
            className="w-64 sm:w-80"
            style={{ height: "auto" }}
          />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-(--bearhacks-title) sm:text-4xl">
            BearHacks 2026 Networking
          </h1>
          <p className="mt-3 max-w-md text-base text-(--bearhacks-muted)">
            Sign in to create a networking profile and claim a QR code.
          </p>
        </section>

        <Card>
          <CardHeader className="items-center text-center">
            <CardTitle>Sign in to continue</CardTitle>
            <CardDescription>
              Use Google or LinkedIn to create your attendee profile.
            </CardDescription>
          </CardHeader>
          <DashboardOAuthButtons />
        </Card>
      </main>
    );
  }

  const draft: ProfileDraft = profileDraft ?? draftFromProfile(profileQuery.data, oauthDisplayName);
  const qrId = profileQuery.data?.qr_id ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold uppercase tracking-[0.15rem] text-(--bearhacks-text-marketing) sm:text-3xl">
            Welcome back
          </h1>
          {user?.email ? (
            <p className="text-sm text-(--bearhacks-text-marketing)/70">{user.email}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/contacts/${userId}`}
            className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-sm font-semibold text-(--bearhacks-fg) no-underline hover:bg-(--bearhacks-surface-alt)"
          >
            My profile
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              void auth.signOut().catch((error) => {
                log.error("Sign out failed", { error });
                toast.error("Unable to sign out");
              });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      <div ref={paymentSectionRef} className="scroll-mt-6">
        <BobaPortalCard
          isAuthReady={Boolean(auth?.isAuthReady)}
          userId={userId}
          drinks={myOrderQuery.data?.drinks ?? []}
          momos={myOrderQuery.data?.momos ?? []}
          menu={menuQuery.data ?? null}
          recipientName={menuQuery.data?.payment.etransfer_recipient_name ?? ""}
          etransferEmail={menuQuery.data?.payment.etransfer_email ?? ""}
          discountNote={menuQuery.data?.payment.discount_note ?? ""}
          highlightPayment={paymentHighlighted}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle>My profile</CardTitle>
            <FavouritesModal
              favourites={favouritesQuery.data}
              isLoading={favouritesQuery.isLoading}
              error={favouritesQuery.error}
            />
          </div>
          <CardDescription>
            This is what other attendees see when they scan your QR.
          </CardDescription>
        </CardHeader>
        {profileQuery.isLoading ? (
          <p className="text-sm text-(--bearhacks-muted)">Loading profile…</p>
        ) : profileQuery.isError ? (
          <p className="text-sm text-(--bearhacks-danger)">
            {profileQuery.error instanceof ApiError
              ? profileQuery.error.message
              : "Failed to load profile"}
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveProfileMutation.mutate();
            }}
          >
            <InputField
              label="Display name"
              value={draft.display_name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProfileDraft({ ...draft, display_name: event.target.value })
              }
              placeholder="Your name"
              autoComplete="name"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              hint={`Up to ${MAX_DISPLAY_NAME_LENGTH} characters.`}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-(--bearhacks-title)">
                Role
              </span>
              <div className="flex min-h-(--bearhacks-touch-min) w-full items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 text-base text-(--bearhacks-fg)">
                {draft.role?.trim() || "Hacker"}
              </div>
              <p className="text-xs text-(--bearhacks-muted)">
                Only the BearHacks team can change your role — ping an
                organizer if this looks wrong.
              </p>
            </div>
            <TextareaField
              label="Bio"
              value={draft.bio}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setProfileDraft({ ...draft, bio: event.target.value })
              }
              rows={4}
              placeholder="What are you building, looking for, or excited about?"
            />
            <InputField
              label="LinkedIn URL"
              type="url"
              value={draft.linkedin_url}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProfileDraft({ ...draft, linkedin_url: event.target.value })
              }
              placeholder="https://linkedin.com/in/you"
            />
            <InputField
              label="GitHub URL"
              type="url"
              value={draft.github_url}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProfileDraft({ ...draft, github_url: event.target.value })
              }
              placeholder="https://github.com/you"
            />
            <InputField
              label="Personal link"
              type="url"
              value={draft.personal_url}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setProfileDraft({ ...draft, personal_url: event.target.value })
              }
              placeholder="https://yourportfolio.com"
              hint="Portfolio, project, Notion, anything you want to share."
            />
            <div>
              <Button type="submit" disabled={saveProfileMutation.isPending}>
                {saveProfileMutation.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {qrId ? (
        <Card>
          <CardHeader>
            <CardTitle>
              My <span className="bg-(--bearhacks-cream) px-1 rounded-sm">QR card</span>
            </CardTitle>
            <CardDescription>
              Attendees scan this to see your profile.
            </CardDescription>
          </CardHeader>
          <div className="flex flex-col items-center gap-4">
            <QrPreview qrId={qrId} size={224} />
            <Link
              href={`/qr-card/${qrId}`}
              className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
            >
              Full-size QR →
            </Link>
          </div>
        </Card>
      ) : null}

    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-10">
          <p className="text-sm text-(--bearhacks-muted)">Loading…</p>
        </main>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
