"use client";

/**
 * Super-admin food-team console.
 *
 * Three views over the same underlying orders set, picked from a single meal
 * window:
 *   - Prep summary: drink groups + variants + topping totals (barista view)
 *   - Pickup list: drinks → hackers (call-out view), with 30-minute batches
 *   - Orders table: TanStack Table v8 with controlled sort + global filter
 *     (audit/triage view, with per-row Fulfill/Unfill toggle)
 *
 * Filter changes pipe into React Query keys; results stay on screen via
 * `keepPreviousData`. The header carries a persistent "Export CSV" button so
 * the food team can pull a snapshot at any time without having to scroll.
 */

import { ApiError } from "@bearhacks/api-client";
import { useQueryClient } from "@tanstack/react-query";
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
  adminBobaKeys,
  downloadOrdersCsv,
  useAdminOrdersQuery,
  useAdminPickupListQuery,
  useAdminPrepSummaryQuery,
  useAdminWindowsQuery,
  useBulkDeleteOrdersMutation,
  useDevWindowSettingQuery,
  useToggleDevWindowMutation,
  useToggleOrderStatusMutation,
  type AdminOrderRow,
  type AdminWindow,
  type BulkDeleteItem,
  type WindowsResponse,
} from "@/lib/boba-queries";
import {
  ICE_LABELS,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_VALUES,
  SWEETNESS_LABELS,
  type BobaStatus,
} from "@/lib/boba-schema";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";
import { createStructuredLogger } from "@/lib/structured-logging";

const log = createStructuredLogger("admin/boba-orders");

type FilterValues = {
  meal_window_id?: string;
  status?: BobaStatus;
  search: string;
};

const DEFAULT_FILTER: FilterValues = {
  meal_window_id: undefined,
  status: undefined,
  search: "",
};

