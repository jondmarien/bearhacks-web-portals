"use client";

/**
 * Super-admin manager: grant or revoke `super_admin` access by Discord email.
 *
 * API: `GET|POST|DELETE /admin/super-admins` (super-admin only). Mutations update
 * both the Supabase Auth `app_metadata.role` JWT and the `portal_super_admin_emails`
 * Postgres allowlist in one round-trip.
 */

import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InputField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { createStructuredLogger } from "@/lib/structured-logging";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { describeApiError } from "@bearhacks/api-client";
import type { User } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SuperAdminRow = {
  user_id: string;
  email: string;
  granted_at: string | null;
  on_allowlist: boolean;
  has_jwt_role: boolean;
};

type ReconcileResult = {
  upserted_emails: string[];
  deleted_emails: string[];
  granted_user_ids: string[];
};

const log = createStructuredLogger("admin/super-admins");

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AdminSuperAdminsPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const queryClient = useQueryClient();
  useDocumentTitle("Super Admins");
  const confirm = useConfirm();
  const [user, setUser] = useState<User | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isSuper = isSuperAdminUser(user);
  const staff = isStaffUser(user);
  const actor = user?.id ?? "anonymous";

  const query = useQuery({
    queryKey: ["admin-super-admins"],
    queryFn: () => client!.fetchJson<SuperAdminRow[]>("/admin/super-admins"),
    enabled: Boolean(client && isSuper),
  });

  useEffect(() => {
    if (!query.error) return;
    const message = describeApiError(
      query.error,
      "Failed to load super-admins",
    );
    log("error", {
      event: "admin_super_admins_list",
      actor,
      resourceId: "/admin/super-admins",
      result: "error",
      error: message,
    });
    toast.error(message);
  }, [query.error, actor]);

  const grantMutation = useMutation({
    mutationFn: async (email: string) =>
      client!.fetchJson<SuperAdminRow>("/admin/super-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    onSuccess: (row) => {
      const pending = !row.user_id;
      log("info", {
        event: "admin_super_admin_grant",
        actor,
        resourceId: row.email,
        result: pending ? "pending_first_login" : "success",
      });
      setEmailDraft("");
      toast.success(
        pending
          ? `Pre-granted super-admin to ${row.email}. They'll get the role automatically when they sign in.`
          : `Granted super-admin to ${row.email}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-super-admins"] });
    },
    onError: (error: unknown, email) => {
      const message = describeApiError(
        error,
        "Could not grant super-admin access.",
      );
      log("error", {
        event: "admin_super_admin_grant",
        actor,
        resourceId: email,
        result: "error",
        error: message,
      });
      toast.error(message);
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async () =>
      client!.fetchJson<ReconcileResult>("/admin/super-admins/reconcile", {
        method: "POST",
      }),
    onSuccess: (result) => {
      const total =
        result.upserted_emails.length +
        result.granted_user_ids.length +
        result.deleted_emails.length;
      log("info", {
        event: "admin_super_admins_reconcile",
        actor,
        resourceId: "/admin/super-admins/reconcile",
        result: "success",
        upserted: result.upserted_emails.length,
        granted: result.granted_user_ids.length,
        deleted: result.deleted_emails.length,
      });
      toast.success(
        total === 0
          ? "Nothing to fix — already in sync."
          : `Reconciled ${total} drift entr${total === 1 ? "y" : "ies"}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-super-admins"] });
    },
    onError: (error: unknown) => {
      const message = describeApiError(error, "Could not fix drift.");
      log("error", {
        event: "admin_super_admins_reconcile",
        actor,
        resourceId: "/admin/super-admins/reconcile",
        result: "error",
        error: message,
      });
      toast.error(message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({
      userId,
      email,
    }: {
      userId: string;
      email: string;
    }) => {
      const path = userId
        ? `/admin/super-admins/${encodeURIComponent(userId)}`
        : `/admin/super-admins/pending/${encodeURIComponent(email)}`;
      return client!.fetchJson<void>(path, { method: "DELETE" });
    },
    onSuccess: (_data, variables) => {
      const pending = !variables.userId;
      log("info", {
        event: pending
          ? "admin_super_admin_revoke_pending"
          : "admin_super_admin_revoke",
        actor,
        resourceId: variables.userId || variables.email,
        result: "success",
      });
      toast.success(
        pending
          ? `Cancelled pre-grant for ${variables.email}.`
          : `Revoked super-admin from ${variables.email}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-super-admins"] });
    },
    onError: (error: unknown, variables) => {
      const pending = !variables.userId;
      const message = describeApiError(
        error,
        pending
          ? "Could not cancel pre-grant."
          : "Could not revoke super-admin access.",
      );
      log("error", {
        event: pending
          ? "admin_super_admin_revoke_pending"
          : "admin_super_admin_revoke",
        actor,
        resourceId: variables.userId || variables.email,
        result: "error",
        error: message,
      });
      toast.error(message);
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Super Admins"
        tone="marketing"
        subtitle="Grant or revoke super-admin access by Discord email."
        backHref="/"
        showBack
      />

      {!staff && (
        <Card>
          <CardTitle>Staff access required</CardTitle>
          <CardDescription className="mt-1">
            Sign in with a staff account to manage Super Admins.
          </CardDescription>
        </Card>
      )}

      {staff && !isSuper && (
        <Card className="border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg)">
          <CardTitle className="text-(--bearhacks-warning-fg)">
            Super Admin access required
          </CardTitle>
          <CardDescription className="mt-1 text-(--bearhacks-warning-fg)">
            This page is limited to Super Admins. Ask a Super Admin to grant
            your account access, then sign out and back in.
          </CardDescription>
        </Card>
      )}

      {isSuper && (
        <>
          <Card>
            <CardTitle>Grant Super Admin</CardTitle>
            <CardDescription className="mt-1">
              Works even if the person hasn&apos;t signed in yet — we&apos;ll
              pre-approve the email and apply the role automatically on their
              first Discord sign-in.
            </CardDescription>
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = emailDraft.trim();
                if (!trimmed) {
                  toast.error("Enter a Discord email.");
                  return;
                }
                grantMutation.mutate(trimmed);
              }}
            >
              <div className="min-w-0 flex-1">
                <InputField
                  label="Discord email"
                  id="super-admin-email"
                  name="email"
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="someone@example.com"
                  autoComplete="off"
                  required
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={grantMutation.isPending}
              >
                {grantMutation.isPending ? "Granting…" : "Grant Super Admin"}
              </Button>
            </form>
          </Card>

          <Card className="p-0">
            <div className="flex flex-col gap-3 border-b border-(--bearhacks-border) px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
              <div>
                <CardTitle className="text-base">
                  Current{" "}
                  <span className="bg-(--bearhacks-cream) px-1 rounded-sm">
                    Super Admins
                  </span>
                </CardTitle>
                <CardDescription className="mt-1">
                  Source of truth: Supabase Auth + the
                  `portal_super_admin_emails` allowlist.
                </CardDescription>
              </div>
              {(() => {
                // Pre-grants (no auth user yet) are intentional, not drift.
                const driftCount = (query.data ?? []).filter(
                  (r) =>
                    Boolean(r.user_id) && r.on_allowlist !== r.has_jwt_role,
                ).length;
                const disabled =
                  reconcileMutation.isPending || driftCount === 0;
                return (
                  <Button
                    variant="primary"
                    disabled={disabled}
                    title={
                      driftCount === 0
                        ? "Nothing to fix — every row is in sync."
                        : `Reconcile ${driftCount} drift entr${driftCount === 1 ? "y" : "ies"}.`
                    }
                    onClick={() => {
                      if (disabled) return;
                      void (async () => {
                        const ok = await confirm({
                          title: `Fix drift for ${driftCount} entr${driftCount === 1 ? "y" : "ies"}?`,
                          description:
                            "This will sync the JWT role and the allowlist for every drift row.",
                          confirmLabel: "Fix drift",
                        });
                        if (!ok) return;
                        reconcileMutation.mutate();
                      })();
                    }}
                  >
                    {reconcileMutation.isPending
                      ? "Fixing…"
                      : driftCount > 0
                        ? `Fix drift (${driftCount})`
                        : "No drift"}
                  </Button>
                );
              })()}
            </div>
            {query.isLoading ? (
              <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
                Loading…
              </p>
            ) : query.data && query.data.length > 0 ? (
              <>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-lg border-collapse text-left text-sm">
                    <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
                      <tr>
                        <th
                          scope="col"
                          className="px-3 py-3 font-medium text-(--bearhacks-fg)"
                        >
                          Email
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 font-medium text-(--bearhacks-fg)"
                        >
                          Granted
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 font-medium text-(--bearhacks-fg)"
                        >
                          Status
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 font-medium text-(--bearhacks-fg)"
                        >
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.map((row) => {
                        const isSelf = row.user_id === user?.id;
                        const missingUserId = !row.user_id;
                        const isPending = missingUserId && row.on_allowlist;
                        const drift =
                          !isPending && row.on_allowlist !== row.has_jwt_role;
                        return (
                          <tr
                            key={row.user_id || row.email}
                            className="border-b border-(--bearhacks-border) last:border-0"
                          >
                            <td className="px-3 py-3 break-all text-(--bearhacks-fg)">
                              {row.email || "—"}
                              {isSelf ? (
                                <span className="ml-2 rounded bg-(--bearhacks-accent-soft) px-2 py-0.5 text-xs font-medium text-(--bearhacks-primary)">
                                  you
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-(--bearhacks-muted)">
                              {formatTimestamp(row.granted_at)}
                            </td>
                            <td className="px-3 py-3">
                              {isPending ? (
                                <span
                                  className="inline-flex items-center rounded border border-(--bearhacks-info-border) bg-(--bearhacks-info-bg) px-2 py-0.5 text-xs font-medium text-(--bearhacks-info-fg)"
                                  title="Pre-approved on the allowlist. They'll get the role on their first Discord sign-in."
                                >
                                  Pending login
                                </span>
                              ) : drift ? (
                                <span
                                  className="inline-flex items-center rounded border border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) px-2 py-0.5 text-xs font-medium text-(--bearhacks-warning-fg)"
                                  title={`JWT role: ${row.has_jwt_role ? "yes" : "no"} · Allowlist: ${row.on_allowlist ? "yes" : "no"}`}
                                >
                                  Drift
                                </span>
                              ) : (
                                <span className="text-xs text-(--bearhacks-muted)">
                                  In sync
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <Button
                                variant="pill"
                                disabled={isSelf || revokeMutation.isPending}
                                title={
                                  isSelf
                                    ? "You can't revoke your own Super Admin role."
                                    : isPending
                                      ? "Cancel this pre-grant before they sign in."
                                      : undefined
                                }
                                onClick={() => {
                                  if (isSelf) return;
                                  void (async () => {
                                    const ok = await confirm({
                                      title: isPending
                                        ? "Cancel pre-grant?"
                                        : "Revoke Super Admin access?",
                                      description: isPending
                                        ? `${row.email} won't be auto-promoted on their first sign-in.`
                                        : `${row.email} will lose Super Admin access immediately.`,
                                      confirmLabel: isPending
                                        ? "Cancel pre-grant"
                                        : "Revoke",
                                      tone: "danger",
                                    });
                                    if (!ok) return;
                                    revokeMutation.mutate({
                                      userId: row.user_id,
                                      email: row.email,
                                    });
                                  })();
                                }}
                              >
                                {isPending ? "Cancel" : "Revoke"}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="flex flex-col divide-y divide-(--bearhacks-border) sm:hidden">
                  {query.data.map((row) => {
                    const isSelf = row.user_id === user?.id;
                    const missingUserId = !row.user_id;
                    const isPending = missingUserId && row.on_allowlist;
                    const drift =
                      !isPending && row.on_allowlist !== row.has_jwt_role;
                    return (
                      <li
                        key={row.user_id || row.email}
                        className="flex flex-col gap-2 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all text-sm font-semibold text-(--bearhacks-fg)">
                            {row.email || "—"}
                          </span>
                          {isSelf ? (
                            <span className="rounded bg-(--bearhacks-accent-soft) px-2 py-0.5 text-xs font-medium text-(--bearhacks-primary)">
                              you
                            </span>
                          ) : null}
                          {isPending ? (
                            <span
                              className="inline-flex items-center rounded border border-(--bearhacks-info-border) bg-(--bearhacks-info-bg) px-2 py-0.5 text-xs font-medium text-(--bearhacks-info-fg)"
                              title="Pre-approved on the allowlist. They'll get the role on their first Discord sign-in."
                            >
                              Pending login
                            </span>
                          ) : drift ? (
                            <span
                              className="inline-flex items-center rounded border border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) px-2 py-0.5 text-xs font-medium text-(--bearhacks-warning-fg)"
                              title={`JWT role: ${row.has_jwt_role ? "yes" : "no"} · Allowlist: ${row.on_allowlist ? "yes" : "no"}`}
                            >
                              Drift
                            </span>
                          ) : (
                            <span className="text-xs text-(--bearhacks-muted)">
                              In sync
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-(--bearhacks-muted)">
                          Granted: {formatTimestamp(row.granted_at)}
                        </p>
                        <div>
                          <Button
                            variant="pill"
                            disabled={isSelf || revokeMutation.isPending}
                            title={
                              isSelf
                                ? "You can't revoke your own Super Admin role."
                                : isPending
                                  ? "Cancel this pre-grant before they sign in."
                                  : undefined
                            }
                            onClick={() => {
                              if (isSelf) return;
                              void (async () => {
                                const ok = await confirm({
                                  title: isPending
                                    ? "Cancel pre-grant?"
                                    : "Revoke Super Admin access?",
                                  description: isPending
                                    ? `${row.email} won't be auto-promoted on their first sign-in.`
                                    : `${row.email} will lose Super Admin access immediately.`,
                                  confirmLabel: isPending
                                    ? "Cancel pre-grant"
                                    : "Revoke",
                                  tone: "danger",
                                });
                                if (!ok) return;
                                revokeMutation.mutate({
                                  userId: row.user_id,
                                  email: row.email,
                                });
                              })();
                            }}
                          >
                            {isPending ? "Cancel" : "Revoke"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
                No Super Admins yet.
              </p>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
