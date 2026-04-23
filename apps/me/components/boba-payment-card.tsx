"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useState } from "react";
import { toast } from "sonner";
import {
  useSubmitBobaPaymentMutation,
  useUndoBobaPaymentMutation,
  type BobaMenuResponse,
  type BobaMomoOrder,
  type BobaOrder,
  type BobaPayment,
} from "@/lib/boba-queries";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const log = createLogger("me/boba-payment");

type Props = {
  /** Drinks placed for the active window, each carrying its own payment. */
  drinks: readonly BobaOrder[];
  /** Momo orders placed for the active window, each carrying their own payment. */
  momos: readonly BobaMomoOrder[];
  /** Menu data used to render readable drink/momo labels per row. */
  menu: BobaMenuResponse | null;
  /** E-transfer recipient name (e.g. "Audrey"). */
  recipientName: string;
  /** E-transfer email address. */
  etransferEmail: string;
  /** Discount note shown under the total ("40% off Gong Cha menu, taxes included"). */
  discountNote: string;
  /**
   * Rendering mode:
   *   - ``"card"`` (default): wraps the contents in a ``<Card>`` surface
   *     with a status-driven border tone.
   *   - ``"section"``: renders the header + body inline, without the
   *     outer card shell or status-tone border. Used inside
   *     ``BobaPortalCard`` so the tabbed portal owns the single surface.
   */
  variant?: "card" | "section";
};

type PayableRow = {
  key: string;
  kind: "drink" | "momo";
  orderId: string;
  title: string;
  payment: BobaPayment;
  /** Epoch ms of the underlying order's ``created_at``. */
  createdAt: number;
};

/**
 * Visual bundle of 1–2 payment rows that came from the same
 * ``POST /boba/orders/me`` submission.
 *
 * The per-order backend intentionally doesn't persist a "cart id" —
 * each drink and each momo is its own row with its own payment. Hackers
 * routinely place a drink + momo together in one submission though, and
 * rendering those as two separate "please send $4.75" / "please send
 * $5.65" entries makes the outstanding list feel longer than it is and
 * hides the fact that a single $10.40 e-transfer covers both.
 *
 * Since there's no explicit submission id, we heuristically pair a
 * drink with a momo when they:
 *   - belong to the same ``meal_window_id``, AND
 *   - were inserted within ``SAME_SUBMISSION_EPSILON_MS`` of each other.
 *
 * The backend inserts both rows back-to-back inside a single HTTP
 * handler, so in practice their ``created_at`` timestamps differ by
 * a handful of milliseconds — well inside the epsilon. A 3-second
 * window gives us comfortable slack for DB clock jitter without
 * accidentally pairing two genuinely separate submissions (the UI
 * flow requires a full form round-trip between POSTs, which is way
 * more than 3s).
 */
type PayableGroup = {
  key: string;
  rows: PayableRow[];
  /** Epoch ms of the earliest row in the group — used for stable sort. */
  earliestCreatedAt: number;
  totalExpectedCents: number;
  totalReceivedCents: number;
};

const SAME_SUBMISSION_EPSILON_MS = 3000;

/**
 * Per-order payment UI.
 *
 * Each placed drink + momo carries its own ``payment`` row in the
 * per-order model, so this card renders:
 *
 *   - A rollup header ("$X across N orders · Y unpaid · Z confirmed")
 *   - Shared e-transfer instructions while *any* row still needs money
 *   - A ``<ul>`` of per-order rows with their own status pill and CTA
 *
 * Drift (hacker edited the size after confirmation so ``expected_cents``
 * moves above ``received_cents``) is scoped to a single row — the
 * backend auto-flips that payment back to ``unpaid`` on the next
 * recompute, and the drift banner / CTA appears only on that row.
 */
