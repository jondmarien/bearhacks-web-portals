/**
 * Pure presentation logic for the boba status card.
 *
 * Centralises the "what should the hacker see right now?" decision so the
 * status card on the home page and the headline on `/boba` cannot disagree.
 * Keeping this pure (no React, no fetch) makes it trivial to unit-test.
 */

import type { BobaOrder, BobaWindowsResponse } from "@/lib/boba-queries";

export type BobaStatus =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "closed-no-upcoming"; lastFulfilledAt?: string | null }
  | {
      kind: "opens-later";
      window: BobaWindowsResponse["windows"][number];
      opensInMs: number;
    }
  | {
      kind: "open-no-order";
      window: BobaWindowsResponse["windows"][number];
      closesInMs: number;
    }
  | {
      kind: "open-has-order";
      window: BobaWindowsResponse["windows"][number];
      order: BobaOrder;
      closesInMs: number;
    }
  | {
      kind: "open-cancelled";
      window: BobaWindowsResponse["windows"][number];
      closesInMs: number;
    };

export type StatusInputs = {
  isAuthReady: boolean;
  userId: string | null;
  windows: BobaWindowsResponse | undefined;
  order: BobaOrder | null | undefined;
  /** Defaults to wall clock; pass in for tests. */
  now?: Date;
};

export function computeBobaStatus({
  isAuthReady,
  userId,
  windows,
  order,
  now,
}: StatusInputs): BobaStatus {
  if (!isAuthReady) return { kind: "loading" };
  if (!userId) return { kind: "signed-out" };
  if (!windows) return { kind: "loading" };

  const moment = now ?? new Date();
  const activeId = windows.active_window_id;
  const upcomingId = windows.next_upcoming_window_id;

  const active = activeId
    ? windows.windows.find((w) => w.id === activeId)
    : null;
  const upcoming = upcomingId
    ? windows.windows.find((w) => w.id === upcomingId)
    : null;

  if (active) {
    const closesInMs = new Date(active.closes_at).getTime() - moment.getTime();
    if (order && order.meal_window_id === active.id) {
      if (order.status === "cancelled") {
        return { kind: "open-cancelled", window: active, closesInMs };
      }
      return { kind: "open-has-order", window: active, order, closesInMs };
    }
    return { kind: "open-no-order", window: active, closesInMs };
  }

  if (upcoming) {
    const opensInMs = new Date(upcoming.opens_at).getTime() - moment.getTime();
    return { kind: "opens-later", window: upcoming, opensInMs };
  }

  return {
    kind: "closed-no-upcoming",
    lastFulfilledAt: order?.updated_at ?? null,
  };
}

export function formatRelativeMs(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) return "<1m";
  return parts.join(" ");
}

export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-CA", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });
}
