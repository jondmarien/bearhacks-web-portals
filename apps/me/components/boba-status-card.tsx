"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@bearhacks/api-client";
import {
  useBobaWindowsQuery,
  useMyBobaOrderQuery,
} from "@/lib/boba-queries";
import {
  computeBobaStatus,
  formatClockTime,
  formatRelativeMs,
} from "@/lib/boba-status";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  isAuthReady: boolean;
  userId: string | null;
  // When the card is rendered directly above the order form (i.e. on
  // ``/boba``), the "Edit / Place order" CTA is redundant — the form is
  // literally the next block on screen. Set this to true there.
  hideEditCta?: boolean;
};

/**
 * Always-visible boba status block on the portal home page.
 *
 * Shows one of: closed, opens-at, open-now (with or without order), cancelled,
 * or signed-out. The "Open boba ordering →" CTA is the entry point to `/boba`.
 *
 * Re-renders every 30s to keep relative time copy ("opens in 12m") fresh
 * without spamming the network — the underlying queries already refetch on
 * their own interval.
 */
export function BobaStatusCard({ isAuthReady, userId, hideEditCta = false }: Props) {
  const windowsQuery = useBobaWindowsQuery();
  const orderQuery = useMyBobaOrderQuery(userId);
  const [, force] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Multi-order aware: prefer the most recent *placed* order so a hacker who
  // cancelled drink #1 then placed drink #2 still sees "Order placed", not
  // "Order cancelled". Fulfilled wins over the generic fallback so a drink
  // that was already picked up doesn't lose to a stale cancelled order
  // sitting in `orderQuery.data?.order` (the most-recent-by-created_at).
  const orders = orderQuery.data?.orders ?? [];
  const placedCount = orderQuery.data?.placed_count ?? 0;
  const maxOrders = orderQuery.data?.max_orders ?? 1;
  const focusedOrder =
    orders.find((o) => o.status === "placed") ??
    orders.find((o) => o.status === "fulfilled") ??
    orderQuery.data?.order ??
    null;

  const status = computeBobaStatus({
    isAuthReady,
    userId,
    windows: windowsQuery.data,
    order: focusedOrder,
  });

  const loadError =
    (windowsQuery.error instanceof ApiError && windowsQuery.error) ||
    (orderQuery.error instanceof ApiError && orderQuery.error) ||
    null;

  // Highlight the card when a meal window is actually open — accent border +
  // ring + lifted shadow so it visually anchors the dashboard. We deliberately
  // keep the white surface so the cream "Boba" pill in the title remains
  // legible (cream-on-cream would wash out).
  const isOpen =
    status.kind === "open-no-order" ||
    status.kind === "open-has-order" ||
    status.kind === "open-cancelled" ||
    status.kind === "open-fulfilled";

  const cardClassName = isOpen
    ? "border-(--bearhacks-accent) shadow-lg ring-2 ring-(--bearhacks-accent)/40"
    : "";

  // Only surface the "X of Y" line when the active window allows >1 drink
  // (i.e. the dev-test window). Real meal windows are 1/user — no need for
  // a quota meter.
  const showQuota = isOpen && maxOrders > 1;
  const canPlaceMore = placedCount < maxOrders;

  return (
    <Card className={cardClassName}>
      <CardHeader>
        <CardTitle>
          <span className="bg-(--bearhacks-cream) px-1 rounded-sm">Boba</span> ordering
        </CardTitle>
        <CardDescription>
          Pre-order your drink during meal windows so the food team can batch
          pickups.
        </CardDescription>
      </CardHeader>

      <StatusBody
        status={status}
        hideEditCta={hideEditCta}
        showQuota={showQuota}
        placedCount={placedCount}
        maxOrders={maxOrders}
        canPlaceMore={canPlaceMore}
      />

      {loadError ? (
        <p className="mt-3 text-xs text-red-700">{loadError.message}</p>
      ) : null}
    </Card>
  );
}

