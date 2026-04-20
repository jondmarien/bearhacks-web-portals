"use client";

import Image from "next/image";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { createStructuredLogger } from "@/lib/structured-logging";
import { isSuperAdminUser } from "@/lib/supabase-role";
import { useDocumentTitle } from "@/lib/use-document-title";

const log = createStructuredLogger("admin/home-dashboard");

export default function AdminHome() {
  const supabase = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const actor = user?.id ?? "anonymous";
  useDocumentTitle("Dashboard");

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

  if (!user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-(--bearhacks-cream) px-6 py-16 sm:py-24">
        <section className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          <Image
            src="/brand/wordmark_hero.webp"
            alt="BearHacks 2026"
            width={738}
            height={220}
            priority
            className="w-full max-w-xs sm:max-w-sm"
            style={{ height: "auto" }}
          />
          <p className="text-sm font-extrabold uppercase tracking-[0.15rem] text-(--bearhacks-text-marketing) sm:text-base">
            Staff console · BearHacks 2026
          </p>
          <p className="text-sm text-(--bearhacks-text-marketing)/80 sm:text-base">
            Sign in with your staff Discord account using the banner above to
            continue.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Admin"
        tone="marketing"
        subtitle="Tools for the BearHacks 2026 staff team."
        actions={
          <Button
            variant="pill"
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
          >
            Sign out
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/qr" className="no-underline">
          <Card className="h-full transition-shadow hover:shadow-lg">
            <CardTitle>
              QR <span className="bg-(--bearhacks-cream) px-1 rounded-sm">fulfillment</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Generate, search, reprint, and inspect attendee QR codes.
            </CardDescription>
            <span className="mt-4 inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 py-3 text-sm font-semibold text-(--bearhacks-primary)">
              Open QR tools →
            </span>
          </Card>
        </Link>
        <Link href="/profiles" className="no-underline">
          <Card className="h-full transition-shadow hover:shadow-lg">
            <CardTitle>
              Profile <span className="bg-(--bearhacks-cream) px-1 rounded-sm">directory</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Search and edit attendee profiles (super-admin only).
            </CardDescription>
            <span className="mt-4 inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 py-3 text-sm font-semibold text-(--bearhacks-primary)">
              Open profiles →
            </span>
          </Card>
        </Link>
        <Link href="/super-admins" className="no-underline">
          <Card className="h-full transition-shadow hover:shadow-lg">
            <CardTitle>
              Super Admin <span className="bg-(--bearhacks-cream) px-1 rounded-sm">tools</span>
            </CardTitle>  
            <CardDescription className="mt-1">
              Grant or revoke Super Admin access by Discord email.
            </CardDescription>
            <span className="mt-4 inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 py-3 text-sm font-semibold text-(--bearhacks-primary)">
              Open super-admin tools →
            </span>
          </Card>
        </Link>
        {isSuperAdminUser(user) ? (
          <Link href="/boba-orders" className="no-underline">
            <Card className="h-full transition-shadow hover:shadow-lg">
              <CardTitle>
                Boba <span className="bg-(--bearhacks-cream) px-1 rounded-sm">orders</span>
              </CardTitle>
              <CardDescription className="mt-1">
                Live order list, prep summary, pickup list, and CSV export per
                meal window.
              </CardDescription>
              <span className="mt-4 inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 py-3 text-sm font-semibold text-(--bearhacks-primary)">
                Open boba orders →
              </span>
            </Card>
          </Link>
        ) : null}
      </div>
    </main>
  );
}
