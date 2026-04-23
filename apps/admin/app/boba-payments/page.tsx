"use client";

/**
 * Super-admin payment console for boba/momo orders.
 *
 * One row per (hacker × meal window) payment bundle, joining placed
 * drinks/momos for itemized totals. Admins can:
 *   - Confirm a payment (defaults received_cents to expected_cents).
 *   - Refund a payment (frees the hacker to re-pay or stop).
 *   - Unconfirm a payment (back to submitted, e.g. e-transfer bounced).
 *
 * Auto-refreshes every 30s so the food team sees inbound submissions
 * without reloading.
 */

import { ApiError } from "@bearhacks/api-client";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  useAdminPaymentsQuery,
  useAdminWindowsQuery,
  useConfirmPaymentMutation,
  useRefundPaymentMutation,
  useUnconfirmPaymentMutation,
  useUnrefundPaymentMutation,
  type AdminPaymentRow,
  type WindowsResponse,
} from "@/lib/boba-queries";
import { useDocumentTitle } from "@/lib/use-document-title";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";
import { createStructuredLogger } from "@/lib/structured-logging";

const log = createStructuredLogger("admin/boba-payments");

const STATUS_VALUES = ["unpaid", "submitted", "confirmed", "refunded"] as const;
type PaymentStatus = (typeof STATUS_VALUES)[number];

const STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  submitted: "Submitted",
  confirmed: "Confirmed",
  refunded: "Refunded",
};

const STATUS_BADGE_CLASSES: Record<PaymentStatus, string> = {
  unpaid:
    "bg-(--bearhacks-surface-alt) text-(--bearhacks-muted) border border-(--bearhacks-border)",
  submitted:
    "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)",
  confirmed:
    "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)",
  refunded:
    "bg-(--bearhacks-surface-alt) text-(--bearhacks-muted) border border-(--bearhacks-border)",
};

// Kind-pill classes mirror the "All orders" table in /boba-orders so the two
// admin consoles read like one product. Drinks use the cream/accent pill,
// momos reuse the warning triad (amber). Intentionally kept in sync by eye
// rather than abstracted — the two call sites are tiny and the design tokens
// are the shared contract.
const KIND_PILL_CLASSES: Record<"drink" | "momo", string> = {
  drink:
    "bg-(--bearhacks-accent-soft) text-(--bearhacks-primary) border border-(--bearhacks-border)",
  momo: "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)",
};

/**
 * Table-scale action-button overrides. Every payment action in this file uses
 * `variant="pill"` so the column reads as a single visual family (the user
 * asked to stop mixing pill + rounded-box here). `px-4 py-2 text-xs` shrinks
 * the big landing-CTA pill into something that fits a ~200px cell alongside
 * a second button. Each tint maps to the action's outcome token trio:
 *
 *   - Confirm  → success (green-ish)
 *   - Refund   → danger  (red-ish)
 *   - Undo     → warning (amber)   reversing a terminal state is cautionary
 *
 * The `!` suffix forces our tint/padding to win against the pill variant's
 * defaults — Tailwind v4 orders utilities deterministically in the compiled
 * stylesheet, so className string order is not enough on its own.
 */
const ACTION_BUTTON_BASE = "px-4! py-2! text-xs! border shadow-none!";

const ACTION_BUTTON_CONFIRM =
  `${ACTION_BUTTON_BASE} bg-(--bearhacks-success-bg)! text-(--bearhacks-success-fg)! border-(--bearhacks-success-border) hover:bg-(--bearhacks-success-border)! disabled:hover:bg-(--bearhacks-success-bg)!`;

const ACTION_BUTTON_REFUND =
  `${ACTION_BUTTON_BASE} bg-(--bearhacks-danger-soft)! text-(--bearhacks-danger)! border-(--bearhacks-danger-border) hover:bg-(--bearhacks-danger-border)! disabled:hover:bg-(--bearhacks-danger-soft)!`;

const ACTION_BUTTON_UNDO =
  `${ACTION_BUTTON_BASE} bg-(--bearhacks-warning-bg)! text-(--bearhacks-warning-fg)! border-(--bearhacks-warning-border) hover:bg-(--bearhacks-warning-border)! disabled:hover:bg-(--bearhacks-warning-bg)!`;

// Shared checkbox styling for the select column + the mobile list's
// per-card checkbox. Matches the form controls elsewhere in the admin
// app: 18px square, accent-tinted, with a visible focus ring for
// keyboard admins. Kept outside the component so both renderers
// reference the same source of truth.
const CHECKBOX_CLASSES =
  "h-[18px] w-[18px] shrink-0 cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border-strong) accent-(--bearhacks-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--bearhacks-focus-ring)";

/**
 * Tiny inline status chip used when the underlying drink/momo is no
 * longer in ``placed`` (cancelled or already picked up). Payment rows
 * themselves carry a separate ``status`` pill (unpaid / submitted /
 * confirmed / refunded); this badge is item-state context so admins
 * can spot a "confirmed payment for a cancelled order -> owe a refund"
 * situation at a glance.
 */
