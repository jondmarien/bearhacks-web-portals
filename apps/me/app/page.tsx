"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { Clouds } from "@/components/decorative/clouds";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/field";
import { useApiClient } from "@/lib/use-api-client";

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

type ProfileDraft = {
  display_name: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
  personal_url: string;
  role: string;
};

function draftFromProfile(profile: MyProfile | undefined | null): ProfileDraft {
  return {
    display_name: profile?.display_name ?? "",
    bio: profile?.bio ?? "",
    linkedin_url: profile?.linkedin_url ?? "",
    github_url: profile?.github_url ?? "",
    personal_url: profile?.personal_url ?? "",
    role: profile?.role ?? "",
  };
}

export default function HomePage() {
  const auth = useMeAuth();
  const router = useRouter();
  const client = useApiClient();
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);

  const user = auth?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!auth?.isAuthReady || !user) return;
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) {
      router.replace(next);
    }
  }, [auth?.isAuthReady, user, router]);

  const profileQuery = useQuery({
    queryKey: ["me-profile", userId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<MyProfile>(`/profiles/${userId}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await client!.fetchJson<MyProfile>("/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
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
      const effective = profileDraft ?? draftFromProfile(current);
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
      if (effective.role !== (current?.role ?? "")) body.role = effective.role;
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
      setProfileDraft(draftFromProfile(data));
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
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-linear-to-b from-(--bearhacks-sky-from) from-70% to-white px-4 py-16 sm:py-24">
        <Clouds />

        <Image
          src="/brand/bear_cloud_left.webp"
          alt=""
          aria-hidden="true"
          width={256}
          height={192}
          priority
          className="pointer-events-none absolute bottom-12 left-6 hidden w-44 sm:block lg:w-64"
          style={{ height: "auto" }}
        />
        <Image
          src="/brand/bear_cloud_right.webp"
          alt=""
          aria-hidden="true"
          width={192}
          height={144}
          priority
          className="pointer-events-none absolute bottom-16 right-6 hidden w-32 sm:block lg:w-48"
          style={{ height: "auto" }}
        />

        <section className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 text-center">
          <Image
            src="/brand/wordmark_hero.webp"
            alt="BearHacks 2026"
            width={738}
            height={220}
            priority
            className="w-full max-w-xs sm:max-w-md md:max-w-xl"
            style={{ height: "auto" }}
          />
          <p className="text-base font-semibold tracking-tight text-(--bearhacks-primary) sm:text-2xl">
            Networking · April 24-26 · Sheridan HMC Campus
          </p>
          <div className="flex w-full flex-col items-center gap-3">
            <p className="text-sm font-medium text-(--bearhacks-text-marketing) sm:text-base">
              Sign in to create your profile and claim your QR code.
            </p>
            <DashboardOAuthButtons />
          </div>
        </section>
      </main>
    );
  }

  const draft: ProfileDraft = profileDraft ?? draftFromProfile(profileQuery.data);
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
            className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-surface-alt)"
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

      <Card>
        <CardHeader>
          <CardTitle>My profile</CardTitle>
          <CardDescription>
            This is what other attendees see when they scan your QR.
          </CardDescription>
        </CardHeader>
        {profileQuery.isLoading ? (
          <p className="text-sm text-(--bearhacks-muted)">Loading profile…</p>
        ) : profileQuery.isError ? (
          <p className="text-sm text-red-700">
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
              onChange={(event) =>
                setProfileDraft({ ...draft, display_name: event.target.value })
              }
              placeholder="Your name"
              autoComplete="name"
            />
            <InputField
              label="Role or title"
              value={draft.role}
              onChange={(event) =>
                setProfileDraft({ ...draft, role: event.target.value })
              }
              placeholder="Hacker, Mentor, Sponsor…"
            />
            <TextareaField
              label="Bio"
              value={draft.bio}
              onChange={(event) =>
                setProfileDraft({ ...draft, bio: event.target.value })
              }
              rows={4}
              placeholder="What are you building, looking for, or excited about?"
            />
            <InputField
              label="LinkedIn URL"
              type="url"
              value={draft.linkedin_url}
              onChange={(event) =>
                setProfileDraft({ ...draft, linkedin_url: event.target.value })
              }
              placeholder="https://linkedin.com/in/you"
            />
            <InputField
              label="GitHub URL"
              type="url"
              value={draft.github_url}
              onChange={(event) =>
                setProfileDraft({ ...draft, github_url: event.target.value })
              }
              placeholder="https://github.com/you"
            />
            <InputField
              label="Personal link"
              type="url"
              value={draft.personal_url}
              onChange={(event) =>
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
              Show this QR to other attendees to share your profile.
            </CardDescription>
          </CardHeader>
          <Link
            href={`/qr-card/${qrId}`}
            className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
          >
            Open my QR card →
          </Link>
        </Card>
      ) : null}
    </main>
  );
}
