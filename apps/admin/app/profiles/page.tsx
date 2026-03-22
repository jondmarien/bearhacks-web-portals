"use client";

/**
 * Super-admin attendee directory (Linear DEV-22).
 *
 * API: `GET /admin/profiles` (super-admin only). Regular `admin` JWTs receive 403.
 *
 * TODO(DEV-21): When the dedicated admin sign-in / shell from DEV-21 lands, fold this route into
 * shared navigation and auth UX (assignee: Nayan — see Linear DEV-21). Until then, this page
 * relies on the same Supabase browser session as the rest of `apps/admin`.
 */

import { ApiError } from "@bearhacks/api-client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";
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
      toast.error(err.status === 403 ? "Super admin access required" : err.message);
    } else {
      toast.error("Failed to load profiles");
    }
  }, [query.error]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Profiles</h1>
          <p className="mt-1 text-sm text-(--bearhacks-muted)">
            Super-admin directory. Updates use <code className="rounded bg-(--bearhacks-border)/40 px-1">PATCH /profiles/{"{id}"}</code>.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-sm) px-3 text-sm underline"
        >
          Admin home
        </Link>
      </div>

      {!staff && (
        <p className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4 text-sm text-(--bearhacks-muted)">
          Sign in with a staff account (<code className="rounded px-1">app_metadata.role</code> admin or super_admin). The API
          enforces access on every request.
        </p>
      )}

      {staff && !isSuper && (
        <p className="rounded-(--bearhacks-radius-md) border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Your JWT role is <code className="rounded bg-white/60 px-1">admin</code>. This page calls super-admin-only routes;
          ask for <code className="rounded bg-white/60 px-1">super_admin</code> in Supabase or add your email to{" "}
          <code className="rounded bg-white/60 px-1">SUPER_ADMINS</code> on the API (see backend README).
        </p>
      )}

      {isSuper && (
        <>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedSearch(draftSearch);
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="profile-search" className="text-sm font-medium text-(--bearhacks-fg)">
                Search display name
              </label>
              <input
                id="profile-search"
                name="search"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base text-(--bearhacks-fg)"
                placeholder="Substring match"
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="min-h-(--bearhacks-touch-min) min-w-32 cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg)"
            >
              Apply
            </button>
          </form>

          {query.isLoading && <p className="text-sm text-(--bearhacks-muted)">Loading…</p>}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-(--bearhacks-muted)">No profiles match.</p>
          )}
          {query.data && query.data.length > 0 && (
            <div className="overflow-x-auto rounded-(--bearhacks-radius-md) border border-(--bearhacks-border)">
              <table className="w-full min-w-lg border-collapse text-left text-sm">
                <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-border)/20">
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
                      <span className="sr-only">Actions</span>
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
                        <Link
                          href={`/profiles/${row.id}`}
                          className="inline-flex min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-sm) px-2 text-sm underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