function ItemStatusBadge({ status }: { status: AdminPaymentRow["item_status"] }) {
  if (status === "placed") return null;
  const cls =
    status === "cancelled"
      ? "bg-(--bearhacks-danger-soft) text-(--bearhacks-danger) border border-(--bearhacks-danger-border)"
      : "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)";
  const label = status === "cancelled" ? "Cancelled" : "Picked up";
  return (
    <span
      className={`mr-1.5 inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[0.04em] align-middle ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * Single-order cell for the "Item" column.
 *
 * Post per-order migration, each payment row covers exactly one drink or
 * momo. We render the same [Kind pill] [size] detail layout the old
 * multi-item cell used, but without the live/past split or the
 * collapsible drawer — those only made sense for aggregated bundles.
 * A cancelled underlying order still shows here (admin may need to
 * refund) with the detail text struck through and a status chip so it
 * reads as "payment for X that got cancelled" rather than a live pickup.
 */
function PaymentItemCell({
  row,
  isPaired = false,
}: {
  row: AdminPaymentRow;
  /**
   * ``true`` when this row has a matched sibling in the visible
   * page — admin should know that confirming / refunding / undoing
   * this row will also act on the paired drink/momo from the same
   * submission. Keeps the batching behaviour discoverable instead
   * of having the dialog copy be the only hint.
   */
  isPaired?: boolean;
}) {
  const isPlaced = row.item_status === "placed";
  const label = row.kind === "drink" ? "Drink" : "Momos";
  const dimmed = isPlaced ? "" : "opacity-70";
  return (
    <div
      className={`flex min-w-[16rem] items-start gap-2 ${dimmed}`}
    >
      <span
        className={`inline-flex shrink-0 items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-[11px] font-semibold ${KIND_PILL_CLASSES[row.kind]}`}
      >
        {label}
      </span>
      {row.item_size ? (
        <span className="shrink-0 text-xs text-(--bearhacks-muted)">
          {row.item_size}
        </span>
      ) : null}
      <span className="min-w-0 text-xs wrap-break-word">
        {!isPlaced ? <ItemStatusBadge status={row.item_status} /> : null}
        <span
          className={
            isPlaced
              ? "text-(--bearhacks-fg)"
              : "text-(--bearhacks-muted) line-through"
          }
        >
          {row.item_detail}
        </span>
        {isPaired ? (
          <span
            className="ml-1 inline-flex items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-surface-muted) px-1.5 py-0.5 text-[10px] font-medium text-(--bearhacks-muted)"
            title="Placed together with a matched drink/momo from the same submission. Confirm/refund/undo will act on both."
          >
            Paired
          </span>
        ) : null}
      </span>
    </div>
  );
}

type FilterValues = {
  meal_window_id?: string;
  /** Multi-select. Empty set means "all statuses". */
  statuses: ReadonlySet<PaymentStatus>;
};

const DEFAULT_FILTER: FilterValues = {
  meal_window_id: undefined,
  statuses: new Set<PaymentStatus>(),
};

/**
 * Page size for server-side pagination. Matches the super-admin profile
 * directory so the two admin consoles read as one product.
 */
const PAGE_SIZE = 25;

export default function AdminBobaPaymentsPage() {
  const supabase = useSupabase();
  const confirm = useConfirm();
  useDocumentTitle("Boba & Momo payments");

  const [user, setUser] = useState<User | null>(null);
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER);
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);

  // Stable array for the query key + URLSearchParams. Sets have identity
  // equality, but a sorted array is structurally comparable.
  const selectedStatusesKey = useMemo(
    () => [...filters.statuses].sort() as PaymentStatus[],
    [filters.statuses],
  );

  // Debounced live search mirroring the profile directory: 250ms of
  // keyboard quiet promotes `draftSearch` to `appliedSearch` (which keys
  // the query). Pressing Enter or clicking Apply bypasses the delay by
  // setting both synchronously in the form's `onSubmit`. The async
  // `setState` inside the timer sidesteps React 19's
  // `react-hooks/set-state-in-effect` rule.
  useEffect(() => {
    if (draftSearch === appliedSearch) return;
    const timer = window.setTimeout(() => {
      setAppliedSearch(draftSearch);
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftSearch, appliedSearch]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isSuper = isSuperAdminUser(user);
  const staff = isStaffUser(user);
  const actor = user?.id ?? "anonymous";

  const windowsQuery = useAdminWindowsQuery(isSuper);

  const fallbackWindowId =
    windowsQuery.data?.active_window_id ??
    windowsQuery.data?.next_upcoming_window_id ??
    windowsQuery.data?.windows[0]?.id;
  const focusedWindowId = filters.meal_window_id ?? fallbackWindowId;

  const paymentsQuery = useAdminPaymentsQuery(
    {
      meal_window_id: focusedWindowId,
      statuses: selectedStatusesKey,
      search: appliedSearch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    isSuper,
  );

  // Snap `page` back to the last valid index whenever the server's
  // `total` drops below the current offset. This happens naturally on
  // the 30s background refetch: a hacker's status flips, a bundle
  // gets filtered out, and the page the admin is parked on falls off
  // the end of the result set. Without this, the offset stays stale
  // forever (the next refetch still asks for a page that doesn't
  // exist) and the card description reads nonsense like
  // "Showing 51–40 of 40" until the admin touches a filter.
  //
  // Uses the prev-tracker pattern so the conditional setState happens
  // during render (only on transitions in `total`) instead of in a
  // useEffect, sidestepping React 19's `set-state-in-effect` rule —
  // same trick we use for the portal deep-link and the directory
  // page resets.
  const paymentsTotal = paymentsQuery.data?.total ?? 0;
  const [prevPaymentsTotal, setPrevPaymentsTotal] = useState(paymentsTotal);
  if (paymentsTotal !== prevPaymentsTotal) {
    setPrevPaymentsTotal(paymentsTotal);
    const lastValidPage =
      paymentsTotal > 0 ? Math.ceil(paymentsTotal / PAGE_SIZE) - 1 : 0;
    if (page > lastValidPage) setPage(lastValidPage);
  }

  const confirmMutation = useConfirmPaymentMutation();
  const refundMutation = useRefundPaymentMutation();
  const unconfirmMutation = useUnconfirmPaymentMutation();
  const unrefundMutation = useUnrefundPaymentMutation();

  // ---------------------------------------------------------------------------
  // Batch selection
  //
  // Selection is deliberately *per-page*: the ids in `selected` are only
  // valid for the rows currently visible. When the admin flips pages,
  // toggles a status chip, changes the meal window, or applies a new
  // search, we clear the set so the next batch action can't target
  // rows the admin isn't looking at. A single derived `scopeKey`
  // captures every input that would change which slice the server
  // returns; the prev-tracker pattern pipes that through a
  // render-phase reset without tripping React 19's
  // set-state-in-effect rule (same trick as the total-shrink
  // snap-back just above).
  // ---------------------------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectionScopeKey = `${focusedWindowId ?? ""}|${selectedStatusesKey.join(",")}|${appliedSearch}|${page}`;
  const [prevSelectionScope, setPrevSelectionScope] =
    useState(selectionScopeKey);
  if (selectionScopeKey !== prevSelectionScope) {
    setPrevSelectionScope(selectionScopeKey);
    if (selected.size > 0) setSelected(new Set());
  }

  const currentRows = paymentsQuery.data?.payments ?? [];
  // Only ``placed`` rows are eligible for batch operations. The child
  // table already hides non-placed rows from the selectable surface
  // (they render in a read-only past-payments drawer) and its
  // ``selectedVisible`` counter filters against ``liveData``, but the
  // selection ``Set<string>`` persists across the 30s auto-refetch by
  // design — losing an admin's selection on every refresh would be
  // miserable. That persistence creates a narrow race: a row that was
  // ``placed`` when the admin checked it can transition to
  // ``cancelled``/``fulfilled`` before the admin hits "Confirm all",
  // and the fresh server response brings it back as a past row. The
  // row id is still in ``selected``, so without this filter every
  // batch handler's ``eligible`` set would include it, the
  // confirmation dialog would show an inflated count/total, and the
  // mutation would fire against an order whose food never existed —
  // exactly the scenario the past-payments drawer exists to prevent.
  //
  // Filtering at the ``selectedRows`` derivation point (instead of in
  // each handler) means every current and future batch handler
  // inherits the guard automatically.
  const selectedRows = currentRows.filter(
    (r) => selected.has(r.id) && r.item_status === "placed",
  );

  // ---------------------------------------------------------------------------
  // Submission pair detection.
  //
  // The per-order payment backend stores one row per drink and one
  // row per momo — no explicit "cart id" links a drink + momo that
  // were placed in the same ``POST /boba/orders/me`` submission. The
  // hacker-facing UI already bundles these visually using a
  // ``user_id`` + ``meal_window_id`` + ±3s ``created_at`` heuristic
  // (see ``PayableGroup`` in ``apps/me/components/boba-payment-card``)
  // so a hacker who ordered a drink + 5 momos together sees one row
  // with a single "I sent the e-transfer" button that marks both
  // halves submitted at once.
  //
  // The admin table has to honour the same bundling, otherwise
  // confirming one half of a pair silently leaves the other half
  // stuck in ``submitted``, the hacker gets a half-confirmed UI, and
  // the food team scrolls past the orphaned sibling at pickup time.
  //
  // This helper returns the matched sibling from ``currentRows`` —
  // i.e. the same visible page. When a pair straddles pages the
  // per-row action falls back to acting on just the clicked row, and
  // the admin can flip to the next page to finish the pair (same UX
  // as today). Cross-page pair detection would need server support;
  // the 95% case is both halves sit on the same page because they
  // share ``updated_at`` and the table's default sort groups them.
  //
  // The ``PAIR_ACTION_STATUSES`` map gates which status the sibling
  // must be in for each action — matching a sibling whose payment
  // status can't accept the action would just 409, so we filter
  // those out up front. ``item_status === "placed"`` is always
  // required because we never want to operate on cancelled / picked-
  // up food, matching the ``selectedRows`` guard above.
  const PAIR_EPSILON_MS = 3000;
  const PAIR_ACTION_STATUSES: Record<
    "confirm" | "refund" | "unconfirm",
    ReadonlyArray<AdminPaymentRow["status"]>
  > = {
    confirm: ["unpaid", "submitted"],
    refund: ["submitted", "confirmed"],
    unconfirm: ["confirmed"],
  };
  const findMatchedSibling = (
    row: AdminPaymentRow,
    action: "confirm" | "refund" | "unconfirm",
  ): AdminPaymentRow | null => {
    if (row.item_status !== "placed") return null;
    const rowCreatedAt = new Date(row.created_at).getTime();
    const wantKind: AdminPaymentRow["kind"] =
      row.kind === "drink" ? "momo" : "drink";
    const allowedStatuses = PAIR_ACTION_STATUSES[action];
    for (const cand of currentRows) {
      if (cand.id === row.id) continue;
      if (cand.kind !== wantKind) continue;
      if (cand.user_id !== row.user_id) continue;
      if (cand.meal_window_id !== row.meal_window_id) continue;
      if (cand.item_status !== "placed") continue;
      if (!allowedStatuses.includes(cand.status)) continue;
      const delta = Math.abs(
        new Date(cand.created_at).getTime() - rowCreatedAt,
      );
      if (delta <= PAIR_EPSILON_MS) return cand;
    }
    return null;
  };

  /**
   * Run a mutation against a row and (optionally) its matched
   * sibling, then emit a single summary toast. Uses
   * ``Promise.allSettled`` so one half's failure doesn't mask the
   * other half's success — admin gets a truthful count either way.
   */
  const runPairAction = async ({
    rows,
    mutateAsync,
    event,
    successSingular,
    successPlural,
    failVerb,
  }: {
    rows: AdminPaymentRow[];
    mutateAsync: (row: AdminPaymentRow) => Promise<unknown>;
    event: string;
    successSingular: string;
    successPlural: string;
    failVerb: string;
  }) => {
    const results = await Promise.allSettled(rows.map((r) => mutateAsync(r)));
    let ok = 0;
    results.forEach((res, i) => {
      const row = rows[i]!;
      const succeeded = res.status === "fulfilled";
      if (succeeded) ok += 1;
      log(succeeded ? "info" : "error", {
        event,
        actor,
        resourceId: row.id,
        result: succeeded ? "success" : "error",
        ...(res.status === "rejected" ? { error: res.reason } : {}),
      });
    });
    const failed = rows.length - ok;
    if (failed === 0) {
      toast.success(rows.length === 1 ? successSingular : successPlural);
    } else if (ok === 0) {
      const first = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      )?.reason;
      toast.error(
        first instanceof ApiError
          ? first.message
          : `Failed to ${failVerb} payment${rows.length === 1 ? "" : "s"}.`,
      );
    } else {
      toast.error(
        `${successPlural.replace(".", "")} — ${failed} failed. Refresh and retry.`,
      );
    }
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (select) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  /**
   * Shared runner for every batch mutation.
   *
   * Fires all mutations in parallel via ``Promise.allSettled`` so one
   * hacker's 500 doesn't block the rest — each row's log line +
   * fulfilled/rejected count is surfaced in a single summary toast at
   * the end. The selection is cleared regardless of partial failure;
   * the 30s auto-refetch plus the per-mutation ``invalidateQueries``
   * will repopulate the table with the fresh statuses, so the admin
   * can re-select only the rows that actually failed if they want to
   * retry.
   */
  async function runBatch({
    rows,
    mutateAsync,
    event,
    verbPast,
    verbAttempt,
  }: {
    rows: AdminPaymentRow[];
    mutateAsync: (row: AdminPaymentRow) => Promise<unknown>;
    event: string;
    verbPast: string;
    verbAttempt: string;
  }) {
    if (rows.length === 0) return;
    const results = await Promise.allSettled(rows.map((r) => mutateAsync(r)));
    let ok = 0;
    results.forEach((r, i) => {
      const row = rows[i]!;
      const succeeded = r.status === "fulfilled";
      if (succeeded) ok += 1;
      log(succeeded ? "info" : "error", {
        event,
        actor,
        resourceId: row.id,
        result: succeeded ? "success" : "error",
        ...(r.status === "rejected" ? { error: r.reason } : {}),
      });
    });
    const failed = rows.length - ok;
    const pluralize = (n: number, s: string) =>
      `${n} ${s}${n === 1 ? "" : "s"}`;
    if (failed === 0) {
      toast.success(`${verbPast} ${pluralize(ok, "payment")}.`);
    } else if (ok === 0) {
      toast.error(
        `Failed to ${verbAttempt} ${pluralize(failed, "payment")}.`,
      );
    } else {
      toast.error(
        `${verbPast} ${pluralize(ok, "payment")} — ${failed} failed.`,
      );
    }
    clearSelection();
  }

  async function onBatchConfirm() {
    const eligible = selectedRows.filter(
      (r) => r.status === "unpaid" || r.status === "submitted",
    );
    if (eligible.length === 0) return;
    const total = eligible.reduce((sum, r) => sum + r.expected_cents, 0);
    const ok = await confirm({
      title: `Confirm ${eligible.length === 1 ? "1 payment" : `${eligible.length} payments`} totaling $${(total / 100).toFixed(2)}?`,
      description:
        "Marks each order paid in full (received_cents = expected_cents). Selected rows that aren't Unpaid or Submitted are skipped.",
      confirmLabel: "Confirm all",
    });
    if (!ok) return;
    await runBatch({
      rows: eligible,
      mutateAsync: (r) => confirmMutation.mutateAsync({ paymentId: r.id }),
      event: "admin_boba_payment_confirm",
      verbPast: "Confirmed",
      verbAttempt: "confirm",
    });
  }

  async function onBatchRefund() {
    const eligible = selectedRows.filter(
      (r) => r.status === "unpaid" || r.status === "submitted",
    );
    if (eligible.length === 0) return;
    const total = eligible.reduce((sum, r) => sum + r.expected_cents, 0);
    const ok = await confirm({
      title: `Refund ${eligible.length === 1 ? "1 payment" : `${eligible.length} payments`} totaling $${(total / 100).toFixed(2)}?`,
      description:
        "Marks each order refunded. Hackers can re-submit to pay again. Selected rows that aren't Unpaid or Submitted are skipped.",
      confirmLabel: "Refund all",
      tone: "danger",
    });
    if (!ok) return;
    await runBatch({
      rows: eligible,
      mutateAsync: (r) => refundMutation.mutateAsync({ paymentId: r.id }),
      event: "admin_boba_payment_refund",
      verbPast: "Refunded",
      verbAttempt: "refund",
    });
  }

  async function onBatchUnconfirm() {
    const eligible = selectedRows.filter((r) => r.status === "confirmed");
    if (eligible.length === 0) return;
    const ok = await confirm({
      title: `Undo confirmation on ${eligible.length === 1 ? "1 payment" : `${eligible.length} payments`}?`,
      description:
        "Reverts each order to Submitted. Use this if the e-transfers bounced or were confirmed by mistake. Selected rows that aren't Confirmed are skipped.",
      confirmLabel: "Undo confirmations",
      tone: "danger",
    });
    if (!ok) return;
    await runBatch({
      rows: eligible,
      mutateAsync: (r) => unconfirmMutation.mutateAsync({ paymentId: r.id }),
      event: "admin_boba_payment_unconfirm",
      verbPast: "Reverted",
      verbAttempt: "revert confirmation on",
    });
  }

  async function onBatchUnrefund() {
    const eligible = selectedRows.filter((r) => r.status === "refunded");
    if (eligible.length === 0) return;
    const ok = await confirm({
      title: `Undo refund on ${eligible.length === 1 ? "1 payment" : `${eligible.length} payments`}?`,
      description:
        "Reverses each refund and restores the prior status (confirmed / submitted / unpaid). Use this if the refunds were accidental. Selected rows that aren't Refunded are skipped.",
      confirmLabel: "Undo refunds",
      tone: "danger",
    });
    if (!ok) return;
    await runBatch({
      rows: eligible,
      mutateAsync: (r) => unrefundMutation.mutateAsync({ paymentId: r.id }),
      event: "admin_boba_payment_unrefund",
      verbPast: "Reverted refund on",
      verbAttempt: "revert refund on",
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Boba & Momo payments"
        tone="marketing"
        subtitle="Per-order e-transfer ledger. Confirm, refund, or undo confirmations for each drink or momo."
        backHref="/"
        showBack
      />

      {!staff && (
        <Card>
          <CardTitle>Staff access required</CardTitle>
          <CardDescription className="mt-1">
            Sign in with a staff account to view boba payments.
          </CardDescription>
        </Card>
      )}

      {staff && !isSuper && (
        <Card className="border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg)">
          <CardTitle className="text-(--bearhacks-warning-fg)">
            Super Admin access required
          </CardTitle>
          <CardDescription className="mt-1 text-(--bearhacks-warning-fg)">
            This console is limited to Super Admins.
          </CardDescription>
        </Card>
      )}

      {isSuper && windowsQuery.data ? (
        <FilterBar
          windows={windowsQuery.data}
          values={filters}
          fallbackWindowId={fallbackWindowId}
          draftSearch={draftSearch}
          onDraftSearchChange={setDraftSearch}
          // `page` resets live with each interaction that could change the
          // result set (filter toggles, window change, search apply). We
          // keep it in event handlers rather than a `useEffect` so React
          // 19's `set-state-in-effect` rule stays happy.
          onToggleStatus={(s) => {
            setFilters((prev) => {
              const next = new Set(prev.statuses);
              if (next.has(s)) next.delete(s);
              else next.add(s);
              return { ...prev, statuses: next };
            });
            setPage(0);
          }}
          onClearStatuses={() => {
            setFilters((prev) => ({ ...prev, statuses: new Set() }));
            setPage(0);
          }}
          onChangeWindow={(windowId) => {
            setFilters((prev) => ({ ...prev, meal_window_id: windowId }));
            setPage(0);
          }}
          onApplySearch={() => {
            setAppliedSearch(draftSearch);
            setPage(0);
          }}
          onReset={() => {
            setFilters(DEFAULT_FILTER);
            setDraftSearch("");
            setAppliedSearch("");
            setPage(0);
          }}
        />
      ) : null}

      {isSuper ? (
        <SummaryCard
          query={paymentsQuery}
          windowLabel={windowLabel(windowsQuery.data, focusedWindowId) ?? "—"}
        />
      ) : null}

      {isSuper ? (
        <PaymentsTableCard
          query={paymentsQuery}
          page={page}
          pageSize={PAGE_SIZE}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onClearSelection={clearSelection}
          onBatchConfirm={onBatchConfirm}
          onBatchRefund={onBatchRefund}
          onBatchUnconfirm={onBatchUnconfirm}
          onBatchUnrefund={onBatchUnrefund}
          onConfirm={async (row) => {
            const sibling = findMatchedSibling(row, "confirm");
            const rows = sibling ? [row, sibling] : [row];
            const total = rows.reduce((s, r) => s + r.expected_cents, 0);
            const refText = (row.reference ?? "").trim();
            const description = sibling
              ? `Confirms both halves of this submission (${row.kind} + ${sibling.kind}) as paid in full. received_cents = expected_cents for each.`
              : row.status === "submitted"
                ? refText.length > 0
                  ? `Hacker submitted ref “${refText}”. Marks this order paid in full.`
                  : "Hacker submitted nothing for reference. Confirm they added a reference to their e-transfer in person. CONFIRM PAYMENT marks this order paid in full."
                : "Marks this order paid in full (received_cents = expected_cents).";
            const ok = await confirm({
              title: sibling
                ? `Confirm paired submission totaling $${(total / 100).toFixed(2)} from ${row.hacker_name}?`
                : `Confirm $${(row.expected_cents / 100).toFixed(2)} from ${row.hacker_name}?`,
              description,
              confirmLabel: sibling ? "Confirm pair" : "Confirm payment",
            });
            if (!ok) return;
            await runPairAction({
              rows,
              mutateAsync: (r) =>
                confirmMutation.mutateAsync({ paymentId: r.id }),
              event: "admin_boba_payment_confirm",
              successSingular: "Payment confirmed.",
              successPlural: "Paired payments confirmed.",
              failVerb: "confirm",
            });
          }}
          onRefund={async (row) => {
            const sibling = findMatchedSibling(row, "refund");
            const rows = sibling ? [row, sibling] : [row];
            const ok = await confirm({
              title: sibling
                ? `Refund paired submission for ${row.hacker_name}?`
                : `Refund payment for ${row.hacker_name}?`,
              description: sibling
                ? `Marks both halves of this submission (${row.kind} + ${sibling.kind}) refunded. Hacker can re-submit to pay again.`
                : "Marks this order refunded. Hacker can re-submit to pay again.",
              confirmLabel: sibling ? "Refund pair" : "Refund",
              tone: "danger",
            });
            if (!ok) return;
            await runPairAction({
              rows,
              mutateAsync: (r) =>
                refundMutation.mutateAsync({ paymentId: r.id }),
              event: "admin_boba_payment_refund",
              successSingular: "Payment refunded.",
              successPlural: "Paired payments refunded.",
              failVerb: "refund",
            });
          }}
          onUnconfirm={async (row) => {
            const sibling = findMatchedSibling(row, "unconfirm");
            const rows = sibling ? [row, sibling] : [row];
            const ok = await confirm({
              title: sibling
                ? `Undo confirmation for paired submission from ${row.hacker_name}?`
                : `Undo confirmation for ${row.hacker_name}?`,
              description: sibling
                ? `Reverts both halves of this submission (${row.kind} + ${sibling.kind}) to submitted. Use this if the e-transfer bounced or was confirmed by mistake.`
                : "Reverts this order to submitted. Use this if the e-transfer bounced or was confirmed by mistake.",
              confirmLabel: sibling ? "Undo pair" : "Undo confirmation",
              tone: "danger",
            });
            if (!ok) return;
            await runPairAction({
              rows,
              mutateAsync: (r) =>
                unconfirmMutation.mutateAsync({ paymentId: r.id }),
              event: "admin_boba_payment_unconfirm",
              successSingular: "Confirmation reverted.",
              successPlural: "Paired confirmations reverted.",
              failVerb: "revert confirmation for",
            });
          }}
          onUnrefund={async (row) => {
            const ok = await confirm({
              title: `Undo refund for ${row.hacker_name}?`,
              description:
                "Reverses the refund and restores this order to its prior status (confirmed / submitted / unpaid). Use this if the refund was accidental.",
              confirmLabel: "Undo refund",
              tone: "danger",
            });
            if (!ok) return;
            try {
              await unrefundMutation.mutateAsync({ paymentId: row.id });
              log("info", {
                event: "admin_boba_payment_unrefund",
                actor,
                resourceId: row.id,
                result: "success",
              });
              toast.success("Refund reverted.");
            } catch (error) {
              log("error", {
                event: "admin_boba_payment_unrefund",
                actor,
                resourceId: row.id,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Failed to revert refund",
              );
            }
          }}
        />
      ) : null}
    </main>
  );
}

function windowLabel(
  data: WindowsResponse | undefined,
  windowId: string | undefined,
): string | null {
  if (!data || !windowId) return null;
  return data.windows.find((w) => w.id === windowId)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type FilterBarProps = {
  windows: WindowsResponse;
  values: FilterValues;
  fallbackWindowId: string | undefined;
  draftSearch: string;
  onDraftSearchChange: (next: string) => void;
  onToggleStatus: (status: PaymentStatus) => void;
  onClearStatuses: () => void;
  onChangeWindow: (windowId: string | undefined) => void;
  onApplySearch: () => void;
  onReset: () => void;
};

function FilterBar({
  windows,
  values,
  fallbackWindowId,
  draftSearch,
  onDraftSearchChange,
  onToggleStatus,
  onClearStatuses,
  onChangeWindow,
  onApplySearch,
  onReset,
}: FilterBarProps) {
  return (
    <Card className="flex flex-col gap-4">
      <FilterField label="Meal window" htmlFor="filter-meal-window">
        <select
          id="filter-meal-window"
          value={values.meal_window_id ?? fallbackWindowId ?? ""}
          onChange={(e) => onChangeWindow(e.target.value || undefined)}
          className={selectClasses}
        >
          {windows.windows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </FilterField>

      <div className="flex flex-col gap-2">
        <span
          id="payments-status-filter-label"
          className="text-sm font-medium text-(--bearhacks-title)"
        >
          Filter by status
        </span>
        <div
          role="group"
          aria-labelledby="payments-status-filter-label"
          className="flex flex-wrap gap-2"
        >
          {STATUS_VALUES.map((s) => {
            const active = values.statuses.has(s);
            return (
              <Button
                key={s}
                type="button"
                variant={active ? "primary" : "ghost"}
                aria-pressed={active}
                onClick={() => onToggleStatus(s)}
              >
                {STATUS_LABELS[s]}
              </Button>
            );
          })}
          {values.statuses.size > 0 ? (
            <Button type="button" variant="ghost" onClick={onClearStatuses}>
              Clear statuses
            </Button>
          ) : null}
        </div>
      </div>

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          onApplySearch();
        }}
      >
        <div className="min-w-0 flex-1">
          <FilterField
            label="Search (name, email, reference, notes, item details)"
            htmlFor="filter-search"
          >
            <input
              id="filter-search"
              type="search"
              value={draftSearch}
              placeholder="Type to filter…"
              onChange={(e) => onDraftSearchChange(e.target.value)}
              className={inputClasses}
              autoComplete="off"
            />
            <span className="text-xs text-(--bearhacks-muted)">
              Filters live as you type — Enter or Apply skips the 250ms delay.
            </span>
          </FilterField>
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-(--bearhacks-muted)">
          Auto-refreshes every 30 seconds. All filters apply server-side.
        </p>
        <Button type="button" variant="ghost" onClick={onReset}>
          Reset
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary card — totals + by-status counts
// ---------------------------------------------------------------------------

function SummaryCard({
  query,
  windowLabel,
}: {
  query: ReturnType<typeof useAdminPaymentsQuery>;
  windowLabel: string;
}) {
  const summary = query.data?.summary;
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>
          Payment <span className="bg-(--bearhacks-cream) px-1 rounded-sm">summary</span>
        </CardTitle>
        <span className="text-xs text-(--bearhacks-muted)">{windowLabel}</span>
      </div>
      {!summary ? (
        <CardDescription className="mt-1">
          {query.isLoading ? "Loading…" : "No payment data yet."}
        </CardDescription>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat
            label="Expected"
            value={`$${(summary.total_expected_cents / 100).toFixed(2)}`}
          />
          <SummaryStat
            label="Received"
            value={`$${(summary.total_received_cents / 100).toFixed(2)}`}
          />
          <SummaryStat label="Submitted" value={summary.by_status.submitted} />
          <SummaryStat label="Confirmed" value={summary.by_status.confirmed} />
        </div>
      )}
    </Card>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 py-2">
      <p className="text-xs uppercase tracking-[0.08rem] text-(--bearhacks-muted)">
        {label}
      </p>
      <p className="text-base font-semibold text-(--bearhacks-fg)">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments table
// ---------------------------------------------------------------------------

type PaymentsTableCardProps = {
  query: ReturnType<typeof useAdminPaymentsQuery>;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  onClearSelection: () => void;
  onBatchConfirm: () => Promise<void> | void;
  onBatchRefund: () => Promise<void> | void;
  onBatchUnconfirm: () => Promise<void> | void;
  onBatchUnrefund: () => Promise<void> | void;
  onConfirm: (row: AdminPaymentRow) => Promise<void>;
  onRefund: (row: AdminPaymentRow) => Promise<void>;
  onUnconfirm: (row: AdminPaymentRow) => Promise<void>;
  onUnrefund: (row: AdminPaymentRow) => Promise<void>;
};

function PaymentsTableCard({
  query,
  page,
  pageSize,
  onPrev,
  onNext,
  selected,
  onToggleRow,
  onToggleAll,
  onClearSelection,
  onBatchConfirm,
  onBatchRefund,
  onBatchUnconfirm,
  onBatchUnrefund,
  onConfirm,
  onRefund,
  onUnconfirm,
  onUnrefund,
}: PaymentsTableCardProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updated_at", desc: true },
  ]);

  // Stable reference for the payments slice: `query.data?.payments ?? []`
  // evaluates to a fresh `[]` on every render while the query is loading
  // / errored, which would thrash the downstream `liveData` / `pastData`
  // memos' dependency array. Memoising on `query.data?.payments` keeps
  // identity stable across renders where the server response hasn't
  // changed.
  const data = useMemo(
    () => query.data?.payments ?? [],
    [query.data?.payments],
  );

  // Split per-order payments into "live" (underlying order still
  // ``placed``) and "past" (cancelled or already picked up). The old
  // bundle-era UI collapsed past *items* inside each bundle's drawer —
  // now that every row is a single order we lift that split up to the
  // table itself: live rows stay in the main list with full actions,
  // past rows are hidden behind a <details> drawer below and render
  // read-only (no checkbox, no confirm/refund/undo). That keeps the
  // pickup queue uncluttered and stops admins from accidentally
  // confirming payment on a row whose food never existed.
  const liveData = useMemo(
    () => data.filter((r) => r.item_status === "placed"),
    [data],
  );
  const pastData = useMemo(
    () => data.filter((r) => r.item_status !== "placed"),
    [data],
  );

  // Submission-pair detection for visual cues in the Item column.
  //
  // Mirrors the ``user_id`` + ``meal_window_id`` + ±3s ``created_at``
  // heuristic used by the hacker-facing ``PayableGroup`` and by the
  // parent page's ``findMatchedSibling`` — we compute the set of row
  // IDs that have a sibling in ``liveData`` so ``PaymentItemCell``
  // can flag them with a small "Paired" badge. Without the badge,
  // admins would be surprised when the per-row Confirm button
  // silently acts on two rows. Only ``placed`` rows participate:
  // past rows can't be actioned anyway.
  const pairedIds = useMemo<ReadonlySet<string>>(() => {
    const EPSILON_MS = 3000;
    const ids = new Set<string>();
    const parsed = liveData.map((r) => ({
      row: r,
      ts: new Date(r.created_at).getTime(),
    }));
    for (let i = 0; i < parsed.length; i += 1) {
      const a = parsed[i]!;
      if (ids.has(a.row.id)) continue;
      for (let j = i + 1; j < parsed.length; j += 1) {
        const b = parsed[j]!;
        if (a.row.kind === b.row.kind) continue;
        if (a.row.user_id !== b.row.user_id) continue;
        if (a.row.meal_window_id !== b.row.meal_window_id) continue;
        if (Math.abs(a.ts - b.ts) > EPSILON_MS) continue;
        ids.add(a.row.id);
        ids.add(b.row.id);
        break;
      }
    }
    return ids;
  }, [liveData]);

  const columns = useMemo<ColumnDef<AdminPaymentRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => {
          // Header checkbox drives the current page only — same
          // scope as the mobile "Select all" button below. Indeterm.
          // state means some-but-not-all rows on this page are
          // selected; checking in that state selects the rest.
          const visibleIds = table
            .getRowModel()
            .rows.map((r) => r.original.id);
          const selectedHere = visibleIds.filter((id) => selected.has(id));
          const allSelected =
            visibleIds.length > 0 && selectedHere.length === visibleIds.length;
          const someSelected =
            selectedHere.length > 0 && !allSelected;
          return (
            <input
              type="checkbox"
              className={CHECKBOX_CLASSES}
              aria-label={
                allSelected
                  ? "Deselect all payments on this page"
                  : "Select all payments on this page"
              }
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={(e) => onToggleAll(visibleIds, e.target.checked)}
            />
          );
        },
        cell: (ctx) => {
          const o = ctx.row.original;
          return (
            <input
              type="checkbox"
              className={CHECKBOX_CLASSES}
              aria-label={`Select payment for ${o.hacker_name}`}
              checked={selected.has(o.id)}
              onChange={() => onToggleRow(o.id)}
            />
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: "hacker_name",
        header: "Hacker",
        cell: (ctx) => {
          const o = ctx.row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-(--bearhacks-fg)">
                {o.hacker_name}
              </span>
              {o.hacker_email ? (
                <span className="text-xs text-(--bearhacks-muted)">
                  {o.hacker_email}
                </span>
              ) : null}
            </div>
          );
        },
        sortingFn: (a, b) =>
          a.original.hacker_name.localeCompare(
            b.original.hacker_name,
            "en",
            { sensitivity: "base" },
          ),
      },
      {
        id: "item",
        header: "Item",
        cell: (ctx) => (
          <PaymentItemCell
            row={ctx.row.original}
            isPaired={pairedIds.has(ctx.row.original.id)}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "expected_cents",
        header: "Expected",
        cell: (ctx) => (
          <span className="text-sm font-semibold text-(--bearhacks-fg)">
            ${(ctx.row.original.expected_cents / 100).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "received_cents",
        header: "Received",
        cell: (ctx) => {
          const v = ctx.row.original.received_cents;
          return (
            <span className="text-xs text-(--bearhacks-muted)">
              {v == null ? "—" : `$${(v / 100).toFixed(2)}`}
            </span>
          );
        },
      },
      {
        accessorKey: "reference",
        header: "Reference",
        cell: (ctx) => (
          <span className="text-xs text-(--bearhacks-muted)">
            {ctx.row.original.reference ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (ctx) => {
          const s = ctx.row.original.status;
          return (
            <span
              className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[s]}`}
            >
              {STATUS_LABELS[s]}
            </span>
          );
        },
      },
      {
        accessorKey: "updated_at",
        header: "Updated",
        cell: (ctx) => (
          <span className="text-xs text-(--bearhacks-muted)">
            {new Date(ctx.row.original.updated_at).toLocaleString("en-CA", {
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              day: "numeric",
              timeZone: "America/Toronto",
            })}
          </span>
        ),
        sortingFn: (a, b) =>
          new Date(a.original.updated_at).getTime() -
          new Date(b.original.updated_at).getTime(),
      },
      {
        id: "actions",
        header: "Actions",
        cell: (ctx) => {
          const o = ctx.row.original;
          // Fixed-width column (see column <col> / header styling) keeps the
          // Confirm/Refund pair from wrapping into a tall stack on narrower
          // screens and aligns all three states (Confirm+Refund, Undo,
          // disabled) against the same right edge.
          if (o.status === "confirmed") {
            return (
              <div className="flex justify-end whitespace-nowrap">
                <Button
                  type="button"
                  variant="pill"
                  className={ACTION_BUTTON_UNDO}
                  onClick={() => void onUnconfirm(o)}
                >
                  Undo
                </Button>
              </div>
            );
          }
          if (o.status === "refunded") {
            return (
              <div className="flex justify-end whitespace-nowrap">
                <Button
                  type="button"
                  variant="pill"
                  className={ACTION_BUTTON_UNDO}
                  onClick={() => void onUnrefund(o)}
                >
                  Undo
                </Button>
              </div>
            );
          }
          return (
            <div className="flex items-start justify-end gap-1.5 whitespace-nowrap">
              <Button
                type="button"
                variant="pill"
                className={ACTION_BUTTON_CONFIRM}
                onClick={() => void onConfirm(o)}
              >
                Confirm
              </Button>
              <Button
                type="button"
                variant="pill"
                className={ACTION_BUTTON_REFUND}
                onClick={() => void onRefund(o)}
              >
                Refund
              </Button>
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [
      onConfirm,
      onRefund,
      onUnconfirm,
      onUnrefund,
      selected,
      onToggleRow,
      onToggleAll,
      pairedIds,
    ],
  );

  // Search + filtering are server-side now (pagination lives in the
  // parent's `page` state and the backend envelope), so react-table is
  // left with just sorting over the current page's rows.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: liveData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const total = query.data?.total ?? 0;
  // Range is only well-defined when we actually have rows in hand.
  // The parent snaps `page` back on the next render when `total`
  // shrinks below the current offset, but there's a one-render gap
  // where `data` is still the empty slice the server returned for
  // the stale offset. Computing `pageStart`/`pageEnd` in that frame
  // used to produce nonsense like "Showing 51–40 of 40"; now we fall
  // back to the "N total." string used when there are no rows at
  // all, and the real range reappears once the refetch at the
  // clamped offset lands.
  const hasRange = total > 0 && data.length > 0;
  const pageStart = hasRange ? page * pageSize + 1 : 0;
  const pageEnd = hasRange ? Math.min(total, page * pageSize + data.length) : 0;

  // Counts for the batch action bar. We always count against the
  // *visible live* rows (`liveData`) intersected with `selected` so
  // past-item rows (which render read-only in the drawer and don't
  // expose a checkbox) can't slip into a batch op, and selections
  // that got filtered out server-side between renders don't inflate
  // the button count.
  const selectedVisible = liveData.filter((r) => selected.has(r.id));
  const selectedCount = selectedVisible.length;
  const eligibleConfirmCount = selectedVisible.filter(
    (r) => r.status === "unpaid" || r.status === "submitted",
  ).length;
  const eligibleRefundCount = eligibleConfirmCount;
  const eligibleUnconfirmCount = selectedVisible.filter(
    (r) => r.status === "confirmed",
  ).length;
  const eligibleUnrefundCount = selectedVisible.filter(
    (r) => r.status === "refunded",
  ).length;

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-(--bearhacks-border) px-4 py-3">
        <CardTitle className="text-base">
          All <span className="bg-(--bearhacks-cream) px-1 rounded-sm">payments</span>
        </CardTitle>
        <CardDescription>
          Per-order e-transfer payments for the focused window.{" "}
          {query.data
            ? hasRange
              ? `Showing ${pageStart}–${pageEnd} of ${total}.`
              : `${total} total.`
            : null}
        </CardDescription>
      </div>

      {selectedCount > 0 ? (
        <BatchActionBar
          selectedCount={selectedCount}
          eligibleConfirmCount={eligibleConfirmCount}
          eligibleRefundCount={eligibleRefundCount}
          eligibleUnconfirmCount={eligibleUnconfirmCount}
          eligibleUnrefundCount={eligibleUnrefundCount}
          onBatchConfirm={onBatchConfirm}
          onBatchRefund={onBatchRefund}
          onBatchUnconfirm={onBatchUnconfirm}
          onBatchUnrefund={onBatchUnrefund}
          onClear={onClearSelection}
        />
      ) : null}

      {query.isLoading ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-danger)">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load payments"}
        </p>
      ) : liveData.length === 0 && pastData.length === 0 ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
          No payments match the current filters.
        </p>
      ) : (
        <>
          {liveData.length === 0 ? (
            <p className="px-4 py-6 text-sm italic text-(--bearhacks-muted)">
              No live payments on this page — everything below was cancelled or
              already picked up.
            </p>
          ) : null}
          <div
            className={`${liveData.length === 0 ? "hidden" : "hidden overflow-x-auto sm:block"}`}
          >
            <table className="w-full min-w-3xl border-collapse text-left text-sm">
              <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sort = header.column.getIsSorted();
                      const isActions = header.column.id === "actions";
                      const isSelect = header.column.id === "select";
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className={`px-3 py-3 font-medium text-(--bearhacks-fg) align-top ${
                            isActions
                              ? "w-[200px] min-w-[200px] text-right"
                              : isSelect
                                ? "w-[40px] min-w-[40px]"
                                : ""
                          }`}
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 text-left font-medium hover:underline"
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              <span aria-hidden className="text-xs">
                                {sort === "asc" ? "▲" : sort === "desc" ? "▼" : ""}
                              </span>
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-(--bearhacks-border) last:border-0 align-top"
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isActions = cell.column.id === "actions";
                      const isSelect = cell.column.id === "select";
                      return (
                        <td
                          key={cell.id}
                          className={`px-3 py-3 ${
                            isActions
                              ? "w-[200px] min-w-[200px] text-right align-top whitespace-nowrap"
                              : isSelect
                                ? "w-[40px] min-w-[40px] align-top"
                                : ""
                          }`}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul
            className={`${liveData.length === 0 ? "hidden" : "flex flex-col gap-3 p-3 sm:hidden"}`}
          >
            {table.getRowModel().rows.map((row) => {
              const o = row.original;
              const expected = `$${(o.expected_cents / 100).toFixed(2)}`;
              const received =
                o.received_cents == null
                  ? null
                  : `$${(o.received_cents / 100).toFixed(2)}`;
              return (
                <li
                  key={row.id}
                  className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        className={`${CHECKBOX_CLASSES} mt-0.5`}
                        aria-label={`Select payment for ${o.hacker_name}`}
                        checked={selected.has(o.id)}
                        onChange={() => onToggleRow(o.id)}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-semibold text-(--bearhacks-fg) wrap-break-word">
                          {o.hacker_name}
                        </span>
                        {o.hacker_email ? (
                          <span className="text-xs text-(--bearhacks-muted) wrap-break-word">
                            {o.hacker_email}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[o.status]}`}
                    >
                      {STATUS_LABELS[o.status]}
                    </span>
                  </div>

                  <div className="mt-2">
                    <PaymentItemCell row={o} isPaired={pairedIds.has(o.id)} />
                  </div>

                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                      Expected
                    </dt>
                    <dd className="font-semibold text-(--bearhacks-fg)">
                      {expected}
                    </dd>
                    <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                      Received
                    </dt>
                    <dd className="text-(--bearhacks-fg)">{received ?? "—"}</dd>
                    {o.reference ? (
                      <>
                        <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                          Ref
                        </dt>
                        <dd className="text-(--bearhacks-fg) wrap-break-word">
                          {o.reference}
                        </dd>
                      </>
                    ) : null}
                    <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                      Updated
                    </dt>
                    <dd className="text-(--bearhacks-fg)">
                      {new Date(o.updated_at).toLocaleString("en-CA", {
                        hour: "numeric",
                        minute: "2-digit",
                        month: "short",
                        day: "numeric",
                        timeZone: "America/Toronto",
                      })}
                    </dd>
                  </dl>

                  {o.status === "confirmed" ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="pill"
                        className={`w-full sm:w-auto ${ACTION_BUTTON_UNDO}`}
                        onClick={() => void onUnconfirm(o)}
                      >
                        Undo confirmation
                      </Button>
                    </div>
                  ) : o.status === "refunded" ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="pill"
                        className={`w-full sm:w-auto ${ACTION_BUTTON_UNDO}`}
                        onClick={() => void onUnrefund(o)}
                      >
                        Undo refund
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        variant="pill"
                        className={`w-full sm:w-auto ${ACTION_BUTTON_CONFIRM}`}
                        onClick={() => void onConfirm(o)}
                      >
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        variant="pill"
                        className={`w-full sm:w-auto ${ACTION_BUTTON_REFUND}`}
                        onClick={() => void onRefund(o)}
                      >
                        Refund
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {pastData.length > 0 ? (
            <PastPaymentsDrawer
              rows={pastData}
              defaultOpen={liveData.length === 0}
            />
          ) : null}
        </>
      )}

      {query.data ? (
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPrev={onPrev}
          onNext={onNext}
          isFetching={query.isFetching}
        />
      ) : null}
    </Card>
  );
}

/**
 * Read-only drawer for payments whose underlying drink/momo is no
 * longer ``placed`` (cancelled or already picked up).
 *
 * Why a separate section?
 *
 * - The pickup queue is the primary job this page does, and past
 *   rows just add noise to it — the food team kept confusing
 *   struck-through lines with outstanding work.
 * - Cancelled orders explicitly cannot be acted on. The row has no
 *   food to hand off and (per the per-order migration) the payment
 *   is already settled upstream. Rendering Confirm/Refund/Undo here
 *   would be a footgun, so the entire row is unusable by design.
 * - Hiding them behind a collapsed ``<details>`` preserves the audit
 *   trail (and keeps parity with the admin's prior mental model
 *   from the bundle-era drawer) without crowding the live list.
 *
 * The drawer opens by default only when the current page has no
 * live rows at all — otherwise the live list takes priority and
 * the drawer stays tucked away.
 */
function PastPaymentsDrawer({
  rows,
  defaultOpen,
}: {
  rows: readonly AdminPaymentRow[];
  defaultOpen: boolean;
}) {
  const cancelledCount = rows.filter((r) => r.item_status === "cancelled").length;
  const fulfilledCount = rows.filter((r) => r.item_status === "fulfilled").length;
  const summaryParts: string[] = [];
  if (cancelledCount > 0) summaryParts.push(`${cancelledCount} cancelled`);
  if (fulfilledCount > 0) summaryParts.push(`${fulfilledCount} picked up`);
  const summaryLine = `${rows.length} past payment${rows.length === 1 ? "" : "s"}${
    summaryParts.length > 0 ? ` · ${summaryParts.join(" · ")}` : ""
  }`;

  return (
    <details
      {...(defaultOpen ? { open: true } : {})}
      className="mx-3 mt-1 mb-3 rounded-(--bearhacks-radius-md) border border-dashed border-(--bearhacks-border) bg-(--bearhacks-surface-alt)/40"
    >
      <summary className="cursor-pointer list-none select-none px-3 py-2 text-xs font-medium text-(--bearhacks-muted) hover:text-(--bearhacks-fg) [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1.5 inline-block">
          ▸
        </span>
        {summaryLine}
      </summary>

      <ul className="flex flex-col gap-2 border-t border-dashed border-(--bearhacks-border) px-3 py-3">
        {rows.map((o) => {
          const expected = `$${(o.expected_cents / 100).toFixed(2)}`;
          const received =
            o.received_cents == null
              ? null
              : `$${(o.received_cents / 100).toFixed(2)}`;
          return (
            <li
              key={o.id}
              className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-2 opacity-70 sm:grid sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_auto_auto] sm:items-start sm:gap-3"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-(--bearhacks-fg) line-through wrap-break-word">
                  {o.hacker_name}
                </span>
                {o.hacker_email ? (
                  <span className="text-xs text-(--bearhacks-muted) line-through wrap-break-word">
                    {o.hacker_email}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <PaymentItemCell row={o} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-(--bearhacks-fg) line-through tabular-nums">
                  {expected}
                </span>
                {received ? (
                  <span className="text-(--bearhacks-muted) line-through tabular-nums">
                    · received {received}
                  </span>
                ) : null}
                {o.reference ? (
                  <span className="text-(--bearhacks-muted) line-through wrap-break-word">
                    · ref {o.reference}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span
                  className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[o.status]}`}
                >
                  {STATUS_LABELS[o.status]}
                </span>
                <span className="text-xs text-(--bearhacks-muted) line-through whitespace-nowrap">
                  {new Date(o.updated_at).toLocaleString("en-CA", {
                    hour: "numeric",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                    timeZone: "America/Toronto",
                  })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * Sticky-ish toolbar shown above the payments table when one or more
 * rows are checked. Each action button is labelled with its eligible
 * subset count (e.g. "Confirm (3)") — if a button would affect zero
 * rows in the current selection it stays disabled, which keeps the
 * toolbar honest about what a click will do without having to mix in
 * tooltips. Selection is per-page (see the scope-key reset in the
 * parent), so "Clear" is effectively a one-click bailout.
 */
function BatchActionBar({
  selectedCount,
  eligibleConfirmCount,
  eligibleRefundCount,
  eligibleUnconfirmCount,
  eligibleUnrefundCount,
  onBatchConfirm,
  onBatchRefund,
  onBatchUnconfirm,
  onBatchUnrefund,
  onClear,
}: {
  selectedCount: number;
  eligibleConfirmCount: number;
  eligibleRefundCount: number;
  eligibleUnconfirmCount: number;
  eligibleUnrefundCount: number;
  onBatchConfirm: () => Promise<void> | void;
  onBatchRefund: () => Promise<void> | void;
  onBatchUnconfirm: () => Promise<void> | void;
  onBatchUnrefund: () => Promise<void> | void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Batch actions"
      className="flex flex-wrap items-center gap-2 border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3"
    >
      <span className="text-sm font-semibold text-(--bearhacks-fg)">
        {selectedCount} selected
      </span>
      <span aria-hidden className="text-(--bearhacks-muted)">
        ·
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="pill"
          className={ACTION_BUTTON_CONFIRM}
          disabled={eligibleConfirmCount === 0}
          onClick={() => void onBatchConfirm()}
        >
          Confirm ({eligibleConfirmCount})
        </Button>
        <Button
          type="button"
          variant="pill"
          className={ACTION_BUTTON_REFUND}
          disabled={eligibleRefundCount === 0}
          onClick={() => void onBatchRefund()}
        >
          Refund ({eligibleRefundCount})
        </Button>
        <Button
          type="button"
          variant="pill"
          className={ACTION_BUTTON_UNDO}
          disabled={eligibleUnconfirmCount === 0}
          onClick={() => void onBatchUnconfirm()}
        >
          Undo confirm ({eligibleUnconfirmCount})
        </Button>
        <Button
          type="button"
          variant="pill"
          className={ACTION_BUTTON_UNDO}
          disabled={eligibleUnrefundCount === 0}
          onClick={() => void onBatchUnrefund()}
        >
          Undo refund ({eligibleUnrefundCount})
        </Button>
      </div>
      <div className="ml-auto">
        <Button
          type="button"
          variant="ghost"
          className="text-xs"
          onClick={onClear}
        >
          Clear selection
        </Button>
      </div>
    </div>
  );
}

/**
 * Server pagination footer for the payments table. Shape mirrors the one
 * in the super-admin profile directory so the two consoles read as one
 * product — "Page N of M · X total" plus Prev/Next buttons that stay
 * enabled while React Query swaps pages via `keepPreviousData`.
 */
function PaginationControls({
  page,
  pageSize,
  total,
  onPrev,
  onNext,
  isFetching,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  isFetching: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page + 1, pageCount);
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--bearhacks-border) px-4 py-3 text-sm text-(--bearhacks-muted)">
      <span aria-live="polite">
        Page {current} of {pageCount} · {total} total
        {isFetching ? " · refreshing…" : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

type FilterFieldProps = {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
};

function FilterField({ label, htmlFor, children }: FilterFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-(--bearhacks-title)"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none";

const selectClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-focus-ring) focus:outline-none";