function StatusBody({
  status,
  hideEditCta,
  showQuota,
  placedCount,
  maxOrders,
  canPlaceMore,
}: {
  status: ReturnType<typeof computeBobaStatus>;
  hideEditCta: boolean;
  showQuota: boolean;
  placedCount: number;
  maxOrders: number;
  canPlaceMore: boolean;
}) {
  const quotaLine = showQuota ? (
    <p className="text-xs font-medium text-(--bearhacks-muted)">
      <span className="text-(--bearhacks-fg)">{placedCount}</span> of{" "}
      <span className="text-(--bearhacks-fg)">{maxOrders}</span> drinks placed
      for this window.
    </p>
  ) : null;

  switch (status.kind) {
    case "loading":
      return (
        <p className="text-sm text-(--bearhacks-muted)">Checking ordering window…</p>
      );

    case "signed-out":
      return (
        <p className="text-sm text-(--bearhacks-muted)">
          Sign in to place a boba order during meal windows.
        </p>
      );

    case "closed-no-upcoming":
      return (
        <div className="flex flex-col gap-2">
          <Pill tone="muted">Closed</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            All meal windows for the event have wrapped up. Thanks for hacking
            with us!
          </p>
        </div>
      );

    case "opens-later":
      return (
        <div className="flex flex-col gap-2">
          <Pill tone="muted">Opens later</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            <strong>{status.window.label}</strong> opens at{" "}
            {formatClockTime(status.window.opens_at)} (in{" "}
            {formatRelativeMs(status.opensInMs)}).
          </p>
          <p className="text-xs text-(--bearhacks-muted)">
            Pickup hint: {status.window.pickup_hint}
          </p>
        </div>
      );

    case "open-no-order":
      return (
        <div className="flex flex-col gap-3">
          <Pill tone="open">Open now</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            <strong>{status.window.label}</strong> closes in{" "}
            {formatRelativeMs(status.closesInMs)}.
          </p>
          {quotaLine}
          {hideEditCta ? null : <CtaLink>Place your order →</CtaLink>}
        </div>
      );

    case "open-has-order":
      return (
        <div className="flex flex-col gap-3">
          <Pill tone="open">Order placed</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            You&apos;re in for <strong>{status.window.label}</strong>. Edit or
            cancel until {formatClockTime(status.window.closes_at)} (
            {formatRelativeMs(status.closesInMs)} left).
          </p>
          {quotaLine}
          {hideEditCta ? null : (
            <CtaLink>
              {showQuota && canPlaceMore
                ? "Add another drink →"
                : "Edit your order →"}
            </CtaLink>
          )}
        </div>
      );

    case "open-cancelled":
      return (
        <div className="flex flex-col gap-3">
          <Pill tone="muted">Order cancelled</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            <strong>{status.window.label}</strong> is still open until{" "}
            {formatClockTime(status.window.closes_at)} — place a new order if
            you change your mind.
          </p>
          {quotaLine}
          {hideEditCta ? null : <CtaLink>Place a new order →</CtaLink>}
        </div>
      );

    case "open-fulfilled":
      // Multi-cap windows let the hacker queue another drink after pickup;
      // single-cap (real meal) windows are done — no edit CTA, no "place
      // another" prompt, just confirmation that the pickup happened.
      return (
        <div className="flex flex-col gap-3">
          <Pill tone="muted">Picked up</Pill>
          <p className="text-sm text-(--bearhacks-fg)">
            Your drink for <strong>{status.window.label}</strong> was picked
            up. Enjoy!
            {showQuota && canPlaceMore
              ? " Window is still open — feel free to add another drink."
              : ""}
          </p>
          {quotaLine}
          {hideEditCta || !showQuota || !canPlaceMore ? null : (
            <CtaLink>Add another drink →</CtaLink>
          )}
        </div>
      );
  }
}

function Pill({
  tone,
  children,
}: {
  tone: "open" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "open"
      ? "bg-(--bearhacks-accent) text-(--bearhacks-primary)"
      : "bg-(--bearhacks-surface-alt) text-(--bearhacks-text-marketing)/80 border border-(--bearhacks-border)";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-(--bearhacks-radius-pill) px-3 py-1 text-xs font-semibold uppercase tracking-[0.1rem] ${cls}`}
    >
      {children}
    </span>
  );
}

function CtaLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href="/boba"
      className="inline-flex w-fit min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
    >
      {children}
    </Link>
  );
}
