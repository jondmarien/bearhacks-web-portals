"use client";

import { createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSupabase } from "@/app/providers";
import { toast } from "sonner";

type HealthJson = { status?: string };

export function ApiStatus() {
  const supabase = useSupabase();
  const envResult = tryPublicEnv();
  const env = envResult.ok ? envResult.data : null;
  const ready = envResult.ok && supabase !== null;

  const client = useMemo(() => {
    if (!env || !supabase) return null;
    return createApiClient({
      baseUrl: env.NEXT_PUBLIC_API_URL,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
    });
  }, [env, supabase]);

  const q = useQuery({
    queryKey: ["api", "health", env?.NEXT_PUBLIC_API_URL ?? ""],
    queryFn: () => client!.fetchJson<HealthJson>("/"),
    enabled: ready && client !== null,
  });

  if (!envResult.ok) {
    return (
      <p className="text-sm text-amber-800">
        Set <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_*</code> in{" "}
        <code className="rounded bg-amber-100 px-1">apps/me/.env.local</code> (see repo{" "}
        <code className="rounded bg-amber-100 px-1">.env.example</code>).
      </p>
    );
  }

  if (!supabase) {
    return <p className="text-sm text-(--bearhacks-muted)">Starting…</p>;
  }

  if (q.isPending) {
    return <p className="text-sm text-(--bearhacks-muted)">Checking API…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-sm text-red-600">
        API unreachable. Is FastAPI running at {env!.NEXT_PUBLIC_API_URL}?
      </p>
    );
  }
  return (
    <p className="text-sm text-(--bearhacks-muted)">
      API: <code className="rounded bg-neutral-100 px-1">{q.data?.status ?? "ok"}</code>
      <button
        type="button"
        className="ml-2 text-blue-600 underline"
        onClick={() => {
          q.refetch().then(() => toast.success("Refreshed"));
        }}
      >
        Refresh
      </button>
    </p>
  );
}
