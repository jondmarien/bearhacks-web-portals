"use client";

import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, type User, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Toaster } from "sonner";

const log = createLogger("me/providers");
const SupabaseContext = createContext<SupabaseClient | null>(null);
const MeAuthContext = createContext<{
  user: User | null;
  isAuthReady: boolean;
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
} | null>(null);

/** Null until client mount + valid `NEXT_PUBLIC_*` (avoids Zod throw during SSG/build). */
export function useSupabase(): SupabaseClient | null {
  return useContext(SupabaseContext);
}

export function useMeAuth() {
  return useContext(MeAuthContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authQueryKeys = ["code", "token", "type", "error", "error_code", "error_description"];
    let shouldReplace = false;
    for (const key of authQueryKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        shouldReplace = true;
      }
    }

    // Supabase can return session fragments in URL hash after OAuth redirect.
    const hash = window.location.hash;
    const hasAuthHash =
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      hash.includes("error=") ||
      hash.includes("error_code=");
    if (hasAuthHash) {
      url.hash = "";
      shouldReplace = true;
    }

    if (shouldReplace) {
      window.history.replaceState({}, document.title, url.toString());
      log.debug("Cleaned OAuth params from URL");
    }
  }, []);

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
      log.debug("Supabase browser client ready (Discord OAuth enabled)");
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
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithDiscord = useCallback(async () => {
    if (!supabase) return;
    const redirectTo = `${window.location.origin}/dashboard`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo },
    });
    if (error) {
      log.error("Discord login failed to start", { error });
      throw error;
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      log.error("Sign out failed", { error });
      throw error;
    }
  }, [supabase]);

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext.Provider value={supabase}>
        <MeAuthContext.Provider value={{ user, isAuthReady, signInWithDiscord, signOut }}>
          {children}
          <Toaster richColors position="top-center" />
        </MeAuthContext.Provider>
      </SupabaseContext.Provider>
    </QueryClientProvider>
  );
}
