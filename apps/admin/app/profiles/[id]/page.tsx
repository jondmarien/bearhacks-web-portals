"use client";

/**
 * Super-admin profile editor (Linear DEV-22).
 *
 * Reads `GET /profiles/{id}` (public read today) and writes `PATCH /profiles/{id}` (super-admin only).
 *
 * TODO(DEV-17): Richer QR assignment UX should stay aligned with backend QR routes once DEV-17 ships
 *   (assignee: Yves — Linear DEV-17). This form intentionally omits direct QR editing.
 */

import { ApiError, createApiClient } from "@bearhacks/api-client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";
import { isSuperAdminUser } from "@/lib/supabase-role";

type ProfileDetail = {
  id: string;
  display_name?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  role?: string | null;
  qr_id?: string | null;
  updated_at?: string | null;
};

type ApiClient = ReturnType<typeof createApiClient>;

function ProfileEditForm({
  profileId,
  profile,
  client,
  queryClient,
}: {
  profileId: string;
  profile: ProfileDetail;
  client: ApiClient;
  queryClient: QueryClient;
}) {
  const [displayName, setDisplayName] = useState(() => profile.display_name ?? "");
  const [bio, setBio] = useState(() => profile.bio ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(() => profile.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(() => profile.github_url ?? "");
  const [role, setRole] = useState(() => profile.role ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (displayName !== (profile.display_name ?? "")) body.display_name = displayName;
      if (bio !== (profile.bio ?? "")) body.bio = bio;
      if (linkedinUrl !== (profile.linkedin_url ?? "")) body.linkedin_url = linkedinUrl;
      if (githubUrl !== (profile.github_url ?? "")) body.github_url = githubUrl;
      if (role !== (profile.role ?? "")) body.role = role;
      return client.fetchJson<ProfileDetail>(`/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["profile", profileId], data);
      void queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast.success("Profile saved");
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.status === 403 ? "Super admin access required" : err.message);
      } else {
        toast.error("Save failed");
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
    >
      <p className="text-xs text-(--bearhacks-muted)">
        Profile id <code className="rounded bg-(--bearhacks-border)/40 px-1">{profileId}</code>
        {profile.qr_id && (
          <>
            {" "}
            · QR <code className="rounded bg-(--bearhacks-border)/40 px-1">{profile.qr_id}</code>
          </>
        )}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="display_name" className="text-sm font-medium text-(--bearhacks-fg)">
          Display name
        </label>
        <input
          id="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="bio" className="text-sm font-medium text-(--bearhacks-fg)">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          className="rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 py-2 text-base"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="linkedin_url" className="text-sm font-medium text-(--bearhacks-fg)">
          LinkedIn URL
        </label>
        <input
          id="linkedin_url"
          type="url"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
          placeholder="https://"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="github_url" className="text-sm font-medium text-(--bearhacks-fg)">
          GitHub URL
        </label>
        <input
          id="github_url"
          type="url"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
          placeholder="https://"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="role" className="text-sm font-medium text-(--bearhacks-fg)">
          Role
        </label>
        <input
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
        />
      </div>

      <button
        type="submit"
        disabled={saveMutation.isPending}
        className="min-h-(--bearhacks-touch-min) w-full cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {saveMutation.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

export default function AdminProfileEditPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = useSupabase();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isSuper = isSuperAdminUser(user);

  const profileQuery = useQuery({
    queryKey: ["profile", id],
    queryFn: () => client!.fetchJson<ProfileDetail>(`/profiles/${id}`),
    enabled: Boolean(client && id && isSuper),
  });

  if (!id) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <p className="text-sm text-(--bearhacks-muted)">Missing profile id.</p>
      </main>
    );
  }

  if (!isSuper) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold text-(--bearhacks-fg)">Edit profile</h1>
        <p className="mt-2 text-sm text-(--bearhacks-muted)">
          Super-admin JWT role required. The API will reject saves otherwise.
        </p>
        <Link href="/profiles" className="mt-6 inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Back to list
        </Link>
      </main>
    );
  }

  const formKey =
    profileQuery.data != null
      ? `${id}-${profileQuery.data.updated_at ?? profileQuery.data.id}`
      : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Edit profile</h1>
        <Link
          href="/profiles"
          className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center text-sm underline"
        >
          Back to list
        </Link>
      </div>

      {profileQuery.isLoading && <p className="text-sm text-(--bearhacks-muted)">Loading…</p>}
      {profileQuery.error && (
        <p className="text-sm text-red-700">
          {profileQuery.error instanceof ApiError ? profileQuery.error.message : "Failed to load profile"}
        </p>
      )}

      {profileQuery.data && client && formKey && (
        <ProfileEditForm
          key={formKey}
          profileId={id}
          profile={profileQuery.data}
          client={client}
          queryClient={queryClient}
        />
      )}
    </main>
  );
}
