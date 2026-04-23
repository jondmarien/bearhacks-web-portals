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

type PaymentItem = AdminPaymentRow["items"][number];

/**
 * One line in the payments "Items" column, laid out like a mini-row:
 *   [Kind pill] [size]  [status?] detail                           $X.XX
 *
 * Mirrors the orders table's Kind / Size / Detail / $ columns so admins don't
 * have to re-learn a second visual grammar when they switch consoles. Past
 * items (cancelled / fulfilled) fade, strike through the detail text, and
 * carry an inline status badge so ``Cancelled`` vs ``Picked up`` stays
 * scannable inside the collapsed "past items" drawer.
 *
 * Renders as four grid cells (pill | size | detail | price) via
 * `display: contents`, so every row in the parent grid shares the same
 * column rail regardless of whether an item has a size. See the wrapping
 * `<ul>` for the grid-template that defines the shared columns.
 */
function PaymentItemLine({ item }: { item: PaymentItem }) {
  const isPlaced = item.status === "placed";
  const label = item.kind === "drink" ? "Drink" : "Momos";
  const dimmed = isPlaced ? "" : "opacity-70";
  const priceTone = isPlaced
    ? "text-(--bearhacks-fg)"
    : "text-(--bearhacks-muted)";
  return (
    <li className={`contents ${dimmed}`}>
      <span
        className={`inline-flex self-start items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-[11px] font-semibold ${KIND_PILL_CLASSES[item.kind]}`}
      >
        {label}
      </span>
      <span className="self-start text-xs text-(--bearhacks-muted)">
        {item.size ?? "—"}
      </span>
      <span className="self-start text-xs wrap-break-word">
        {!isPlaced ? <ItemStatusBadge status={item.status} /> : null}
        <span
          className={
            isPlaced
              ? "text-(--bearhacks-fg)"
              : "text-(--bearhacks-muted) line-through"
          }
        >
          {item.detail}
        </span>
      </span>
      <span
        className={`self-start text-xs font-semibold text-right tabular-nums ${priceTone}`}
      >
        ${(item.amount_cents / 100).toFixed(2)}
      </span>
    </li>
  );
}

/**
 * Tiny inline status chip used on past items inside the ``<details>``
 * drawer. Kept visually lighter than the top-level payment status pill so
 * it reads as line-level context, not a competing call-to-action.
 */
function ItemStatusBadge({ status }: { status: PaymentItem["status"] }) {
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
 * Renders a payment bundle's items, split into "live" (what the food
 * team still has to make / hand off) and "past" (cancelled or already
 * picked up — audit context, but not the pickup queue).
 *
 * Past items live inside a collapsed ``<details>`` so they don't compete
 * with the live pickup list — the user's explicit ask after the food
 * team kept confusing crossed-out lines with outstanding work. The
 * drawer opens by default only when there's nothing live to look at,
 * so "everything cancelled" bundles still expose their audit trail
 * without an extra click.
 */
