"use client";

import { ThemeToggle } from "@bearhacks/ui/theme";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useMeAuth } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";

type HeaderProfile = {
  id: string;
  display_name?: string | null;
};

export function SiteHeader() {
  const auth = useMeAuth();
  const client = useApiClient();
  const userId = auth?.user?.id ?? null;

  const profileQuery = useQuery({
    queryKey: ["me-profile", userId],
    queryFn: () => client!.fetchJson<HeaderProfile>(`/profiles/${userId}`),
    enabled: Boolean(client && userId),
    staleTime: 60_000,
  });

  const displayName =
    profileQuery.data?.display_name?.trim() ||
    auth?.user?.user_metadata?.full_name ||
    auth?.user?.email?.split("@")[0] ||
    null;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-(--bearhacks-primary-hover)/30 bg-(--bearhacks-primary) text-(--bearhacks-on-primary)">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-2 rounded-(--bearhacks-radius-md) px-1 py-1 text-(--bearhacks-on-primary) no-underline cursor-pointer hover:opacity-80 active:opacity-70 transition-opacity"
          aria-label="BearHacks 2026 home"
        >
          <Image
            src="/brand/icon_white.svg"
            alt=""
            width={28}
            height={28}
            priority
            style={{ width: "28px", height: "auto" }}
          />
          <span className="text-base font-semibold tracking-wide">
            BearHacks 2026
          </span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-xs uppercase tracking-widest text-(--bearhacks-accent-soft)">
          {displayName && userId ? (
            <>
              <Link
                href={`/contacts/${userId}`}
                className="min-w-0 truncate font-bold text-(--bearhacks-accent) underline-offset-4 hover:underline"
                title={`Signed in as ${displayName} — view my profile`}
              >
                {displayName}
              </Link>
              <span aria-hidden="true" className="hidden text-(--bearhacks-accent-soft)/50 sm:inline">
                |
              </span>
            </>
          ) : null}
          <span className="hidden shrink-0 sm:inline">Networking</span>
          <ThemeToggle className="ml-1" />
        </div>
      </div>
    </header>
  );
}
