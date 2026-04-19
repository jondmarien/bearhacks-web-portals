"use client";

/**
 * Super-admin profile editor.
 *
 * Reads `GET /profiles/{id}` (public read today) and writes `PATCH /profiles/{id}` (super-admin only).
 */

import { ApiError, createApiClient } from "@bearhacks/api-client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
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
        toast.error(err.status === 403 ? "Super-admin access required." : err.message);
      } else {
        toast.error("Save failed");
      }
    },
  });

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <p className="text-xs text-(--bearhacks-muted)">
          Profile id <code className="rounded bg-(--bearhacks-surface-alt) px-1">{profileId}</code>
          {profile.qr_id && (
            <>
              {" "}
              · QR <code className="rounded bg-(--bearhacks-surface-alt) px-1">{profile.qr_id}</code>
            </>
          )}
        </p>

        <InputField
          label="Display name"
          id="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
        />

        <TextareaField
          label="Bio"
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
        />

        <InputField
          label="LinkedIn URL"
          id="linkedin_url"
          type="url"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="https://"
        />

        <InputField
          label="GitHub URL"
          id="github_url"
          type="url"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://"
        />

        <InputField
          label="Role"
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />

        <div>
          <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AdminProfileEditPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = useSupabase();
  useDocumentTitle("Edit profile");
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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <PageHeader title="Edit profile" tone="marketing" backHref="/profiles" showBack />
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-900">Super-admin access required</CardTitle>
          <CardDescription className="mt-1 text-amber-900">
            Editing profiles is limited to Super Admins. Ask a Super Admin to grant
            your account access, then sign out and back in.
          </CardDescription>
        </Card>
      </main>
    );
  }

  const formKey =
    profileQuery.data != null
      ? `${id}-${profileQuery.data.updated_at ?? profileQuery.data.id}`
      : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Edit profile"
        tone="marketing"
        subtitle="Update an attendee's display name, bio, links, and role."
        backHref="/profiles"
        showBack
      />

      {profileQuery.data?.display_name ? (
        <p className="text-2xl font-extrabold text-(--bearhacks-text-marketing) sm:text-3xl">
          {profileQuery.data.display_name}
        </p>
      ) : null}

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
