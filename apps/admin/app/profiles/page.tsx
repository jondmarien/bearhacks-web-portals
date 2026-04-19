"use client";

/**
 * Super-admin attendee directory.
 *
 * API: `GET /admin/profiles` (super-admin only). Regular `admin` JWTs receive 403.
 */

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InputField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { resolveMeBaseUrl } from "@/lib/me-base-url";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";

export type AdminProfileListRow = {
  id: string;
  display_name: string | null;
  role: string | null;
  updated_at: string | null;
  qr_id: string | null;
};

export default function AdminProfilesPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const confirm = useConfirm();
  useDocumentTitle("Profiles");
  const [user, setUser] = useState<User | null>(null);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");

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
  const staff = isStaffUser(user);

  const query = useQuery({
    queryKey: ["admin-profiles", appliedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
      return client!.fetchJson<AdminProfileListRow[]>(`/admin/profiles?${params.toString()}`);
    },
    enabled: Boolean(client && isSuper),
  });

  useEffect(() => {
    if (!query.error) return;
    const err = query.error;
    if (err instanceof ApiError) {
      toast.error(err.status === 403 ? "Super-admin access required." : err.message);
    } else {
      toast.error("Failed to load profiles");
    }
  }, [query.error]);

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) =>
      client!.fetchJson<{ deleted: boolean; profile_id: string; detached_qr_id: string | null }>(
        `/admin/profiles/${profileId}`,
        { method: "DELETE" },
      ),
    onSuccess: (result) => {
      toast.success(
        result.detached_qr_id
          ? `Deleted profile and detached QR ${result.detached_qr_id.slice(0, 8)}…`
          : "Profile deleted",
      );
      void query.refetch();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.status === 403 ? "Super-admin access required." : err.message);
      } else {
        toast.error("Failed to delete profile");
      }
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Profiles"
        tone="marketing"
        subtitle="Search and edit attendee profiles."
        backHref="/"
        showBack
      />

      {!staff && (
        <Card>
          <CardTitle>Staff access required</CardTitle>
          <CardDescription className="mt-1">
            Sign in with a staff account to view the profile directory.
          </CardDescription>
        </Card>
      )}

      {staff && !isSuper && (
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-900">Super-admin access required</CardTitle>
          <CardDescription className="mt-1 text-amber-900">
            This page is limited to super-admins. Ask a super-admin to grant your
            account access, then sign out and back in.
          </CardDescription>
        </Card>
      )}

      {isSuper && (
        <>
          <Card>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(draftSearch);
              }}
            >
              <div className="min-w-0 flex-1">
                <InputField
                  label="Search display name"
                  id="profile-search"
                  name="search"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder="Substring match"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" variant="primary">
                Apply
              </Button>
            </form>
          </Card>

          {query.isLoading && <p className="text-sm text-(--bearhacks-muted)">Loading…</p>}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-(--bearhacks-muted)">No profiles match.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Card className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-lg border-collapse text-left text-sm">
                  <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
                    <tr>
                      <th scope="col" className="px-3 py-3 font-medium text-(--bearhacks-fg)">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-(--bearhacks-fg)">
                        Role
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-(--bearhacks-fg)">
                        QR
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-(--bearhacks-fg)">
                        Updated
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium text-(--bearhacks-fg)">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.map((row) => (
                      <tr key={row.id} className="border-b border-(--bearhacks-border) last:border-0">
                        <td className="px-3 py-3 text-(--bearhacks-fg)">{row.display_name ?? "—"}</td>
                        <td className="px-3 py-3 text-(--bearhacks-muted)">{row.role ?? "—"}</td>
                        <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">
                          {row.qr_id ? row.qr_id.slice(0, 8) + "…" : "—"}
                        </td>
                        <td className="px-3 py-3 text-(--bearhacks-muted)">
                          {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/profiles/${row.id}`}
                              className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-black/50 bg-white px-6 py-3 text-sm font-semibold text-black no-underline shadow-[0_1px_4px_0_rgba(0,0,0,0.25)] hover:bg-(--bearhacks-cream)"
                            >
                              Edit
                            </Link>
                            <a
                              href={`${resolveMeBaseUrl()}/contacts/${row.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-black/50 bg-white px-6 py-3 text-sm font-semibold text-black no-underline shadow-[0_1px_4px_0_rgba(0,0,0,0.25)] hover:bg-(--bearhacks-cream)"
                            >
                              View profile
                            </a>
                            <Button
                              variant="ghost"
                              className="text-red-700"
                              onClick={() => {
                                void (async () => {
                                  const label = row.display_name?.trim() || "this profile";
                                  const confirmed = await confirm({
                                    title: "Delete profile?",
                                    description: row.qr_id
                                      ? `${label} will be removed and their QR (${row.qr_id.slice(0, 8)}…) will be detached so it can be reissued.`
                                      : `${label} will be permanently removed from the directory.`,
                                    confirmLabel: "Delete",
                                    cancelLabel: "Cancel",
                                    tone: "danger",
                                  });
                                  if (!confirmed) return;
                                  deleteMutation.mutate(row.id);
                                })();
                              }}
                              disabled={
                                deleteMutation.isPending && deleteMutation.variables === row.id
                              }
                            >
                              {deleteMutation.isPending && deleteMutation.variables === row.id
                                ? "Deleting…"
                                : "Delete"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
