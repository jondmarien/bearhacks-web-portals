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
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import type { User } from "@supabase/supabase-js";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
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

type PaymentItem = AdminPaymentRow["items"][number];

/**
 * One line in the payments "Items" column, laid out like a mini-row:
 *   [Kind pill] [size]  detail                                    $X.XX
 *
 * Mirrors the orders table's Kind / Size / Detail / $ columns so admins don't
 * have to re-learn a second visual grammar when they switch consoles. Cancelled
 * / fulfilled items fade + strike through, matching prior behaviour.
 */
function PaymentItemLine({ item }: { item: PaymentItem }) {
  const isPlaced = item.status === "placed";
  const label = item.kind === "drink" ? "Drink" : "Momos";
  return (
    <li
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${
        isPlaced ? "" : "opacity-60"
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-[11px] font-semibold ${KIND_PILL_CLASSES[item.kind]}`}
      >
        {label}
      </span>
      {item.size ? (
        <span className="shrink-0 text-xs text-(--bearhacks-muted)">
          {item.size}
        </span>
      ) : null}
      <span
        className={`min-w-0 flex-1 text-xs wrap-break-word ${
          isPlaced
            ? "text-(--bearhacks-fg)"
            : "text-(--bearhacks-muted) line-through"
        }`}
      >
        {item.detail}
      </span>
      <span
        className={`ml-auto shrink-0 text-xs font-semibold ${
          isPlaced ? "text-(--bearhacks-fg)" : "text-(--bearhacks-muted)"
        }`}
      >
        ${(item.amount_cents / 100).toFixed(2)}
      </span>
    </li>
  );
}

type FilterValues = {
  meal_window_id?: string;
  status?: PaymentStatus;
  search: string;
};

const DEFAULT_FILTER: FilterValues = {
  meal_window_id: undefined,
  status: undefined,
  search: "",
};

export default function AdminBobaPaymentsPage() {
  const supabase = useSupabase();
  const confirm = useConfirm();
  useDocumentTitle("Boba & Momo payments");

  const [user, setUser] = useState<User | null>(null);
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER);
  const deferredSearch = useDeferredValue(filters.search);

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
      status: filters.status,
    },
    isSuper,
  );

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
          onChange={setFilters}
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
          search={deferredSearch}
          onConfirm={async (row) => {
            const ok = await confirm({
              title: `Confirm $${(row.expected_cents / 100).toFixed(2)} from ${row.hacker_name}?`,
              description:
                row.status === "submitted"
                  ? `Hacker submitted ref “${row.reference ?? ""}”. Marks the bundle paid in full.`
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
  onChange: (next: FilterValues) => void;
};

function FilterBar({
  windows,
  values,
  fallbackWindowId,
  onChange,
}: FilterBarProps) {
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <FilterField label="Meal window" htmlFor="filter-meal-window">
          <select
            id="filter-meal-window"
            value={values.meal_window_id ?? fallbackWindowId ?? ""}
            onChange={(e) =>
              onChange({
                ...values,
                meal_window_id: e.target.value || undefined,
              })
            }
            className={selectClasses}
          >
            {windows.windows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Status" htmlFor="filter-status">
          <select
            id="filter-status"
            value={values.status ?? ""}
            onChange={(e) =>
              onChange({
                ...values,
                status:
                  (e.target.value || undefined) as PaymentStatus | undefined,
              })
            }
            className={selectClasses}
          >
            <option value="">All statuses</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField
          label="Search (name, email, reference, notes)"
          htmlFor="filter-search"
        >
          <input
            id="filter-search"
            type="search"
            value={values.search}
            placeholder="Type to filter the table…"
            onChange={(e) => onChange({ ...values, search: e.target.value })}
            className={inputClasses}
          />
        </FilterField>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-(--bearhacks-muted)">
          Auto-refreshes every 30 seconds. Filters apply server-side; search
          filters the displayed rows.
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange({ ...DEFAULT_FILTER })}
        >
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
  search: string;
  onConfirm: (row: AdminPaymentRow) => Promise<void>;
  onRefund: (row: AdminPaymentRow) => Promise<void>;
  onUnconfirm: (row: AdminPaymentRow) => Promise<void>;
  onUnrefund: (row: AdminPaymentRow) => Promise<void>;
};

function PaymentsTableCard({
  query,
  search,
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
        cell: (ctx) => {
          const o = ctx.row.original;
          if (o.items.length === 0) {
            return (
              <span className="text-xs text-(--bearhacks-muted)">
                No placed items
              </span>
            );
          }
          return (
            <ul className="flex min-w-[18rem] flex-col gap-1.5">
              {o.items.map((it) => (
                <PaymentItemLine key={it.id} item={it} />
              ))}
            </ul>
          );
        },
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
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onUnconfirm(o)}
                >
                  Undo
                </Button>
              </div>
            );
          }
          if (o.status === "refunded") {
            return (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onUnrefund(o)}
                >
                  Undo
                </Button>
              </div>
            );
          }
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="pill"
                onClick={() => void onConfirm(o)}
              >
                Confirm
              </Button>
              <Button
                type="button"
                variant="ghost"
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

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const needle = filterValue.trim().toLowerCase();
      if (!needle) return true;
      const o = row.original;
      const haystack = [
        o.hacker_name,
        o.hacker_email,
        o.display_name,
        o.reference,
        o.notes,
        o.user_id,
        ...o.items.map((it) => it.detail),
      ]
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    },
  });

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-(--bearhacks-border) px-4 py-3">
        <CardTitle className="text-base">
          All <span className="bg-(--bearhacks-cream) px-1 rounded-sm">payments</span>
        </CardTitle>
        <CardDescription>
          Per-hacker payment bundles for the focused window.{" "}
          {query.data
            ? `${table.getFilteredRowModel().rows.length} of ${data.length} shown.`
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
                          className={`px-3 py-3 font-medium text-(--bearhacks-fg) ${
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
                              ? "w-[200px] min-w-[200px] text-right align-middle"
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

                  {o.items.length === 0 ? (
                    <p className="mt-2 text-xs text-(--bearhacks-muted)">
                      No placed items
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {o.items.map((it) => (
                        <PaymentItemLine key={it.id} item={it} />
                      ))}
                    </ul>
                  )}

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
                    <div className="mt-3 flex">
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full sm:w-auto"
                        onClick={() => void onUnconfirm(o)}
                      >
                        Undo confirmation
                      </Button>
                    </div>
                  ) : o.status === "refunded" ? (
                    <div className="mt-3 flex">
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full sm:w-auto"
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
                        className="w-full sm:w-auto"
                        onClick={() => void onConfirm(o)}
                      >
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full sm:w-auto"
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
    </Card>
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
