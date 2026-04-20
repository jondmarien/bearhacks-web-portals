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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
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
            This page is limited to Super Admins. Ask a Super Admin to grant your
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
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftSearch(e.target.value)}
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
            <>
              <Card className="hidden p-0 sm:block">
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
                      {query.data.map((row) => {
                        const isDeleting =
                          deleteMutation.isPending && deleteMutation.variables === row.id;
                        return (
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
                                  className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-6 py-3 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
                                >
                                  Edit
                                </Link>
                                <a
                                  href={`${resolveMeBaseUrl()}/contacts/${row.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-6 py-3 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
                                >
                                  View profile
                                </a>
                                <Button
                                  variant="ghost"
                                  className="text-(--bearhacks-danger)"
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
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? "Deleting…" : "Delete"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <ul className="flex flex-col gap-3 sm:hidden">
                {query.data.map((row) => {
                  const isDeleting =
                    deleteMutation.isPending && deleteMutation.variables === row.id;
                  return (
                    <li key={row.id}>
                      <Card className="flex flex-col gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-(--bearhacks-fg) wrap-break-word">
                            {row.display_name?.trim() || "Unnamed attendee"}
                          </span>
                          {row.role?.trim() ? (
                            <span className="text-xs text-(--bearhacks-muted) wrap-break-word">
                              {row.role}
                            </span>
                          ) : null}
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                          <dt className="font-mono uppercase tracking-wide text-(--bearhacks-muted)">QR</dt>
                          <dd className="font-mono break-all text-(--bearhacks-fg)">
                            {row.qr_id ? row.qr_id.slice(0, 8) + "…" : "—"}
                          </dd>
                          <dt className="font-mono uppercase tracking-wide text-(--bearhacks-muted)">Updated</dt>
                          <dd className="text-(--bearhacks-fg)">
                            {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
                          </dd>
                        </dl>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/profiles/${row.id}`}
                            className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-2 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
                          >
                            Edit
                          </Link>
                          <a
                            href={`${resolveMeBaseUrl()}/contacts/${row.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-2 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
                          >
                            View
                          </a>
                          <Button
                            variant="ghost"
                            className="text-(--bearhacks-danger)"
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
                            disabled={isDeleting}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