export function BobaPaymentCard({
  drinks,
  momos,
  menu,
  recipientName,
  etransferEmail,
  discountNote,
  variant = "card",
}: Props) {
  const submit = useSubmitBobaPaymentMutation();
  const undo = useUndoBobaPaymentMutation();
  const [emailCopied, setEmailCopied] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Separate from ``pendingKey`` so the "Mark all as sent" button can
  // show its own spinner without every per-row button flickering at
  // once (and vice versa — a single-row submit shouldn't disable the
  // batch button for the rest of the rows).
  const [bulkPending, setBulkPending] = useState(false);

  // Skip cancelled orders entirely. The backend zeroes out
  // ``expected_cents`` on cancel but leaves the payment row in place
  // (with whatever status it had pre-cancel) so that audit history
  // survives — the admin past-payments drawer consumes those rows.
  // Without this filter they leak into the hacker's payment list as
  // ghost "$0.00 CAD · ACTION NEEDED" entries with a live "I sent the
  // e-transfer" button, and tapping that button 409s with
  // ``no_orders_to_pay`` because the self-submit endpoint only
  // accepts payments whose underlying order is ``placed``.
  //
  // ``fulfilled`` orders are kept: they're picked-up food with a
  // legitimate ``confirmed`` / ``refunded`` payment that belongs in
  // the Settled drawer as a receipt.
  const drinkRows: PayableRow[] = drinks
    .filter(
      (d): d is BobaOrder & { payment: BobaPayment } =>
        d.payment != null && d.status !== "cancelled",
    )
    .map((d) => ({
      key: `drink:${d.id}`,
      kind: "drink" as const,
      orderId: d.id,
      title: describeDrinkRow(d, menu),
      payment: d.payment,
      createdAt: new Date(d.created_at).getTime(),
    }));
  const momoRows: PayableRow[] = momos
    .filter(
      (m): m is BobaMomoOrder & { payment: BobaPayment } =>
        m.payment != null && m.status !== "cancelled",
    )
    .map((m) => ({
      key: `momo:${m.id}`,
      kind: "momo" as const,
      orderId: m.id,
      title: describeMomoRow(m, menu),
      payment: m.payment,
      createdAt: new Date(m.created_at).getTime(),
    }));
  const rows: PayableRow[] = [...drinkRows, ...momoRows];

  if (rows.length === 0) return null;

  const groups = groupSubmissions(drinkRows, momoRows);

  const totalExpected = rows.reduce(
    (sum, r) => sum + r.payment.expected_cents,
    0,
  );
  const totalReceived = rows.reduce(
    (sum, r) => sum + (r.payment.received_cents ?? 0),
    0,
  );
  const outstandingCents = Math.max(totalExpected - totalReceived, 0);
  const outstandingDollars = (outstandingCents / 100).toFixed(2);
  const totalExpectedDollars = (totalExpected / 100).toFixed(2);

  // Drift (confirmed but under-received) is a sub-state of ``confirmed``
  // — splitting it into its own bucket keeps the rollup buckets mutually
  // exclusive so they always sum to ``rows.length``. If we double-counted
  // drift rows into both ``confirmed`` and ``drift``, two drifted rows
  // would render as "2 confirmed · 2 with drift", misleading the hacker
  // into thinking two extra payments were fully settled.
  const counts = rows.reduce(
    (acc, r) => {
      if (isDrift(r.payment)) {
        acc.drift += 1;
      } else {
        acc[r.payment.status] += 1;
      }
      return acc;
    },
    { unpaid: 0, submitted: 0, confirmed: 0, refunded: 0, drift: 0 },
  );

  const anyPayable = rows.some(
    (r) =>
      r.payment.status === "unpaid" ||
      r.payment.status === "submitted" ||
      isDrift(r.payment),
  );

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(etransferEmail);
      setEmailCopied(true);
      toast.success("E-transfer email copied");
      window.setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      toast.info(`Copy this email manually: ${etransferEmail}`);
    }
  };

  const onSubmit = async (row: PayableRow) => {
    setPendingKey(row.key);
    try {
      await submit.mutateAsync({ kind: row.kind, order_id: row.orderId });
      toast.success("Marked as sent — admins will confirm shortly.");
    } catch (error) {
      log.error("Boba payment self-submit failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't mark payment as sent.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const onUndo = async (row: PayableRow) => {
    setPendingKey(row.key);
    try {
      await undo.mutateAsync({ kind: row.kind, order_id: row.orderId });
      toast.success("Reverted — you can resend the e-transfer.");
    } catch (error) {
      log.error("Boba payment undo failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't undo the submission.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  /**
   * Fire ``submit`` for every currently-outstanding row in parallel,
   * then summarise the result in a single toast.
   *
   * The natural pattern for a hacker with a pile of unpaid orders is
   * "I'll send one big combined e-transfer covering all of them" —
   * forcing them to tap "I sent the e-transfer" once per row is
   * friction that scales badly (see the screenshot with 8+ rows).
   * This button maps one e-transfer → one click.
   *
   * Uses ``Promise.allSettled`` so a single failure (e.g. a stale
   * cache row that the server now rejects) doesn't swallow the
   * successes — anything that submitted still flips to ``submitted``
   * and the rest stay outstanding for the hacker to retry.
   */
  const onSubmitAll = async (outstanding: readonly PayableRow[]) => {
    if (outstanding.length === 0) return;
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(
        outstanding.map((r) =>
          submit.mutateAsync({ kind: r.kind, order_id: r.orderId }),
        ),
      );
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failed.length === 0) {
        toast.success(
          `Marked ${okCount} order${okCount === 1 ? "" : "s"} as sent — admins will confirm shortly.`,
        );
      } else if (okCount === 0) {
        log.error("Bulk self-submit failed", { errors: failed });
        const first = failed[0]?.reason;
        toast.error(
          first instanceof ApiError
            ? first.message
            : "Couldn't mark payments as sent.",
        );
      } else {
        log.error("Bulk self-submit partial", { errors: failed });
        toast.error(
          `Marked ${okCount} of ${outstanding.length} as sent — ${failed.length} failed. Tap each remaining row to retry.`,
        );
      }
    } finally {
      setBulkPending(false);
    }
  };

  const rollupParts: string[] = [];
  if (counts.unpaid > 0) rollupParts.push(`${counts.unpaid} unpaid`);
  if (counts.submitted > 0) rollupParts.push(`${counts.submitted} submitted`);
  if (counts.confirmed > 0) rollupParts.push(`${counts.confirmed} confirmed`);
  if (counts.refunded > 0) rollupParts.push(`${counts.refunded} refunded`);
  if (counts.drift > 0) rollupParts.push(`${counts.drift} with drift`);

  const header = (
    <CardHeader>
      <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
        <span>Payment</span>
        <span className="text-sm font-medium text-(--bearhacks-muted)">
          ${totalExpectedDollars} across {rows.length} order
          {rows.length === 1 ? "" : "s"}
        </span>
      </CardTitle>
      <CardDescription>
        {rollupParts.length > 0 ? rollupParts.join(" · ") : "All set."}
      </CardDescription>
    </CardHeader>
  );

  // Split rows into the three buckets the UI foregrounds differently:
  //
  //   - ``outstanding``: needs money (unpaid or drift) — top section
  //     with a combined "Mark all N as sent" CTA when the list grows.
  //   - ``waiting``: submitted, waiting on admin confirmation — middle
  //     section, compact, undo-only.
  //   - ``settled``: confirmed (no drift) or refunded — collapsed
  //     inside a ``<details>`` drawer so a hacker with a long payment
  //     history doesn't have to scroll past "Paid · Paid · Paid" to
  //     find the one row that still needs action.
  //
  // Bucketing is row-level, not group-level: a group that straddles
  // buckets (e.g. drink unpaid + momo already confirmed for the same
  // submission) gets split so each row appears where its status
  // belongs. Submission grouping remains visible *within* each bucket
  // — see ``renderBucket`` for the per-row-or-grouped logic.
  const outstandingRows = rows.filter(isOutstandingRow);
  const waitingRows = rows.filter((r) => r.payment.status === "submitted");
  const settledRows = rows.filter(isSettledRow);
  const outstandingGroups = groupsFor(groups, outstandingRows);
  const waitingGroups = groupsFor(groups, waitingRows);
  const settledGroups = groupsFor(groups, settledRows);

  const body = (
    <div className="flex flex-col gap-3">
      {anyPayable ? (
        <>
          <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
              Still to send
            </p>
            <p className="text-2xl font-semibold text-(--bearhacks-fg)">
              ${outstandingDollars}{" "}
              <span className="text-sm font-medium">CAD</span>
            </p>
            <p className="mt-1 text-xs text-(--bearhacks-muted)">
              {discountNote} Send one combined e-transfer, then tap below.
            </p>
          </div>

          <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
              E-transfer to
            </p>
            <p className="text-sm font-semibold text-(--bearhacks-fg)">
              {recipientName}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <code className="min-w-0 max-w-full break-all rounded-(--bearhacks-radius-md) bg-(--bearhacks-surface-alt) px-2 py-1 text-sm text-(--bearhacks-fg) select-all">
                {etransferEmail}
              </code>
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={() => void copyEmail()}
              >
                {emailCopied ? "Copied!" : "Copy email"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-(--bearhacks-muted)">
              Tip: include your name in the e-transfer message so we can match
              it quickly.
            </p>
          </div>

          {/* One-tap "mark everything outstanding as sent" — only */}
          {/* appears when there's more than one row to save, because */}
          {/* a single row already has its own per-row button below. */}
          {outstandingRows.length > 1 ? (
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={bulkPending || submit.isPending}
              onClick={() => void onSubmitAll(outstandingRows)}
            >
              {bulkPending
                ? `Marking ${outstandingRows.length}…`
                : `Mark all ${outstandingRows.length} as sent · $${outstandingDollars}`}
            </Button>
          ) : null}
        </>
      ) : null}

      {outstandingGroups.length > 0 ? (
        <PaymentBucket
          title={
            outstandingGroups.length === rows.length
              ? undefined
              : `Action needed · ${outstandingRows.length}`
          }
          groups={outstandingGroups}
          bucket="outstanding"
          pendingKey={pendingKey}
          bulkPending={bulkPending}
          mutationPending={submit.isPending || undo.isPending}
          onSubmit={onSubmit}
          onUndo={onUndo}
        />
      ) : null}

      {waitingGroups.length > 0 ? (
        <PaymentBucket
          title={`Waiting confirmation · ${waitingRows.length}`}
          groups={waitingGroups}
          bucket="waiting"
          pendingKey={pendingKey}
          bulkPending={bulkPending}
          mutationPending={submit.isPending || undo.isPending}
          onSubmit={onSubmit}
          onUndo={onUndo}
        />
      ) : null}

      {settledGroups.length > 0 ? (
        <details
          // Keep the drawer open by default when there's nothing else
          // in the card (so an all-paid hacker still sees their
          // receipts without an extra click), closed otherwise so
          // "Paid · Paid · Paid" doesn't push the action list down.
          {...(outstandingGroups.length === 0 && waitingGroups.length === 0
            ? { open: true }
            : {})}
          className="rounded-(--bearhacks-radius-md) border border-dashed border-(--bearhacks-border) bg-(--bearhacks-surface-alt)/40"
        >
          <summary className="cursor-pointer list-none select-none px-3 py-2 text-xs font-medium text-(--bearhacks-muted) hover:text-(--bearhacks-fg) [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mr-1.5 inline-block">
              ▸
            </span>
            Settled · {settledRows.length} order{settledRows.length === 1 ? "" : "s"}
          </summary>
          <div className="border-t border-dashed border-(--bearhacks-border) px-3 py-3">
            <PaymentBucket
              groups={settledGroups}
              bucket="settled"
              pendingKey={pendingKey}
              bulkPending={bulkPending}
              mutationPending={submit.isPending || undo.isPending}
              onSubmit={onSubmit}
              onUndo={onUndo}
            />
          </div>
        </details>
      ) : null}
    </div>
  );

  if (variant === "section") {
    return (
      <div className="flex flex-col">
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card className={cardToneClass(rows)}>
      {header}
      {body}
    </Card>
  );
}

/**
 * Pair drink rows with momo rows that came from the same submission.
 *
 * See ``PayableGroup`` for the heuristic rationale. Outline:
 *
 *   1. Walk drinks in order. For each drink, claim the nearest *unused*
 *      momo belonging to the same user and the same meal window whose
 *      ``createdAt`` is within ``SAME_SUBMISSION_EPSILON_MS`` in either
 *      direction.
 *   2. Any drink without a paired momo stands alone.
 *   3. Any momo not claimed by a drink stands alone.
 *
 * Stable per-submission groups are then sorted by their earliest row's
 * ``createdAt`` so the rendered list mirrors placement order regardless
 * of whether a given submission had a drink, a momo, or both.
 *
 * The ``user_id`` gate is defensive: ``/boba/orders/me`` only ever
 * returns the authenticated hacker's own orders, so in practice every
 * row here is same-user. Keeping the explicit check prevents a future
 * refactor (e.g. admin view reusing this card) from silently
 * cross-pairing two hackers' rows that happened to land within 3s of
 * each other in the same window.
 */
function groupSubmissions(
  drinkRows: readonly PayableRow[],
  momoRows: readonly PayableRow[],
): PayableGroup[] {
  const usedMomoKeys = new Set<string>();
  const groups: PayableGroup[] = [];

  for (const drink of drinkRows) {
    let pair: PayableRow | null = null;
    let bestDelta = SAME_SUBMISSION_EPSILON_MS;
    for (const momo of momoRows) {
      if (usedMomoKeys.has(momo.key)) continue;
      if (momo.payment.user_id !== drink.payment.user_id) continue;
      if (momo.payment.meal_window_id !== drink.payment.meal_window_id) continue;
      const delta = Math.abs(momo.createdAt - drink.createdAt);
      if (delta <= bestDelta) {
        pair = momo;
        bestDelta = delta;
      }
    }
    if (pair) {
      usedMomoKeys.add(pair.key);
      groups.push(buildGroup([drink, pair]));
    } else {
      groups.push(buildGroup([drink]));
    }
  }

  for (const momo of momoRows) {
    if (usedMomoKeys.has(momo.key)) continue;
    groups.push(buildGroup([momo]));
  }

  groups.sort((a, b) => a.earliestCreatedAt - b.earliestCreatedAt);
  return groups;
}

function buildGroup(rows: PayableRow[]): PayableGroup {
  const sorted = [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "drink" ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
  return {
    key: sorted.map((r) => r.key).join("|"),
    rows: sorted,
    earliestCreatedAt: Math.min(...sorted.map((r) => r.createdAt)),
    totalExpectedCents: sorted.reduce(
      (sum, r) => sum + r.payment.expected_cents,
      0,
    ),
    totalReceivedCents: sorted.reduce(
      (sum, r) => sum + (r.payment.received_cents ?? 0),
      0,
    ),
  };
}

/**
 * A row is "outstanding" when the hacker still owes money for it —
 * either never sent, or confirmed-with-drift so they owe the diff.
 */
function isOutstandingRow(row: PayableRow): boolean {
  return row.payment.status === "unpaid" || isDrift(row.payment);
}

/**
 * A row is "settled" when it requires no further action from either
 * side — confirmed (no drift) or refunded. Everything else (unpaid,
 * submitted, drifted-confirmed) stays visible; settled rows collapse
 * into a ``<details>`` drawer so the list foregrounds the work.
 */
function isSettledRow(row: PayableRow): boolean {
  if (row.payment.status === "refunded") return true;
  if (row.payment.status === "confirmed" && !isDrift(row.payment)) return true;
  return false;
}

/**
 * True when a payment is ``confirmed`` but the underlying order has
 * since grown (``expected_cents > received_cents``). The backend
 * normally flips the row back to ``unpaid`` on the next recompute, but
 * stale cache reads can still surface this transition — we treat it as
 * drift so the UI asks for the diff instead of lying about being paid.
 */
function isDrift(payment: BobaPayment): boolean {
  const received = payment.received_cents ?? 0;
  return payment.status === "confirmed" && payment.expected_cents > received;
}

function cardToneClass(rows: PayableRow[]): string {
  const anyDrift = rows.some((r) => isDrift(r.payment));
  const anyUnpaid = rows.some((r) => r.payment.status === "unpaid");
  const anySubmitted = rows.some((r) => r.payment.status === "submitted");
  const allConfirmed = rows.every((r) => r.payment.status === "confirmed");
  if (anyDrift || anyUnpaid) {
    return "border-(--bearhacks-accent) ring-2 ring-(--bearhacks-accent)/40";
  }
  if (anySubmitted) {
    return "border-(--bearhacks-warning-border) ring-1 ring-(--bearhacks-warning-border)/60";
  }
  if (allConfirmed) {
    return "border-(--bearhacks-success-border) ring-1 ring-(--bearhacks-success-border)/60";
  }
  return "border-(--bearhacks-border) opacity-90";
}

/**
 * Re-project a flat list of rows back onto the original submission
 * groups, dropping groups whose rows all fall outside the filter.
 *
 * Buckets (outstanding / waiting / settled) are row-level so a group
 * that straddles states (e.g. drink unpaid + momo submitted) only
 * contributes its relevant rows to each bucket. That keeps submission
 * visual pairing intact within a bucket without needing to duplicate
 * group metadata at the caller.
 */
function groupsFor(
  allGroups: readonly PayableGroup[],
  keepRows: readonly PayableRow[],
): PayableGroup[] {
  const keepKeys = new Set(keepRows.map((r) => r.key));
  const filtered: PayableGroup[] = [];
  for (const g of allGroups) {
    const rows = g.rows.filter((r) => keepKeys.has(r.key));
    if (rows.length === 0) continue;
    filtered.push(buildGroup(rows));
  }
  return filtered;
}

type BucketKind = "outstanding" | "waiting" | "settled";

/**
 * Renders one status bucket as a compact list of submission groups.
 * Shared between "Action needed", "Waiting confirmation", and
 * "Settled" — the per-row action UI varies by ``bucket`` but the
 * grouping + typography stay identical so the three sections read
 * as one progressive story.
 */
function PaymentBucket({
  title,
  groups,
  bucket,
  pendingKey,
  bulkPending,
  mutationPending,
  onSubmit,
  onUndo,
}: {
  title?: string;
  groups: readonly PayableGroup[];
  bucket: BucketKind;
  pendingKey: string | null;
  bulkPending: boolean;
  mutationPending: boolean;
  onSubmit: (row: PayableRow) => Promise<void>;
  onUndo: (row: PayableRow) => Promise<void>;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--bearhacks-muted)">
          {title}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <PaymentGroupRow
            key={group.key}
            group={group}
            bucket={bucket}
            pendingKey={pendingKey}
            bulkPending={bulkPending}
            mutationPending={mutationPending}
            onSubmit={onSubmit}
            onUndo={onUndo}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One submission's worth of rows in a compact card.
 *
 * Layout contract (see screenshot in the request this rewrite
 * addresses — a long stack of "Brown Sugar Milk Tea · Medium /
 * ACTION NEEDED / [I sent the e-transfer]" blocks that took up
 * ~120px each):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Brown Sugar Milk Tea · Medium            $4.75  [pill]   │
 *   │ + 5 Vegetable momos                                       │
 *   │                                          [I sent →]      │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Key differences from the old per-row card:
 *   - ~50% less vertical space (px-3 py-2, inline status pill,
 *     smaller CTA)
 *   - Groups drink + momo placed together into a single row with
 *     one combined "$TOTAL" amount and (when both are outstanding)
 *     a single "I sent" button that submits both at once.
 *   - Mixed-state groups (e.g. drink unpaid + momo submitted) fall
 *     back to per-row actions so the hacker can act on each half
 *     independently.
 */
function PaymentGroupRow({
  group,
  bucket,
  pendingKey,
  bulkPending,
  mutationPending,
  onSubmit,
  onUndo,
}: {
  group: PayableGroup;
  bucket: BucketKind;
  pendingKey: string | null;
  bulkPending: boolean;
  mutationPending: boolean;
  onSubmit: (row: PayableRow) => Promise<void>;
  onUndo: (row: PayableRow) => Promise<void>;
}) {
  const totalExpected = (group.totalExpectedCents / 100).toFixed(2);
  const outstandingCents = Math.max(
    group.totalExpectedCents - group.totalReceivedCents,
    0,
  );
  const outstandingDollars = (outstandingCents / 100).toFixed(2);

  // If every row in the group is outstanding AND the group has more
  // than one row, the whole thing gets one combined CTA. Same rule
  // for "all submitted" → one "Undo all" button. Any mix falls back
  // to per-row controls inside the group's stack.
  const allOutstanding = group.rows.every(isOutstandingRow);
  const allSubmitted = group.rows.every(
    (r) => r.payment.status === "submitted",
  );
  const combined = group.rows.length > 1 && (allOutstanding || allSubmitted);

  const pendingThisGroup =
    pendingKey !== null && group.rows.some((r) => r.key === pendingKey);

  return (
    <li
      className={`flex flex-col gap-2 rounded-(--bearhacks-radius-md) border px-3 py-2 ${groupToneClass(group.rows, bucket)}`}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {group.rows.map((row, idx) => (
            <p
              key={row.key}
              className={`text-sm ${idx === 0 ? "font-semibold text-(--bearhacks-fg)" : "text-(--bearhacks-fg)"} wrap-break-word`}
            >
              {idx > 0 ? (
                <span
                  aria-hidden
                  className="mr-1 text-(--bearhacks-muted)"
                >
                  +
                </span>
              ) : null}
              {row.title}
            </p>
          ))}
          <p className="text-xs text-(--bearhacks-muted)">
            ${totalExpected} CAD
            {group.rows.length > 1 ? (
              <span className="ml-1 text-[11px] uppercase tracking-[0.06em]">
                · same order
              </span>
            ) : null}
          </p>
        </div>
        {!combined ? (
          // Non-combined groups still show a status pill up top — but
          // when the row count is 1, the pill reflects that one row,
          // and when mixed we show the most-urgent row's pill so the
          // scan-level state matches what demands the hacker's
          // attention first.
          <PaymentStatusPill
            payment={pickLeadRow(group.rows).payment}
            drift={isDrift(pickLeadRow(group.rows).payment)}
          />
        ) : (
          <PaymentStatusPill
            payment={pickLeadRow(group.rows).payment}
            drift={group.rows.some((r) => isDrift(r.payment))}
          />
        )}
      </div>

      {combined ? (
        // Single CTA for the whole group (drink + momo at once).
        allOutstanding ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-(--bearhacks-muted)">
              Send ${outstandingDollars} for this order
            </span>
            <Button
              type="button"
              variant="primary"
              className="w-full sm:w-auto"
              disabled={pendingThisGroup || bulkPending}
              onClick={() => {
                void (async () => {
                  for (const row of group.rows) {
                    if (isOutstandingRow(row)) {
                      // Fire sequentially keyed so the ``pendingKey``
                      // state meaningfully advances — the combined
                      // button doesn't need Promise.all here since
                      // it's just 1-2 mutations.
                      await onSubmit(row);
                    }
                  }
                })();
              }}
            >
              {pendingThisGroup ? "Marking…" : "I sent the e-transfer"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-(--bearhacks-muted)">
              Both marked as sent — waiting on the food team.
            </span>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={pendingThisGroup || mutationPending}
              onClick={() => {
                void (async () => {
                  for (const row of group.rows) {
                    await onUndo(row);
                  }
                })();
              }}
            >
              {pendingThisGroup ? "Marking…" : "Mark unsent"}
            </Button>
          </div>
        )
      ) : (
        // Split: render per-row action UI stacked below the title
        // block. Mostly used for the single-row-per-group case; the
        // mixed-bucket case is rare (drink and momo from same
        // submission in different states).
        <div className="flex flex-col gap-1.5">
          {group.rows.map((row) => (
            <PaymentInlineAction
              key={row.key}
              row={row}
              pending={
                pendingKey === row.key && (mutationPending || bulkPending)
              }
              onSubmit={() => void onSubmit(row)}
              onUndo={() => void onUndo(row)}
            />
          ))}
        </div>
      )}

      {group.rows.some((r) => isDrift(r.payment)) ? (
        <DriftNotice group={group} />
      ) : null}

      {bucket === "settled"
        ? group.rows.map((row) =>
            row.payment.status === "refunded" ? (
              <p
                key={`${row.key}-refunded`}
                className="text-xs text-(--bearhacks-muted)"
              >
                Refunded. If this looks wrong, open a ticket in
                #support-tickets on Discord.
              </p>
            ) : null,
          )
        : null}
    </li>
  );
}

/**
 * Per-row action UI used inside mixed-bucket groups and single-row
 * groups. Compact variant of the old ``PaymentRow`` action block.
 */
function PaymentInlineAction({
  row,
  pending,
  onSubmit,
  onUndo,
}: {
  row: PayableRow;
  pending: boolean;
  onSubmit: () => void;
  onUndo: () => void;
}) {
  const { payment } = row;
  const received = payment.received_cents ?? 0;
  const receivedDollars = (received / 100).toFixed(2);

  if (payment.status === "unpaid") {
    return (
      <Button
        type="button"
        variant="primary"
        className="w-full sm:w-auto sm:self-end"
        disabled={pending}
        onClick={onSubmit}
      >
        {pending ? "Marking…" : "I sent the e-transfer"}
      </Button>
    );
  }

  if (payment.status === "submitted") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-(--bearhacks-muted)">
          {payment.reference
            ? `Ref: ${payment.reference}`
            : "Waiting on the food team."}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={onUndo}
        >
          {pending ? "Undoing…" : "Undo"}
        </Button>
      </div>
    );
  }

  if (payment.status === "confirmed" && !isDrift(payment)) {
    return (
      <p className="text-xs text-(--bearhacks-fg)">
        Confirmed{received > 0 ? ` — $${receivedDollars} received.` : "."}
      </p>
    );
  }

  // Drift / refunded are handled at the group level (drift notice +
  // refunded footer) so this branch is the trailing "no-op" state.
  return null;
}

/**
 * Pick the row in a group whose status best represents the group's
 * overall urgency so the collapsed status pill reads accurately:
 *
 *   drift > unpaid > submitted > refunded > confirmed
 *
 * Keeps the top-level pill honest for mixed-state groups without
 * having to invent a synthetic "partial" state.
 */
function pickLeadRow(rows: readonly PayableRow[]): PayableRow {
  const rank = (r: PayableRow): number => {
    if (isDrift(r.payment)) return 0;
    switch (r.payment.status) {
      case "unpaid":
        return 1;
      case "submitted":
        return 2;
      case "refunded":
        return 3;
      case "confirmed":
        return 4;
    }
  };
  return [...rows].sort((a, b) => rank(a) - rank(b))[0]!;
}

/**
 * Border tint for a submission group row. Matches the overall card
 * tone logic in ``cardToneClass`` but scoped to the group's own rows
 * so a single outstanding group glows even when siblings are settled.
 */
function groupToneClass(rows: readonly PayableRow[], bucket: BucketKind): string {
  if (bucket === "settled") {
    return "border-(--bearhacks-border) bg-(--bearhacks-surface) opacity-90";
  }
  const anyDrift = rows.some((r) => isDrift(r.payment));
  const anyUnpaid = rows.some((r) => r.payment.status === "unpaid");
  if (anyDrift || anyUnpaid) {
    return "border-(--bearhacks-accent) bg-(--bearhacks-surface)";
  }
  if (rows.some((r) => r.payment.status === "submitted")) {
    return "border-(--bearhacks-warning-border) bg-(--bearhacks-surface)";
  }
  return "border-(--bearhacks-border) bg-(--bearhacks-surface)";
}

/**
 * Drift warning for a group — collapses multiple drifted rows into
 * one shared banner rather than repeating the same paragraph per row.
 */
function DriftNotice({ group }: { group: PayableGroup }) {
  const drifted = group.rows.filter((r) => isDrift(r.payment));
  const totalExpected = drifted.reduce(
    (sum, r) => sum + r.payment.expected_cents,
    0,
  );
  const totalReceived = drifted.reduce(
    (sum, r) => sum + (r.payment.received_cents ?? 0),
    0,
  );
  const diffDollars = ((totalExpected - totalReceived) / 100).toFixed(2);
  return (
    <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) px-3 py-2 text-xs text-(--bearhacks-warning-fg)">
      Edited after confirmation — send the ${diffDollars} difference and ping
      the food team.
    </div>
  );
}

function PaymentStatusPill({
  payment,
  drift,
}: {
  payment: BobaPayment;
  drift: boolean;
}) {
  const map: Record<BobaPayment["status"], { label: string; cls: string }> = {
    unpaid: {
      label: "Action needed",
      cls: "bg-(--bearhacks-accent) text-(--bearhacks-primary)",
    },
    submitted: {
      label: "Waiting confirmation",
      cls: "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)",
    },
    confirmed: {
      label: "Paid",
      cls: "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)",
    },
    refunded: {
      label: "Refunded",
      cls: "bg-(--bearhacks-surface-alt) text-(--bearhacks-muted) border border-(--bearhacks-border)",
    },
  };
  const resolved = drift
    ? {
        label: "Additional due",
        cls: "bg-(--bearhacks-accent) text-(--bearhacks-primary)",
      }
    : map[payment.status];
  return (
    <span
      className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${resolved.cls}`}
    >
      {resolved.label}
    </span>
  );
}

function describeDrinkRow(
  drink: BobaOrder,
  menu: BobaMenuResponse | null,
): string {
  if (!menu) return `Drink · ${drink.size}`;
  const name =
    menu.drinks.find((d) => d.id === drink.drink_id)?.label ?? drink.drink_id;
  const size = menu.sizes.find((s) => s.id === drink.size)?.label ?? drink.size;
  return `${name} · ${size}`;
}

function describeMomoRow(
  momo: BobaMomoOrder,
  menu: BobaMenuResponse | null,
): string {
  if (!menu) return `Momos · ${momo.filling}`;
  const filling =
    menu.momos.fillings.find((f) => f.id === momo.filling)?.label ??
    momo.filling;
  return `Momos · ${filling}`;
}
