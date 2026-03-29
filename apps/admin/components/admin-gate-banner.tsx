"use client";

import { createLogger } from "@bearhacks/logger";
import { tryPublicEnv } from "@bearhacks/config";
import type { User } from "@supabase/supabase-js";
import { useSupabase } from "@/app/providers";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const log = createLogger("admin/auth-banner");

function roleFromSession(user: User | null): string | undefined {
  const r = user?.app_metadata?.role;
  return typeof r === "string" ? r : undefined;
}

export function AdminGateBanner() {
  const supabase = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const envResult = tryPublicEnv();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null;
      setUser(nextUser);
      setRole(roleFromSession(nextUser));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setRole(roleFromSession(nextUser));
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
  const signedInLabel = user?.email ?? user?.id ?? "";

  async function signInWithDiscord() {
    if (!supabase) return;
    setIsBusy(true);
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo },
    });
    setIsBusy(false);
    if (error) {
      log.error("Discord sign in failed", { error });
      if (error.message.toLowerCase().includes("provider is not enabled")) {
        toast.error("Discord auth provider is disabled in Supabase for this project.");
      } else {
        toast.error("Unable to start Discord login");
      }
    }
  }

  async function signOut() {
    if (!supabase) return;
    setIsBusy(true);
    const { error } = await supabase.auth.signOut();
    setIsBusy(false);
    if (error) {
      log.error("Sign out failed", { error });
      toast.error("Sign out failed");
      return;
    }
    toast.success("Signed out");
  }

  return (
    <div
      className={`border-b px-4 py-2 text-sm ${
        isAdmin ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      {isAdmin ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Signed in as <code className="rounded bg-white/60 px-1">{signedInLabel}</code> with role{" "}
            <code className="rounded bg-white/60 px-1">{role}</code>. All admin actions are still enforced by the
            FastAPI API.
          </span>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            disabled={isBusy}
            className="inline-flex min-h-(--bearhacks-touch-min) items-center underline disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span>
            Not detected as admin in JWT <code className="rounded bg-white/60 px-1">app_metadata.role</code>. UI is
            for convenience only — <strong>the API enforces admin</strong> on every protected route.
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => {
                void signInWithDiscord();
              }}
              disabled={isBusy}
              className="inline-flex min-h-(--bearhacks-touch-min) items-center underline disabled:opacity-60"
            >
              Sign in with Discord
            </button>
            <span className="text-xs text-amber-900/80">
              Uses Supabase OAuth (redirects to provider auth page).
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
