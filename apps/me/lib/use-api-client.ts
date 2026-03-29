"use client";

import { createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { useMemo } from "react";
import { useSupabase } from "@/app/providers";

/**
 * Memoized FastAPI client for participant pages.
 * Adds Supabase access token when present.
 */
export function useApiClient() {
  const supabase = useSupabase();

  return useMemo(() => {
    const env = tryPublicEnv();
    if (!env.ok || !supabase) return null;

    return createApiClient({
      baseUrl: env.data.NEXT_PUBLIC_API_URL,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
    });
  }, [supabase]);
}
