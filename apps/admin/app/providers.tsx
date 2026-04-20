"use client";

import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { DismissableToaster } from "@/components/dismissable-toaster";
import { AlertDialogProvider } from "@/components/ui/alert-dialog";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

const log = createLogger("admin/providers");
const SupabaseContext = createContext<SupabaseClient | null>(null);

/** Null until client mount + valid `NEXT_PUBLIC_*` (avoids Zod throw during SSG/build). */
export function useSupabase(): SupabaseClient | null {
  return useContext(SupabaseContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

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

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseContext.Provider value={supabase}>
        <ConfirmDialogProvider>
          <AlertDialogProvider>{children}</AlertDialogProvider>
        </ConfirmDialogProvider>
        <DismissableToaster richColors position="top-center" />
      </SupabaseContext.Provider>
    </QueryClientProvider>
  );
}
