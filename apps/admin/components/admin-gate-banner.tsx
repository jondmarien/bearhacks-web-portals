"use client";

import { createLogger } from "@bearhacks/logger";
import { tryPublicEnv } from "@bearhacks/config";
import type { User } from "@supabase/supabase-js";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const log = createLogger("admin/auth-banner");

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  hacker: "Hacker",
  attendee: "Attendee",
};

function roleFromSession(user: User | null): string | undefined {
  const r = user?.app_metadata?.role;
  return typeof r === "string" ? r : undefined;
}

function formatRoleLabel(role: string | undefined): string {
  if (!role) return "Unknown";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
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
      <div className="border-b border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) px-4 py-2 text-sm text-(--bearhacks-warning-fg)">
        Missing public environment configuration. Add the required
        <code className="mx-1 rounded bg-(--bearhacks-surface)/60 px-1">NEXT_PUBLIC_*</code>
        values to <code className="rounded bg-(--bearhacks-surface)/60 px-1">apps/admin/.env.local</code>.
      </div>
    );
  }

  if (!supabase) {
    return null;
  }

  const isAdmin = role === "admin" || role === "super_admin";
  const signedInLabel = user?.email ?? user?.id ?? "";
  const roleLabel = formatRoleLabel(role);

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
        toast.error("Discord sign-in is currently disabled.");
      } else {
        toast.error("Unable to start Discord sign-in.");
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

  if (!user) {
    return (
      <div className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3 text-sm text-(--bearhacks-fg)">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Sign in with your staff Discord account to access the admin tools.</span>
          <Button
            variant="pill"
            onClick={() => {
              void signInWithDiscord();
            }}
            disabled={isBusy}
          >
            Sign in with Discord
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border-b px-4 py-3 text-sm ${
        isAdmin
          ? "border-(--bearhacks-success-border) bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg)"
          : "border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg)"
      }`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {isAdmin ? (
          <span>
            Signed in as <strong>{signedInLabel}</strong>. Role: {roleLabel}.
          </span>
        ) : (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Signed in as <strong>{signedInLabel}</strong>. This account is not
              on the admin list yet — ask a super-admin to add you, then sign
              out and back in.
            </span>
            <Button
              variant="pill"
              onClick={() => {
                void signOut();
              }}
              disabled={isBusy}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
