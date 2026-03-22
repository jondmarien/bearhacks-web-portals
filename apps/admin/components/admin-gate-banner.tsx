"use client";

import { tryPublicEnv } from "@bearhacks/config";
import { useSupabase } from "@/app/providers";
import { useEffect, useState } from "react";

function roleFromSession(user: { app_metadata?: Record<string, unknown> } | null): string | undefined {
  const r = user?.app_metadata?.role;
  return typeof r === "string" ? r : undefined;
}

export function AdminGateBanner() {
  const supabase = useSupabase();
  const [role, setRole] = useState<string | undefined>();
  const envResult = tryPublicEnv();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setRole(roleFromSession(data.session?.user ?? null));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setRole(roleFromSession(session?.user ?? null));
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  if (!envResult.ok) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
        Set <code className="rounded bg-white/60 px-1">NEXT_PUBLIC_*</code> in{" "}
        <code className="rounded bg-white/60 px-1">apps/admin/.env.local</code>.
      </div>
    );
  }

  if (!supabase) {
    return null;
  }

  const isAdmin = role === "admin" || role === "super_admin";

  return (
    <div
      className={`border-b px-4 py-2 text-sm ${
        isAdmin ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      {isAdmin ? (
        <span>
          Signed in with role <code className="rounded bg-white/60 px-1">{role}</code>. All admin actions are still
          enforced by the FastAPI API.
        </span>
      ) : (
        <span>
          Not detected as admin in JWT <code className="rounded bg-white/60 px-1">app_metadata.role</code>. UI is for
          convenience only — <strong>the API enforces admin</strong> on every protected route.
        </span>
      )}
    </div>
  );
}