function PaymentItemsCell({ items }: { items: readonly PaymentItem[] }) {
  if (items.length === 0) {
    return (
      <span className="text-xs text-(--bearhacks-muted)">No placed items</span>
    );
  }

  const liveItems = items.filter((it) => it.status === "placed");
  const pastItems = items.filter((it) => it.status !== "placed");
  const cancelledCount = pastItems.filter(
    (it) => it.status === "cancelled",
  ).length;
  const fulfilledCount = pastItems.filter(
    (it) => it.status === "fulfilled",
  ).length;

  const summaryParts: string[] = [];
  if (cancelledCount > 0) summaryParts.push(`${cancelledCount} cancelled`);
  if (fulfilledCount > 0) summaryParts.push(`${fulfilledCount} picked up`);
  const totalPast = pastItems.length;
  const summaryLine =
    totalPast === 0
      ? ""
      : `${totalPast} past item${totalPast === 1 ? "" : "s"}${
          summaryParts.length > 0 ? ` · ${summaryParts.join(" · ")}` : ""
        }`;

  return (
    <div className="flex min-w-[18rem] flex-col gap-2">
      {liveItems.length > 0 ? (
        <ul className="grid grid-cols-[auto_auto_1fr_auto] gap-x-3 gap-y-1.5">
          {liveItems.map((it) => (
            <PaymentItemLine key={it.id} item={it} />
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-(--bearhacks-muted)">
          No live items — everything cancelled or already picked up.
        </p>
      )}

      {pastItems.length > 0 ? (
        <details
          // Open by default only when there are no live items; otherwise
          // the drawer stays collapsed so the pickup view isn't cluttered.
          {...(liveItems.length === 0 ? { open: true } : {})}
          className="rounded-(--bearhacks-radius-md) border border-dashed border-(--bearhacks-border) bg-(--bearhacks-surface-alt)/40"
        >
          <summary className="cursor-pointer list-none select-none px-2 py-1.5 text-xs font-medium text-(--bearhacks-muted) hover:text-(--bearhacks-fg) [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="mr-1.5 inline-block">
              ▸
            </span>
            {summaryLine}
          </summary>
          <ul className="grid grid-cols-[auto_auto_1fr_auto] gap-x-3 gap-y-1.5 border-t border-dashed border-(--bearhacks-border) px-2 pb-2 pt-2">
            {pastItems.map((it) => (
              <PaymentItemLine key={it.id} item={it} />
            ))}
          </ul>
        </details>
      ) : null}
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

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Boba & Momo payments"
        tone="marketing"
        subtitle="Per-hacker × meal-window e-transfer ledger. Confirm, refund, or undo confirmations."
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
          onConfirm={async (row) => {
            const ok = await confirm({
              title: `Confirm $${(row.expected_cents / 100).toFixed(2)} from ${row.hacker_name}?`,
              description:
                row.status === "submitted"
                  ? (row.reference ?? "").trim().length > 0
                    ? `Hacker submitted ref “${row.reference}”. Marks the bundle paid in full.`
                    : "Hacker submitted nothing for reference. Confirm they added a reference to their e-transfer in person. CONFIRM PAYMENT marks the bundle paid in full."
                  : "Marks the bundle paid in full (received_cents = expected_cents).",
              confirmLabel: "Confirm payment",
            });
            if (!ok) return;
            try {
              await confirmMutation.mutateAsync({ paymentId: row.id });
              log("info", {
                event: "admin_boba_payment_confirm",
                actor,
                resourceId: row.id,
                result: "success",
              });
              toast.success("Payment confirmed.");
            } catch (error) {
              log("error", {
                event: "admin_boba_payment_confirm",
                actor,
                resourceId: row.id,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Failed to confirm payment",
              );
            }
          }}
          onRefund={async (row) => {
            const ok = await confirm({
              title: `Refund payment for ${row.hacker_name}?`,
              description:
                "Marks the bundle refunded. Hacker can re-submit to pay again.",
              confirmLabel: "Refund",
              tone: "danger",
            });
            if (!ok) return;
            try {
              await refundMutation.mutateAsync({ paymentId: row.id });
              log("info", {
                event: "admin_boba_payment_refund",
                actor,
                resourceId: row.id,
                result: "success",
              });
              toast.success("Payment refunded.");
            } catch (error) {
              log("error", {
                event: "admin_boba_payment_refund",
                actor,
                resourceId: row.id,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Failed to refund payment",
              );
            }
          }}
          onUnconfirm={async (row) => {
            const ok = await confirm({
              title: `Undo confirmation for ${row.hacker_name}?`,
              description:
                "Reverts the bundle to submitted. Use this if the e-transfer bounced or was confirmed by mistake.",
              confirmLabel: "Undo confirmation",
              tone: "danger",
            });
            if (!ok) return;
            try {
              await unconfirmMutation.mutateAsync({ paymentId: row.id });
              log("info", {
                event: "admin_boba_payment_unconfirm",
                actor,
                resourceId: row.id,
                result: "success",
              });
              toast.success("Confirmation reverted.");
            } catch (error) {
              log("error", {
                event: "admin_boba_payment_unconfirm",
                actor,
                resourceId: row.id,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : "Failed to revert confirmation",
              );
            }
          }}
          onUnrefund={async (row) => {
            const ok = await confirm({
              title: `Undo refund for ${row.hacker_name}?`,
              description:
                "Reverses the refund and restores the bundle to its prior status (confirmed / submitted / unpaid). Use this if the refund was accidental.",
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
  onConfirm,
  onRefund,
  onUnconfirm,
  onUnrefund,
}: PaymentsTableCardProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updated_at", desc: true },
  ]);

  const data = query.data?.payments ?? [];

  const columns = useMemo<ColumnDef<AdminPaymentRow>[]>(
    () => [
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
        id: "items",
        header: "Items",
        cell: (ctx) => <PaymentItemsCell items={ctx.row.original.items} />,
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
    [onConfirm, onRefund, onUnconfirm, onUnrefund],
  );

  // Search + filtering are server-side now (pagination lives in the
  // parent's `page` state and the backend envelope), so react-table is
  // left with just sorting over the current page's rows.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
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

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-(--bearhacks-border) px-4 py-3">
        <CardTitle className="text-base">
          All <span className="bg-(--bearhacks-cream) px-1 rounded-sm">payments</span>
        </CardTitle>
        <CardDescription>
          Per-hacker payment bundles for the focused window.{" "}
          {query.data
            ? hasRange
              ? `Showing ${pageStart}–${pageEnd} of ${total}.`
              : `${total} total.`
            : null}
        </CardDescription>
      </div>

      {query.isLoading ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-danger)">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load payments"}
        </p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
          No payment bundles match the current filters.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-3xl border-collapse text-left text-sm">
              <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sort = header.column.getIsSorted();
                      const isActions = header.column.id === "actions";
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className={`px-3 py-3 font-medium text-(--bearhacks-fg) align-top ${
                            isActions
                              ? "w-[200px] min-w-[200px] text-right"
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
                      return (
                        <td
                          key={cell.id}
                          className={`px-3 py-3 ${
                            isActions
                              ? "w-[200px] min-w-[200px] text-right align-top whitespace-nowrap"
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

          <ul className="flex flex-col gap-3 p-3 sm:hidden">
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
                    <span
                      className={`inline-flex shrink-0 items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[o.status]}`}
                    >
                      {STATUS_LABELS[o.status]}
                    </span>
                  </div>

                  <div className="mt-2">
                    <PaymentItemsCell items={o.items} />
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