export default function AdminBobaOrdersPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const queryClient = useQueryClient();
  useDocumentTitle("Boba & Momo orders");

  const [user, setUser] = useState<User | null>(null);
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTER);
  // useDeferredValue keeps typing snappy while the table re-filters.
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
  const focusedWindow = useMemo(
    () => windowsQuery.data?.windows.find((w) => w.id === focusedWindowId),
    [windowsQuery.data, focusedWindowId],
  );

  const ordersQuery = useAdminOrdersQuery(
    {
      meal_window_id: focusedWindowId,
      status: filters.status,
    },
    isSuper,
  );

  const prepQuery = useAdminPrepSummaryQuery(focusedWindowId, isSuper);
  const pickupQuery = useAdminPickupListQuery(focusedWindowId, isSuper);

  const toggleStatusMutation = useToggleOrderStatusMutation();
  const bulkDeleteMutation = useBulkDeleteOrdersMutation();
  const confirm = useConfirm();

  // Composite key "kind:id" so we can select drinks and momos without
  // risking id collisions (they're separate tables / uuid spaces).
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBulkMode, setIsBulkMode] = useState(false);

  async function handleBulkDelete(items: BulkDeleteItem[]): Promise<void> {
    if (items.length === 0) return;
    const confirmed = await confirm({
      title: `Delete ${items.length} order(s)?`,
      description:
        "This permanently removes the selected drink/momo rows from the database. Payment bundles will be recomputed so hackers aren't charged for deleted items.",
      confirmLabel: `Delete ${items.length}`,
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      log("info", {
        event: "admin_boba_bulk_delete",
        actor,
        resourceId: "/admin/boba/orders/bulk-delete",
        result: "cancelled",
        count: items.length,
      });
      return;
    }

    log("info", {
      event: "admin_boba_bulk_delete",
      actor,
      resourceId: "/admin/boba/orders/bulk-delete",
      result: "requested",
      count: items.length,
    });
    try {
      const result = await bulkDeleteMutation.mutateAsync(items);
      const deletedKeys = new Set(
        result.deleted.map((d) => `${d.kind}:${d.id}`),
      );
      setSelectedRowKeys((prev) => {
        const next = new Set<string>();
        for (const key of prev) if (!deletedKeys.has(key)) next.add(key);
        return next;
      });
      log("info", {
        event: "admin_boba_bulk_delete",
        actor,
        resourceId: "/admin/boba/orders/bulk-delete",
        result: result.failed.length === 0 ? "success" : "partial",
        deletedCount: result.deleted.length,
        failedCount: result.failed.length,
      });
      if (result.failed.length === 0) {
        toast.success(`Deleted ${result.deleted.length} order(s).`);
        setIsBulkMode(false);
      } else if (result.deleted.length === 0) {
        toast.error(`Failed to delete ${result.failed.length} order(s).`);
      } else {
        toast.warning(
          `Deleted ${result.deleted.length}/${
            result.deleted.length + result.failed.length
          }. ${result.failed.length} failed.`,
        );
      }
    } catch (error) {
      log("error", {
        event: "admin_boba_bulk_delete",
        actor,
        resourceId: "/admin/boba/orders/bulk-delete",
        result: "error",
        error,
      });
      toast.error(
        error instanceof ApiError ? error.message : "Bulk delete failed",
      );
    }
  }

  async function handleExportCsv(): Promise<void> {
    if (!client) return;
    try {
      await downloadOrdersCsv(client, { meal_window_id: focusedWindowId });
      log("info", {
        event: "admin_boba_csv_export",
        actor,
        resourceId: focusedWindowId ?? "all",
        result: "success",
      });
      toast.success("CSV download started.");
    } catch (error) {
      log("error", {
        event: "admin_boba_csv_export",
        actor,
        resourceId: focusedWindowId ?? "all",
        result: "error",
        error,
      });
      toast.error(error instanceof Error ? error.message : "CSV export failed");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Boba & Momo orders"
        tone="marketing"
        subtitle="Live food-team console — prep summary, pickup list, and full order audit per meal window."
        backHref="/"
        showBack
        actions={
          isSuper ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleExportCsv()}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

      {!staff && (
        <Card>
          <CardTitle>Staff access required</CardTitle>
          <CardDescription className="mt-1">
            Sign in with a staff account to view boba orders.
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

      {isSuper ? <DevTestWindowToggleCard enabled={isSuper} actor={actor} /> : null}

      {isSuper && windowsQuery.data ? (
        <FilterBar
          windows={windowsQuery.data}
          values={filters}
          fallbackWindowId={fallbackWindowId}
          onChange={setFilters}
        />
      ) : null}

      {isSuper ? (
        <PrepSummaryCard
          query={prepQuery}
          windowLabel={windowLabel(windowsQuery.data, focusedWindowId) ?? "—"}
        />
      ) : null}

      {isSuper && focusedWindow ? (
        <PickupListCard
          query={pickupQuery}
          windowLabel={focusedWindow.label}
          windowOpensAt={focusedWindow.opens_at}
        />
      ) : null}

      {isSuper ? (
        <OrdersTableCard
          query={ordersQuery}
          windows={windowsQuery.data?.windows ?? []}
          search={deferredSearch}
          onToggleStatus={async (row, nextStatus) => {
            // Optimistic toast — user sees the flip immediately.
            const verb = nextStatus === "fulfilled" ? "Fulfilled" : "Unfulfilled";
            try {
              await toggleStatusMutation.mutateAsync({ row, nextStatus });
              log("info", {
                event: "admin_boba_status_toggle",
                actor,
                resourceId: row.id,
                kind: row.kind,
                nextStatus,
                result: "success",
              });
              toast.success(
                `${verb} ${row.kind === "drink" ? "drink" : "momo order"}.`,
              );
              void queryClient.invalidateQueries({ queryKey: adminBobaKeys.all });
            } catch (error) {
              log("error", {
                event: "admin_boba_status_toggle",
                actor,
                resourceId: row.id,
                kind: row.kind,
                nextStatus,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError
                  ? error.message
                  : `Failed to ${verb.toLowerCase()}`,
              );
            }
          }}
          onExportCsv={handleExportCsv}
          isBulkMode={isBulkMode}
          onSetBulkMode={setIsBulkMode}
          selectedRowKeys={selectedRowKeys}
          onSelectedRowKeysChange={setSelectedRowKeys}
          onBulkDelete={handleBulkDelete}
          isBulkDeleting={bulkDeleteMutation.isPending}
        />
      ) : null}
    </main>
  );
}

const DEV_WINDOW_MAX_ORDERS_HARD_CEILING = 50;

/**
 * Two-control card for the dev-test meal-window feature flags.
 *
 * Lets a super-admin (a) flip the synthetic dev/test window on/off without a
 * redeploy and (b) tune the per-user drink cap on that window. The on/off
 * flag is optimistic so the switch feels instant; the cap uses a discrete
 * "Save" press so admins don't fire a write per keystroke. Both knobs share
 * the same `useToggleDevWindowMutation` (PATCH-style payload) and roll back
 * on error.
 *
 * Real meal windows are always capped at 1/user (DB partial unique index);
 * the cap field here only affects `dev-test-window`.
 */
function DevTestWindowToggleCard({
  enabled,
  actor,
}: {
  enabled: boolean;
  actor: string;
}) {
  const settingQuery = useDevWindowSettingQuery(enabled);
  const mutation = useToggleDevWindowMutation();

  const isOn = Boolean(settingQuery.data?.enabled);
  const serverCap = settingQuery.data?.max_orders ?? 1;
  const isLoading = settingQuery.isLoading;
  const isPending = mutation.isPending;

  const [capDraft, setCapDraft] = useState<string>(String(serverCap));
  useEffect(() => {
    setCapDraft(String(serverCap));
  }, [serverCap]);

  const parsedCap = Number.parseInt(capDraft, 10);
  const capDirty = !Number.isNaN(parsedCap) && parsedCap !== serverCap;
  const capValid =
    Number.isInteger(parsedCap) &&
    parsedCap >= 1 &&
    parsedCap <= DEV_WINDOW_MAX_ORDERS_HARD_CEILING;

  return (
    <Card className="border-dashed">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">Dev / test meal window</CardTitle>
            <CardDescription>
              When on, the synthetic dev-test window appears in the hacker
              portal and admin dropdowns so you can place real orders against
              it. Off hides it without losing historical data.
            </CardDescription>
            <p className="mt-1 text-xs text-(--bearhacks-muted)">
              Status:{" "}
              <span
                className={
                  isOn
                    ? "font-semibold text-(--bearhacks-success-fg)"
                    : "font-semibold text-(--bearhacks-muted)"
                }
              >
                {isLoading ? "Loading…" : isOn ? "Enabled" : "Disabled"}
              </span>
            </p>
          </div>
          <Button
            variant={isOn ? "ghost" : "primary"}
            disabled={isLoading || isPending}
            onClick={() => {
              const next = !isOn;
              toast.promise(mutation.mutateAsync({ enabled: next }), {
                loading: next
                  ? "Enabling dev window…"
                  : "Disabling dev window…",
                success: () => {
                  log("info", {
                    event: "admin_boba_dev_window_toggle",
                    actor,
                    resourceId: "dev-test-window",
                    result: "success",
                  });
                  return next ? "Dev window enabled." : "Dev window disabled.";
                },
                error: (error) => {
                  log("error", {
                    event: "admin_boba_dev_window_toggle",
                    actor,
                    resourceId: "dev-test-window",
                    result: "error",
                    error,
                  });
                  return error instanceof ApiError
                    ? error.message
                    : "Failed to update dev window.";
                },
              });
            }}
          >
            {isPending
              ? "Saving…"
              : isOn
                ? "Disable dev window"
                : "Enable dev window"}
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t border-(--bearhacks-border) pt-4">
          <label
            htmlFor="dev-window-max-orders"
            className="text-sm font-medium text-(--bearhacks-fg)"
          >
            Drinks/momos per hacker (dev window only)
          </label>
          <p className="text-xs text-(--bearhacks-muted)">
            Real meal windows are always capped at one combined drink/momo per
            hacker. This cap applies to{" "}
            <span className="font-semibold">all hackers</span> ordering against
            the dev-test window. Range: 1–{DEV_WINDOW_MAX_ORDERS_HARD_CEILING}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1 sm:max-w-40">
              <input
                id="dev-window-max-orders"
                type="number"
                min={1}
                max={DEV_WINDOW_MAX_ORDERS_HARD_CEILING}
                step={1}
                inputMode="numeric"
                value={capDraft}
                disabled={isLoading || isPending}
                onChange={(e) => setCapDraft(e.target.value)}
                className={inputClasses}
              />
              {!capValid && capDraft.trim() !== "" ? (
                <p className="text-xs text-(--bearhacks-danger)">
                  Must be a whole number between 1 and{" "}
                  {DEV_WINDOW_MAX_ORDERS_HARD_CEILING}.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!capDirty || !capValid || isPending || isLoading}
                onClick={() => {
                  toast.promise(
                    mutation.mutateAsync({ max_orders: parsedCap }),
                    {
                      loading: "Saving cap…",
                      success: (data) => {
                        log("info", {
                          event: "admin_boba_dev_window_max_orders",
                          actor,
                          resourceId: "dev-test-window",
                          result: "success",
                          maxOrders: data.max_orders,
                        });
                        return `Cap set to ${data.max_orders} per hacker.`;
                      },
                      error: (error) => {
                        log("error", {
                          event: "admin_boba_dev_window_max_orders",
                          actor,
                          resourceId: "dev-test-window",
                          result: "error",
                          error,
                        });
                        return error instanceof ApiError
                          ? error.message
                          : "Failed to update cap.";
                      },
                    },
                  );
                }}
              >
                {isPending && capDirty ? "Saving…" : "Save cap"}
              </Button>
              {capDirty ? (
                <Button
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setCapDraft(String(serverCap))}
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-(--bearhacks-muted)">
            Currently saved:{" "}
            <span className="font-semibold text-(--bearhacks-fg)">
              {isLoading ? "…" : `${serverCap} item${serverCap === 1 ? "" : "s"}`}
            </span>{" "}
            per hacker.
          </p>
        </div>
      </div>
    </Card>
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
// Filter bar — uncontrolled inputs with debounced state
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
            {windows.windows.map((w) => {
              const counts = windows.counts_by_window[w.id] ?? {
                placed: 0,
                cancelled: 0,
                fulfilled: 0,
                total: 0,
              };
              return (
                <option key={w.id} value={w.id}>
                  {w.label} ({counts.placed} placed / {counts.total} total)
                </option>
              );
            })}
          </select>
        </FilterField>

        <FilterField label="Status" htmlFor="filter-status">
          <select
            id="filter-status"
            value={values.status ?? ""}
            onChange={(e) =>
              onChange({
                ...values,
                status: (e.target.value || undefined) as BobaStatus | undefined,
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
          label="Search (name, email, item, notes)"
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
          Search runs across hacker name, email, item, and notes. Use the
          Export CSV button at the top to grab the current window snapshot.
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
// Prep summary
// ---------------------------------------------------------------------------

type PrepSummaryCardProps = {
  query: ReturnType<typeof useAdminPrepSummaryQuery>;
  windowLabel: string;
};

function PrepSummaryCard({ query, windowLabel }: PrepSummaryCardProps) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>
          Prep <span className="bg-(--bearhacks-cream) px-1 rounded-sm">summary</span>
        </CardTitle>
        <span className="text-xs text-(--bearhacks-muted)">{windowLabel}</span>
      </div>
      <CardDescription className="mt-1">
        Drinks grouped by unique customization variant. Counts are live for
        placed orders only.
      </CardDescription>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-(--bearhacks-danger)">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load prep summary"}
        </p>
      ) : !query.data || query.data.total_orders === 0 ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">
          No placed orders for this window yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm font-semibold text-(--bearhacks-fg)">
            Total drinks to make: {query.data.total_orders}
          </p>
          <ul className="flex flex-col gap-3">
            {query.data.drinks.map((drink) => (
              <li
                key={drink.drink_id}
                className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-(--bearhacks-title)">
                    {drink.drink_label}
                  </span>
                  <span className="text-xs font-semibold text-(--bearhacks-text-marketing)/80">
                    ×{drink.total}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {drink.variants.map((v, idx) => (
                    <li
                      key={`${v.drink_id}-${idx}`}
                      className="flex items-baseline justify-between gap-2 text-xs text-(--bearhacks-fg)"
                    >
                      <span>{v.description}</span>
                      <span className="font-semibold">×{v.count}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {query.data.topping_totals.length > 0 ? (
            <div className="rounded-(--bearhacks-radius-md) border border-dashed border-(--bearhacks-border) p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                Topping totals
              </p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs text-(--bearhacks-fg)">
                {query.data.topping_totals.map((t) => (
                  <li
                    key={t.topping_id}
                    className="rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent-soft) px-3 py-1"
                  >
                    {t.label} × {t.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pickup list with 30-minute batch grouping
// ---------------------------------------------------------------------------

type PickupListCardProps = {
  query: ReturnType<typeof useAdminPickupListQuery>;
  windowLabel: string;
  windowOpensAt: string;
};

function PickupListCard({
  query,
  windowLabel,
  windowOpensAt,
}: PickupListCardProps) {
  // Group all pickup rows by 30-minute batch derived from the window's
  // opens_at, using the order's *id* (UUID) as a deterministic-but-spread
  // bucket — there's no per-order placement timestamp on the pickup rows,
  // so we'd otherwise group everything into a single batch. Keeping the
  // grouping deterministic + visible per row helps the food team rotate
  // pickups in 30-minute waves without thinking about it.
  const data = query.data;
  const grouped = useMemo(() => {
    if (!data) return [];
    const opensMs = new Date(windowOpensAt).getTime();
    const batches = new Map<string, typeof data.drinks>();
    for (const drink of data.drinks) {
      for (const row of drink.rows) {
        const bucketIdx = bucketForId(row.order_id);
        const bucketStart = new Date(opensMs + bucketIdx * 30 * 60_000);
        const key = bucketStart.toISOString();
        if (!batches.has(key)) batches.set(key, []);
        const batchDrinks = batches.get(key)!;
        let bd = batchDrinks.find((d) => d.drink_id === drink.drink_id);
        if (!bd) {
          bd = {
            drink_id: drink.drink_id,
            drink_label: drink.drink_label,
            count: 0,
            rows: [],
          };
          batchDrinks.push(bd);
        }
        bd.count += 1;
        bd.rows.push(row);
      }
    }
    return Array.from(batches.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [data, windowOpensAt]);

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>
          Pickup <span className="bg-(--bearhacks-cream) px-1 rounded-sm">list</span>
        </CardTitle>
        <span className="text-xs text-(--bearhacks-muted)">{windowLabel}</span>
      </div>
      <CardDescription className="mt-1">
        Call hackers up by drink, batched into 30-minute waves so you can
        rotate pickups smoothly through the window.
      </CardDescription>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-(--bearhacks-danger)">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load pickup list"}
        </p>
      ) : !query.data || query.data.total_orders === 0 ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">
          No placed orders for this window yet.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {grouped.map(([startIso, drinks]) => {
            const start = new Date(startIso);
            const end = new Date(start.getTime() + 30 * 60_000);
            const rangeLabel = `${formatBatchTime(start)} – ${formatBatchTime(end)}`;
            const batchTotal = drinks.reduce((sum, d) => sum + d.count, 0);
            return (
              <li
                key={startIso}
                className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) p-3"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-(--bearhacks-title)">
                    Batch {rangeLabel}
                  </span>
                  <span className="text-xs text-(--bearhacks-muted)">
                    {batchTotal} drink{batchTotal === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {drinks.map((drink) => (
                    <li
                      key={drink.drink_id}
                      className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) p-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-(--bearhacks-title)">
                          {drink.drink_label}
                        </span>
                        <span className="text-xs text-(--bearhacks-text-marketing)/80">
                          {drink.count} hacker{drink.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="mt-2 flex flex-col divide-y divide-(--bearhacks-border)">
                        {drink.rows.map((row) => (
                          <li
                            key={row.order_id}
                            className="grid gap-1 py-2 sm:grid-cols-[1fr,auto]"
                          >
                            <div>
                              <p className="text-sm font-semibold text-(--bearhacks-fg)">
                                {row.name}
                              </p>
                              <p className="text-xs text-(--bearhacks-muted)">
                                {SWEETNESS_LABELS[row.sweetness] ??
                                  `${row.sweetness}%`}{" "}
                                · {ICE_LABELS[row.ice] ?? row.ice}
                                {row.topping_labels.length > 0
                                  ? ` · ${row.topping_labels.join(", ")}`
                                  : " · no toppings"}
                              </p>
                              {row.notes ? (
                                <p className="text-xs italic text-(--bearhacks-text-marketing)/70">
                                  &ldquo;{row.notes}&rdquo;
                                </p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// Stable per-id bucket index in [0, 8) so 30-min batches across a 4-hour
// window spread roughly evenly. UUIDs aren't time-ordered, so we hash from
// the first 8 hex chars.
function bucketForId(id: string): number {
  const hex = id.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "0";
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return 0;
  return n % 8;
}

function formatBatchTime(d: Date): string {
  return d.toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });
}

// ---------------------------------------------------------------------------
// Orders table
// ---------------------------------------------------------------------------

type OrdersTableCardProps = {
  query: ReturnType<typeof useAdminOrdersQuery>;
  windows: AdminWindow[];
  search: string;
  onToggleStatus: (
    row: AdminOrderRow,
    nextStatus: "placed" | "fulfilled",
  ) => Promise<void>;
  onExportCsv: () => Promise<void> | void;
  isBulkMode: boolean;
  onSetBulkMode: (next: boolean) => void;
  selectedRowKeys: Set<string>;
  onSelectedRowKeysChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onBulkDelete: (items: BulkDeleteItem[]) => Promise<void>;
  isBulkDeleting: boolean;
};

const rowKey = (row: Pick<AdminOrderRow, "kind" | "id">): string =>
  `${row.kind}:${row.id}`;

function OrdersTableCard({
  query,
  windows,
  search,
  onToggleStatus,
  onExportCsv,
  isBulkMode,
  onSetBulkMode,
  selectedRowKeys,
  onSelectedRowKeysChange,
  onBulkDelete,
  isBulkDeleting,
}: OrdersTableCardProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created_at", desc: true },
  ]);

  const windowLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of windows) m.set(w.id, w.label);
    return m;
  }, [windows]);

  // Wrapped in useMemo so `??` doesn't synthesize a fresh [] each render and
  // invalidate every downstream memo (selectedItems, column deps, …).
  const data = useMemo(() => query.data?.orders ?? [], [query.data]);

  const columns = useMemo<ColumnDef<AdminOrderRow>[]>(
    () => [
      ...(isBulkMode
        ? [
            {
              id: "select",
              enableSorting: false,
              // Derive the "all visible" key set from the table's *filtered*
              // row model — not raw `data` — so that typing into search and
              // clicking this checkbox only queues the currently-visible
              // rows for deletion. Using `data` here would silently select
              // every row hidden behind the filter, which could nuke an
              // entire meal window when an admin meant to target one hacker.
              header: ({ table }) => {
                const filteredKeys = table
                  .getFilteredRowModel()
                  .rows.map((row) => rowKey(row.original));
                const allSelected =
                  filteredKeys.length > 0 &&
                  filteredKeys.every((k) => selectedRowKeys.has(k));
                const someSelected =
                  !allSelected &&
                  filteredKeys.some((k) => selectedRowKeys.has(k));
                return (
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders"
                    className="size-4 cursor-pointer accent-(--bearhacks-primary)"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectedRowKeysChange(new Set(filteredKeys));
                      } else {
                        onSelectedRowKeysChange(new Set());
                      }
                    }}
                    disabled={filteredKeys.length === 0 || isBulkDeleting}
                  />
                );
              },
              cell: (ctx: { row: { original: AdminOrderRow } }) => {
                const key = rowKey(ctx.row.original);
                const checked = selectedRowKeys.has(key);
                return (
                  <input
                    type="checkbox"
                    aria-label={`Select ${ctx.row.original.kind} ${ctx.row.original.id}`}
                    className="size-4 cursor-pointer accent-(--bearhacks-primary)"
                    checked={checked}
                    onChange={(e) => {
                      onSelectedRowKeysChange((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                    }}
                    disabled={isBulkDeleting}
                  />
                );
              },
            } satisfies ColumnDef<AdminOrderRow>,
          ]
        : []),
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
        accessorKey: "kind",
        header: "Kind",
        cell: (ctx) => {
          const k = ctx.row.original.kind;
          const isMomo = k === "momo";
          return (
            <span
              className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${
                isMomo
                  ? "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)"
                  : "bg-(--bearhacks-accent-soft) text-(--bearhacks-primary) border border-(--bearhacks-border)"
              }`}
            >
              {isMomo ? "Momos" : "Drink"}
            </span>
          );
        },
      },
      {
        accessorKey: "size_label",
        header: "Size",
        cell: (ctx) => (
          <span className="text-xs text-(--bearhacks-muted)">
            {ctx.row.original.size_label ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "detail",
        header: "Detail",
        cell: (ctx) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-(--bearhacks-fg)">
              {ctx.row.original.detail}
            </span>
            {ctx.row.original.notes ? (
              <span className="text-xs italic text-(--bearhacks-text-marketing)/70">
                &ldquo;{ctx.row.original.notes}&rdquo;
              </span>
            ) : null}
          </div>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "amount_cents",
        header: "$",
        cell: (ctx) => (
          <span className="text-xs font-semibold text-(--bearhacks-fg)">
            ${(ctx.row.original.amount_cents / 100).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "meal_window_id",
        header: "Window",
        cell: (ctx) => (
          <span className="text-xs text-(--bearhacks-muted)">
            {windowLabelById.get(ctx.row.original.meal_window_id) ??
              ctx.row.original.meal_window_id}
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
        accessorKey: "created_at",
        header: "Placed",
        cell: (ctx) => (
          <span className="text-xs text-(--bearhacks-muted)">
            {new Date(ctx.row.original.created_at).toLocaleString("en-CA", {
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              day: "numeric",
              timeZone: "America/Toronto",
            })}
          </span>
        ),
        sortingFn: (a, b) =>
          new Date(a.original.created_at).getTime() -
          new Date(b.original.created_at).getTime(),
      },
      {
        id: "actions",
        header: "",
        cell: (ctx) => {
          const o = ctx.row.original;
          if (o.status === "cancelled") {
            return (
              <span className="text-xs text-(--bearhacks-muted)">—</span>
            );
          }
          const isFulfilled = o.status === "fulfilled";
          return (
            <Button
              type="button"
              variant={isFulfilled ? "ghost" : "pill"}
              onClick={() =>
                void onToggleStatus(o, isFulfilled ? "placed" : "fulfilled")
              }
            >
              {isFulfilled ? "Unfulfill" : "Fulfill"}
            </Button>
          );
        },
        enableSorting: false,
      },
    ],
    [
      windowLabelById,
      onToggleStatus,
      isBulkMode,
      selectedRowKeys,
      onSelectedRowKeysChange,
      isBulkDeleting,
    ],
  );

  // TanStack Table returns identity-unstable functions that React Compiler
  // refuses to memoize. That's expected for this library — opt out of the
  // skip-warning so lint stays clean.
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
        o.detail,
        o.notes,
        o.drink_id,
        o.size_label,
        ...(o.topping_ids ?? []),
        o.filling,
        o.sauce,
        o.user_id,
      ]
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    },
  });

  // Intersect the selection with the filtered row model so the Delete button's
  // count and the confirmation dialog only ever reflect rows the admin can
  // currently *see*. Prevents the "I searched for one hacker and select-all
  // silently queued the whole window" class of accident described in the
  // header comment above. Recomputed each render — O(filteredN) on a few
  // hundred rows is trivially cheap, and memoizing it against the right deps
  // is fiddly because `table.getFilteredRowModel()` isn't a stable reference.
  const selectedItems: BulkDeleteItem[] = table
    .getFilteredRowModel()
    .rows.filter((row) => selectedRowKeys.has(rowKey(row.original)))
    .map((row) => ({ kind: row.original.kind, id: row.original.id }));

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-(--bearhacks-border) px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            All <span className="bg-(--bearhacks-cream) px-1 rounded-sm">orders</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {isBulkMode ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-(--bearhacks-danger)"
                  onClick={() => void onBulkDelete(selectedItems)}
                  disabled={selectedItems.length === 0 || isBulkDeleting}
                >
                  {isBulkDeleting
                    ? `Deleting ${selectedItems.length}…`
                    : `Delete (${selectedItems.length})`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onSetBulkMode(false);
                    onSelectedRowKeysChange(new Set());
                  }}
                  disabled={isBulkDeleting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onSetBulkMode(true)}
                disabled={data.length === 0}
              >
                Bulk delete
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void onExportCsv()}
            >
              Export CSV
            </Button>
          </div>
        </div>
        <CardDescription>
          {isBulkMode
            ? "Select the rows to permanently delete. Use the header checkbox to toggle all visible rows."
            : "Sortable, searchable, with per-row Fulfill / Unfulfill toggle."}{" "}
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
            : "Failed to load orders"}
        </p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
          No orders match the current filters.
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
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className="px-3 py-3 font-medium text-(--bearhacks-fg)"
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
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 p-3 sm:hidden">
            {table.getRowModel().rows.map((row) => {
              const o = row.original;
              const key = rowKey(o);
              const checked = selectedRowKeys.has(key);
              const isFulfilled = o.status === "fulfilled";
              const isCancelled = o.status === "cancelled";
              const isMomo = o.kind === "momo";
              return (
                <li
                  key={row.id}
                  className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {isBulkMode ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${o.kind} ${o.id}`}
                          className="mt-1 size-4 shrink-0 cursor-pointer accent-(--bearhacks-primary)"
                          checked={checked}
                          onChange={(e) => {
                            onSelectedRowKeysChange((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          disabled={isBulkDeleting}
                        />
                      ) : null}
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

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-xs font-semibold ${
                        isMomo
                          ? "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)"
                          : "bg-(--bearhacks-accent-soft) text-(--bearhacks-primary) border border-(--bearhacks-border)"
                      }`}
                    >
                      {isMomo ? "Momos" : "Drink"}
                    </span>
                    {o.size_label ? (
                      <span className="text-xs text-(--bearhacks-muted)">
                        {o.size_label}
                      </span>
                    ) : null}
                    <span className="text-xs font-semibold text-(--bearhacks-fg)">
                      ${(o.amount_cents / 100).toFixed(2)}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-(--bearhacks-fg) wrap-break-word">
                    {o.detail}
                  </p>
                  {o.notes ? (
                    <p className="mt-1 text-xs italic text-(--bearhacks-text-marketing)/70 wrap-break-word">
                      &ldquo;{o.notes}&rdquo;
                    </p>
                  ) : null}

                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                      Window
                    </dt>
                    <dd className="text-(--bearhacks-fg) wrap-break-word">
                      {windowLabelById.get(o.meal_window_id) ?? o.meal_window_id}
                    </dd>
                    <dt className="uppercase tracking-wide text-(--bearhacks-muted)">
                      Placed
                    </dt>
                    <dd className="text-(--bearhacks-fg)">
                      {new Date(o.created_at).toLocaleString("en-CA", {
                        hour: "numeric",
                        minute: "2-digit",
                        month: "short",
                        day: "numeric",
                        timeZone: "America/Toronto",
                      })}
                    </dd>
                  </dl>

                  {!isCancelled && !isBulkMode ? (
                    <div className="mt-3 flex">
                      <Button
                        type="button"
                        variant={isFulfilled ? "ghost" : "pill"}
                        className="w-full sm:w-auto"
                        onClick={() =>
                          void onToggleStatus(
                            o,
                            isFulfilled ? "placed" : "fulfilled",
                          )
                        }
                      >
                        {isFulfilled ? "Unfulfill" : "Fulfill"}
                      </Button>
                    </div>
                  ) : null}
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
