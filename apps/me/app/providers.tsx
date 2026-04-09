"use client";

import { ApiError, createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { EmailClaimModal } from "@/components/email-claim-modal";
import { isDiscordBackedUser } from "@/lib/auth-session";
import { checkPortalAccess, claimPortalEmail } from "@/lib/check-portal-access";
import { readPendingScans, removePendingScansByProfileIds } from "@/lib/pending-scans";
import { trySyncDiscordGuild } from "@/lib/sync-discord-guild";

const log = createLogger("me/providers");
const SupabaseContext = createContext<SupabaseClient | null>(null);

/** Dashboard / account-linked sign-in (not the Discord guild join funnel). */
export type DashboardOAuthProvider = "google" | "apple" | "linkedin_oidc" | "facebook";

const MeAuthContext = createContext<{
  user: User | null;
  isAuthReady: boolean;
  joinBearhacks2026WithDiscord: () => Promise<void>;
  signInWithDashboardProvider: (provider: DashboardOAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
} | null>(null);

function buildMeAppOAuthRedirectTo(): string {
  if (typeof window === "undefined") return "/";
  const url = new URL(window.location.href);
  const nextParam = url.searchParams.get("next");
  if (nextParam?.startsWith("/") && !nextParam.startsWith("//")) {
    return `${url.origin}/?next=${encodeURIComponent(nextParam)}`;
  }
  const pathWithSearch = `${url.pathname}${url.search}`;
  if (pathWithSearch && pathWithSearch !== "/") {
    return `${url.origin}/?next=${encodeURIComponent(pathWithSearch)}`;
  }
  return `${url.origin}/`;
}

/** Null until client mount + valid `NEXT_PUBLIC_*` (avoids Zod throw during SSG/build). */
export function useSupabase(): SupabaseClient | null {
  return useContext(SupabaseContext);
}

export function useMeAuth() {
  return useContext(MeAuthContext);
}

function cleanOAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const authQueryKeys = ["code", "token", "type", "error", "error_code", "error_description"];
  let shouldReplace = false;
  for (const key of authQueryKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      shouldReplace = true;
    }
  }
  const hash = url.hash;
  if (
    hash.includes("access_token=") ||
    hash.includes("refresh_token=") ||
    hash.includes("error=") ||
    hash.includes("error_code=")
  ) {
    url.hash = "";
    shouldReplace = true;
  }
  if (shouldReplace) {
    window.history.replaceState({}, document.title, url.toString());
    log.debug("Cleaned OAuth params from URL");
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [emailClaimOpen, setEmailClaimOpen] = useState(false);

  useEffect(() => {
    const parsed = tryPublicEnv();
    if (!parsed.ok) {
      log.debug("Public env invalid or missing; Supabase client not created");
      return;
    }
    const env = parsed.data;
    // Defer setState so we don't sync-update during the effect (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setSupabase(createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
      log.debug("Supabase browser client ready");
    });
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.warn("Initial auth session load failed", { error });
        }
        queueMicrotask(() => {
          setUser(data.session?.user ?? null);
          setIsAuthReady(true);
          if (data.session) {
            cleanOAuthParamsFromUrl();
          }
        });
      })
      .catch((error) => {
        if (cancelled) return;
        log.error("Unexpected error while loading auth session", { error });
        queueMicrotask(() => setIsAuthReady(true));
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => {
        setUser(session?.user ?? null);
        setIsAuthReady(true);
        if (session) {
          cleanOAuthParamsFromUrl();
        }
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const runPortalFlow = useCallback(async () => {
    if (!supabase || !user) return;
    const access = await checkPortalAccess(supabase);
    if (!access.allowed) {
      if (access.reason === "not_accepted") {
        queueMicrotask(() => setEmailClaimOpen(true));
        return;
      }
      if (access.reason === "missing_email") {
        await supabase.auth.signOut();
        toast.error(
          "We could not read an email from your account. Allow email access for the BearHacks app and try again.",
        );
      }
      return;
    }
    queueMicrotask(() => setEmailClaimOpen(false));
    if (isDiscordBackedUser(user)) {
      await trySyncDiscordGuild(supabase);
    }

    const env = tryPublicEnv();
    if (!env.ok) return;
    const pending = readPendingScans().filter((item) => item.profileId !== user.id);
    if (pending.length === 0) return;

    const api = createApiClient({
      baseUrl: env.data.NEXT_PUBLIC_API_URL,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
    });
    const succeeded: string[] = [];
    for (const item of pending) {
      try {
        await api.fetchJson<{ success: boolean }>(`/social/scan/${item.profileId}`, { method: "POST" });
        succeeded.push(item.profileId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          break;
        }
        log.warn("Failed to sync pending local scan", { profileId: item.profileId, error });
      }
    }
    if (succeeded.length > 0) {
      removePendingScansByProfileIds(succeeded);
      log.info("Synced pending local scans after auth", { count: succeeded.length });
    }
  }, [supabase, user]);

  useEffect(() => {
    queueMicrotask(() => {
      void runPortalFlow();
    });
  }, [runPortalFlow]);

  const handleEmailClaimSubmit = useCallback(
    async (email: string) => {
      if (!supabase) return;
      await claimPortalEmail(supabase, email);
      toast.success("Email verified.");
      await runPortalFlow();
    },
    [supabase, runPortalFlow],
  );

  const handleEmailClaimSignOut = useCallback(async () => {
    setEmailClaimOpen(false);
    if (!supabase) return;
    await supabase.auth.signOut();
  }, [supabase]);

  const joinBearhacks2026WithDiscord = useCallback(async () => {
    if (!supabase) return;
    const redirectTo = buildMeAppOAuthRedirectTo();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify email guilds.join",
      },
    });
    if (error) {
      log.error("Discord join flow failed to start", { error });
      throw error;
    }
  }, [supabase]);

  const signInWithDashboardProvider = useCallback(
    async (provider: DashboardOAuthProvider) => {
      if (!supabase) return;
      const redirectTo = buildMeAppOAuthRedirectTo();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) {
        log.error("Dashboard OAuth failed to start", { provider, error });
        throw error;
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      log.error("Sign out failed", { error });
      throw error;
    }
  }, [supabase]);

  const oauthEmailHint = user?.email?.trim() || null;

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext.Provider value={supabase}>
        <MeAuthContext.Provider
          value={{
            user,
            isAuthReady,
            joinBearhacks2026WithDiscord,
            signInWithDashboardProvider,
            signOut,
          }}
        >
          {children}
          <EmailClaimModal
            open={emailClaimOpen && !!user}
            oauthEmailHint={oauthEmailHint}
            onSubmit={handleEmailClaimSubmit}
            onSignOut={handleEmailClaimSignOut}
          />
          <Toaster richColors position="top-center" />
        </MeAuthContext.Provider>
      </SupabaseContext.Provider>
    </QueryClientProvider>
  );
}
