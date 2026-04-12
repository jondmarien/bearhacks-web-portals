"use client";

import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { createStructuredLogger } from "@/lib/structured-logging";

const log = createStructuredLogger("admin/home-dashboard");

export default function AdminHome() {
  const supabase = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const actor = user?.id ?? "anonymous";

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      log("debug", {
        event: "admin_home_session",
        actor: data.session?.user?.id ?? "anonymous",
        resourceId: "/",
        result: "loaded",
      });
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      log("debug", {
        event: "admin_home_session",
        actor: session?.user?.id ?? "anonymous",
        resourceId: "/",
        result: "auth_state_changed",
      });
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Admin</h1>
      <p className="text-sm text-(--bearhacks-muted)">
        Staff portal — QR management (DEV-21) and super-admin profiles (DEV-22).
      </p>
      {user ? (
        <button
          type="button"
          onClick={() => {
            if (!supabase) return;
            log("info", {
              event: "admin_home_sign_out",
              actor,
              resourceId: "/",
              result: "submitted",
            });
            void supabase.auth.signOut().catch((error: unknown) => {
              log("error", {
                event: "admin_home_sign_out",
                actor,
                resourceId: "/",
                result: "error",
                error,
              });
              toast.error("Unable to sign out");
            });
          }}
          className="inline-flex min-h-(--bearhacks-touch-min) items-center text-sm underline"
        >
          Sign out
        </button>
      ) : null}
      <ul className="flex flex-col gap-3 text-sm">
        <li>
          <Link className="inline-flex min-h-(--bearhacks-touch-min) items-center underline" href="/qr">
            QR tools
          </Link>
        </li>
        <li>
          <Link className="inline-flex min-h-(--bearhacks-touch-min) items-center underline" href="/profiles">
            Attendee profiles (super-admin)
          </Link>
        </li>
      </ul>
    </main>
  );
}
