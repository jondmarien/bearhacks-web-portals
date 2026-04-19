"use client";

/**
 * Super-admin manager: grant or revoke `super_admin` access by Discord email.
 *
 * API: `GET|POST|DELETE /admin/super-admins` (super-admin only). Mutations update
 * both the Supabase Auth `app_metadata.role` JWT and the `portal_super_admin_emails`
 * Postgres allowlist in one round-trip.
 */

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InputField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";
import { createStructuredLogger } from "@/lib/structured-logging";

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

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail = error.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof detail === "string" && detail.trim()) return detail;
    if (error.message) return error.message;
  }
  return fallback;
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
    const message = describeError(query.error, "Failed to load super-admins");
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
      log("info", {
        event: "admin_super_admin_grant",
        actor,
        resourceId: row.email,
        result: "success",
      });
      setEmailDraft("");
      toast.success(`Granted super-admin to ${row.email}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin-super-admins"] });
    },
    onError: (error: unknown, email) => {
      const message = describeError(
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
      const message = describeError(error, "Could not fix drift.");
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
    mutationFn: async ({ userId }: { userId: string; email: string }) =>
      client!.fetchJson<void>(`/admin/super-admins/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, variables) => {
      log("info", {
        event: "admin_super_admin_revoke",
        actor,
        resourceId: variables.userId,
        result: "success",
      });
      toast.success(`Revoked super-admin from ${variables.email}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin-super-admins"] });
    },
    onError: (error: unknown, variables) => {
      const message = describeError(
        error,
        "Could not revoke super-admin access.",
      );
      log("error", {
        event: "admin_super_admin_revoke",
        actor,
        resourceId: variables.userId,
        result: "error",
        error: message,
      });
      toast.error(message);
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
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
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-900">
            Super Admin access required
          </CardTitle>
          <CardDescription className="mt-1 text-amber-900">
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
              They need to have signed in with Discord at least once before you
              can grant Super Admin access.
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
            <div className="flex flex-col gap-3 border-b border-(--bearhacks-border) px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
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
                const driftCount = (query.data ?? []).filter(
                  (r) => r.on_allowlist !== r.has_jwt_role,
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
              <div className="overflow-x-auto">
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
                      const drift = row.on_allowlist !== row.has_jwt_role;
                      const missingUserId = !row.user_id;
                      return (
                        <tr
                          key={row.user_id || row.email}
                          className="border-b border-(--bearhacks-border) last:border-0"
                        >
                          <td className="px-3 py-3 text-(--bearhacks-fg)">
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
                            {drift ? (
                              <span
                                className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
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
                              disabled={
                                isSelf ||
                                missingUserId ||
                                revokeMutation.isPending
                              }
                              title={
                                isSelf
                                  ? "You can't revoke your own Super Admin role."
                                  : missingUserId
                                    ? "No matching auth user — clean up the allowlist row directly in Supabase."
                                    : undefined
                              }
                              onClick={() => {
                                if (isSelf || missingUserId) return;
                                void (async () => {
                                  const ok = await confirm({
                                    title: "Revoke Super Admin access?",
                                    description: `${row.email} will lose Super Admin access immediately.`,
                                    confirmLabel: "Revoke",
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
                              Revoke
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
