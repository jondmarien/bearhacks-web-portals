"use client";

/**
 * Super-admin attendee directory.
 *
 * API: `GET /admin/profiles` (super-admin only). Regular `admin` JWTs receive 403.
 */

import { ApiError } from "@bearhacks/api-client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InputField, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { resolveMeBaseUrl } from "@/lib/me-base-url";
import {
  PROFILE_ROLES,
  PROFILE_ROLE_OPTIONS,
  type ProfileRole,
} from "@/lib/profile-roles";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";

export type AdminProfileListRow = {
  id: string;
  display_name: string | null;
  role: string | null;
  updated_at: string | null;
  qr_id: string | null;
};

export type AdminProfileListResponse = {
  items: AdminProfileListRow[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 25;

export default function AdminProfilesPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const confirm = useConfirm();
  useDocumentTitle("Profiles");
  const [user, setUser] = useState<User | null>(null);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<ReadonlySet<ProfileRole>>(
    () => new Set<ProfileRole>(),
  );
  const [page, setPage] = useState(0);

  // Stable array for the query key + URLSearchParams so the query stays
  // cacheable: sets don't have value equality, but a sorted array does.
  const selectedRolesKey = useMemo(
    () => [...selectedRoles].sort(),
    [selectedRoles],
  );

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
    queryKey: ["admin-profiles", appliedSearch, selectedRolesKey, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
      for (const r of selectedRolesKey) params.append("role", r);
      return client!.fetchJson<AdminProfileListResponse>(
        `/admin/profiles?${params.toString()}`,
      );
    },
    enabled: Boolean(client && isSuper),
    placeholderData: keepPreviousData,
  });

  // Whenever the user changes filters, we snap back to page 0 at the
  // event-handler level (see the search form's `onSubmit` and the role
  // chip handlers below). Doing this in a `useEffect` would cascade a
  // second render and trips React 19's `react-hooks/set-state-in-effect`
  // rule — so resets live with the interactions that cause them.
  const toggleRole = (role: ProfileRole) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
    setPage(0);
  };
  const clearRoles = () => {
    setSelectedRoles(new Set());
    setPage(0);
  };

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

  // Inline "Change role" flow — a single dialog instance that any row's
  // Actions button can open. Keeping the dialog mounted at the page root
  // (rather than per-row) lets us share one mutation and avoids a dozen
  // portals in the DOM at once.
  const [roleEditTarget, setRoleEditTarget] = useState<AdminProfileListRow | null>(null);
  const [roleDraft, setRoleDraft] = useState<string>("Hacker");

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      client!.fetchJson<AdminProfileListRow>(`/profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_data, variables) => {
      toast.success(`Role updated to ${variables.role}`);
      setRoleEditTarget(null);
      void query.refetch();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.status === 403 ? "Super-admin access required." : err.message);
      } else {
        toast.error("Failed to update role");
      }
    },
  });

  const openRoleEditor = (row: AdminProfileListRow) => {
    setRoleEditTarget(row);
    const current = row.role?.trim() ?? "";
    setRoleDraft(
      (PROFILE_ROLES as readonly string[]).includes(current) ? current : "Hacker",
    );
  };

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
        <Card className="border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg)">
          <CardTitle className="text-(--bearhacks-warning-fg)">Super-admin access required</CardTitle>
          <CardDescription className="mt-1 text-(--bearhacks-warning-fg)">
            This page is limited to Super Admins. Ask a Super Admin to grant your
            account access, then sign out and back in.
          </CardDescription>
        </Card>
      )}

      {isSuper && (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span
                id="profile-role-filter-label"
                className="text-sm font-medium text-(--bearhacks-title)"
              >
                Filter by role
              </span>
              <div
                role="group"
                aria-labelledby="profile-role-filter-label"
                className="flex flex-wrap gap-2"
              >
                {PROFILE_ROLES.map((role) => {
                  const active = selectedRoles.has(role);
                  return (
                    <Button
                      key={role}
                      type="button"
                      variant={active ? "primary" : "ghost"}
                      aria-pressed={active}
                      onClick={() => toggleRole(role)}
                    >
                      {role}
                    </Button>
                  );
                })}
                {selectedRoles.size > 0 ? (
                  <Button type="button" variant="ghost" onClick={clearRoles}>
                    Clear roles
                  </Button>
                ) : null}
              </div>
            </div>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(draftSearch);
                setPage(0);
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

          {query.isLoading && !query.data && (
            <p className="text-sm text-(--bearhacks-muted)">Loading…</p>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="text-sm text-(--bearhacks-muted)">No profiles match.</p>
          )}
          {query.data && query.data.items.length > 0 && (
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
                      {query.data.items.map((row) => {
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
                                  variant="secondary"
                                  onClick={() => openRoleEditor(row)}
                                  disabled={
                                    roleMutation.isPending &&
                                    roleEditTarget?.id === row.id
                                  }
                                >
                                  Change role
                                </Button>
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
                {query.data.items.map((row) => {
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
                            variant="secondary"
                            onClick={() => openRoleEditor(row)}
                            disabled={
                              roleMutation.isPending &&
                              roleEditTarget?.id === row.id
                            }
                          >
                            Change role
                          </Button>
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

              <PaginationControls
                page={page}
                pageSize={PAGE_SIZE}
                total={query.data.total}
                onPrev={() => setPage((p) => Math.max(0, p - 1))}
                onNext={() => setPage((p) => p + 1)}
                isFetching={query.isFetching}
              />
            </>
          )}
        </>
      )}

      <ChangeRoleModal
        target={roleEditTarget}
        value={roleDraft}
        onValueChange={setRoleDraft}
        submitting={roleMutation.isPending}
        onCancel={() => {
          if (roleMutation.isPending) return;
          setRoleEditTarget(null);
        }}
        onSubmit={() => {
          if (!roleEditTarget) return;
          const nextRole = roleDraft.trim();
          if (!(PROFILE_ROLES as readonly string[]).includes(nextRole)) {
            toast.error("Pick a valid role");
            return;
          }
          if (nextRole === (roleEditTarget.role?.trim() ?? "")) {
            toast.info("Role is unchanged");
            setRoleEditTarget(null);
            return;
          }
          roleMutation.mutate({ id: roleEditTarget.id, role: nextRole });
        }}
      />
    </main>
  );
}

/**
 * Server pagination footer. Shows "Page N of M · X total" plus Prev/Next.
 *
 * `isFetching` is passed so we can keep the controls clickable while a
 * page transition is in flight (React Query is showing the previous page
 * thanks to `keepPreviousData`) without flashing a disabled state.
 */
function PaginationControls({
  page,
  pageSize,
  total,
  onPrev,
  onNext,
  isFetching,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isFetching: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page + 1, pageCount);
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-(--bearhacks-muted)">
      <span aria-live="polite">
        Page {current} of {pageCount} · {total} total
        {isFetching ? " · refreshing…" : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * Small portal-based dialog for changing a profile's role.
 *
 * Inlined here because this is its only caller and the shape is trivial:
 * title + role picker + Cancel/Save. We use a plain portal (not the
 * existing `useConfirm` primitive) because `useConfirm` only supports
 * static confirm/cancel text, not arbitrary form fields.
 */
function ChangeRoleModal({
  target,
  value,
  onValueChange,
  submitting,
  onCancel,
  onSubmit,
}: {
  target: AdminProfileListRow | null;
  value: string;
  onValueChange: (next: string) => void;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, submitting, onCancel]);

  if (!target) return null;
  if (typeof document === "undefined") return null;

  const label = target.display_name?.trim() || "this profile";
  const currentRole = target.role?.trim() || "—";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-role-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex w-full max-w-md flex-col gap-4 rounded-(--bearhacks-radius-lg) border border-(--bearhacks-border) bg-(--bearhacks-surface) p-5 shadow-(--bearhacks-shadow-card)"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="change-role-title"
            className="text-lg font-semibold text-(--bearhacks-title)"
          >
            Change role
          </h2>
          <p className="text-sm text-(--bearhacks-muted)">
            Assign a new role for <span className="font-medium">{label}</span>.
            Current role: <span className="font-medium">{currentRole}</span>.
          </p>
        </div>

        <SelectField
          label="Role"
          id="change-role-select"
          name="role"
          value={value}
          options={PROFILE_ROLE_OPTIONS}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange(e.target.value)
          }
          disabled={submitting}
        />

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
