"use client";

import { createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { useMemo } from "react";
import { useSupabase } from "@/app/providers";

/**
 * Memoized FastAPI client that sends `Authorization: Bearer <Supabase access_token>`.
 * Returns `null` when public env is invalid or Supabase has not mounted yet (same pattern as `apps/me` health demo).
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
