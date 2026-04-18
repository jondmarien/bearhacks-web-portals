"use client";

import { createLogger } from "@bearhacks/logger";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const log = createLogger("me/error-boundary");

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log.error("Unhandled portal error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong.</CardTitle>
          <CardDescription>
            We hit an unexpected error loading this page. Please try again.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Link
            href="/"
            className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-surface-alt)"
          >
            Go home
          </Link>
        </div>
      </Card>
    </main>
  );
}
