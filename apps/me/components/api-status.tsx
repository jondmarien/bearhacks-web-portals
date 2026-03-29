"use client";

import { createApiClient } from "@bearhacks/api-client";
import { tryPublicEnv } from "@bearhacks/config";
import { createLogger } from "@bearhacks/logger";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

const log = createLogger("me/api-status");

type HealthJson = { status?: string };

export function ApiStatus() {
  const envResult = tryPublicEnv();
  const env = envResult.ok ? envResult.data : null;
  const ready = envResult.ok;

  const client = useMemo(() => {
    if (!env) return null;
    return createApiClient({
      baseUrl: env.NEXT_PUBLIC_API_URL,
    });
  }, [env]);

  const q = useQuery({
    queryKey: ["api", "health", env?.NEXT_PUBLIC_API_URL ?? ""],
    queryFn: () => client!.fetchJson<HealthJson>("/"),
    enabled: ready && client !== null,
  });

  useEffect(() => {
    if (q.isError && q.error) {
      log.warn("GET / health check failed", q.error);
    }
  }, [q.isError, q.error]);

  if (!envResult.ok) {
    return (
      <p className="text-sm text-(--bearhacks-brown-type)">
        Set <code className="rounded bg-(--bearhacks-yellow)/40 px-1">NEXT_PUBLIC_*</code> in{" "}
        <code className="rounded bg-(--bearhacks-yellow)/40 px-1">apps/me/.env.local</code> (see repo{" "}
        <code className="rounded bg-(--bearhacks-yellow)/40 px-1">.env.example</code>).
      </p>
    );
  }

  if (q.isPending) {
    return <p className="text-sm text-(--bearhacks-muted)">Checking API…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-sm text-(--bearhacks-brown-type)">
        API unreachable. Is FastAPI running at {env!.NEXT_PUBLIC_API_URL}?
      </p>
    );
  }
  return (
    <p className="text-sm text-(--bearhacks-muted)">
      API: <code className="rounded bg-(--bearhacks-border)/30 px-1">{q.data?.status ?? "ok"}</code>
      <button
        type="button"
        className="ml-2 underline"
        onClick={() => {
          q.refetch().then(() => toast.success("Refreshed"));
        }}
      >
        Refresh
      </button>
    </p>
  );
}
