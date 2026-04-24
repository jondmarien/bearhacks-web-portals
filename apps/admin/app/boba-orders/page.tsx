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
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import type { User } from "@supabase/supabase-js";
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
  useDevWindowsListQuery,
  useToggleDevWindowByIdMutation,
  useToggleDevWindowMutation,
  useToggleOrderStatusMutation,
  type AdminOrderRow,
  type AdminWindow,
  type BulkDeleteItem,
  type DevWindowListItem,
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

/**
 * "Fulfill" soft-gate for the admin orders table.
 *
 * Fulfilling means "food has been handed over," so the food team should
 * only be able to mark it once the hacker has paid AND an admin has
 * confirmed the e-transfer on ``/admin/boba/boba-payments``. Mirrors
 * ``canAdminConfirm`` on the payments page which gates one step
 * earlier (on the hacker having tapped "I sent the e-transfer").
 *
 * Already-fulfilled rows stay toggleable so a misclick can be undone —
 * the button reads "Unfulfill" in that state and flipping back to
 * ``placed`` is always safe regardless of payment state.
 */
function canAdminFulfill(row: AdminOrderRow): boolean {
  if (row.status === "fulfilled") return true;
  return row.payment_status === "confirmed";
}

const FULFILL_DISABLED_REASON =
  "Waiting on payment — confirm the hacker's e-transfer on the Boba & Momo payments page before fulfilling this order.";

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

      {isSuper ? <DevWindowsPanel enabled={isSuper} actor={actor} /> : null}

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

      {/*
        Filters live directly above the All orders card because status
        + search only drive that card's contents — the meal window picker
        also feeds prep summary and pickup list above, but anchoring the
        whole bar here keeps the status + search controls next to the
        only surface they affect and matches the "filters sit with the
        table they filter" layout the profile directory and payments
        consoles use.
      */}
      {isSuper && windowsQuery.data ? (
        <FilterBar
          windows={windowsQuery.data}
          values={filters}
          fallbackWindowId={fallbackWindowId}
          onChange={setFilters}
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
 * Tabbed admin surface for every dev window in the schedule.
 *
 * Mirrors the hacker portal's ``BobaPortalCard`` tab pattern (Order /
 * Payment) so super-admins see a familiar switcher. One tab per dev
 * window — dev window 0 (``dev-test-window``) stays first and owns the
 * unique per-user drink-cap knob; every other dev window is a plain
 * on/off toggle because secondary dev windows behave exactly like real
 * event windows (1 drink + 1 momo per hacker, no shared cap).
 *
 * Renders nothing when the schedule has no dev windows, so once the
 * dev windows are removed after BearHacks ships this whole control
 * surface disappears with zero follow-up cleanup.
 */
function DevWindowsPanel({
  enabled,
  actor,
}: {
  enabled: boolean;
  actor: string;
}) {
  const listQuery = useDevWindowsListQuery(enabled);

  // Canonical tab order: dev window 0 first (is_primary=true), then every
  // secondary dev window in schedule order. Numbered labels fall out of the
  // index so adding dev-window-2 later auto-labels as "Dev window 2".
  const tabs = useMemo(() => {
    const rows = listQuery.data?.dev_windows ?? [];
    const primary = rows.filter((r) => r.is_primary);
    const secondary = rows.filter((r) => !r.is_primary);
    return [...primary, ...secondary].map((row, index) => ({
      ...row,
      numberedLabel: `Dev window ${index}`,
    }));
  }, [listQuery.data]);

  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);

  // Seed / reconcile the selected tab when the dev-window list changes.
  // Using the "adjusting state from props" render-phase pattern instead of
  // ``useEffect`` so the panel doesn't flash an inconsistent tab during
  // the first commit after data arrives.
  const firstTabId = tabs[0]?.window_id ?? null;
  const activeStillPresent =
    activeWindowId != null && tabs.some((t) => t.window_id === activeWindowId);
  if (!activeStillPresent && firstTabId !== activeWindowId) {
    setActiveWindowId(firstTabId);
  }

  const baseId = useId();

  if (listQuery.isLoading) {
    return (
      <Card className="border-dashed">
        <CardTitle className="text-base">Dev windows</CardTitle>
        <CardDescription className="mt-1">Loading…</CardDescription>
      </Card>
    );
  }

  if (tabs.length === 0) return null;

  const activeTab =
    tabs.find((t) => t.window_id === activeWindowId) ?? tabs[0];

  return (
    <Card className="border-dashed">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Dev windows</CardTitle>
          <CardDescription>
            Flip dev windows on/off without a redeploy. Dev window 0
            (<span className="font-mono">dev-test-window</span>) is the
            ONLY dev window with a configurable multi-drink cap — every
            other dev window behaves like a real event window (1 drink +
            1 momo per hacker).
          </CardDescription>
        </div>

        <DevWindowsTabList
          baseId={baseId}
          tabs={tabs}
          activeWindowId={activeTab.window_id}
          onChange={setActiveWindowId}
        />

        <div
          id={`${baseId}-panel-${activeTab.window_id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeTab.window_id}`}
        >
          {activeTab.is_primary ? (
            <DevWindow0PanelContent enabled={enabled} actor={actor} />
          ) : (
            <SecondaryDevWindowPanelContent
              row={activeTab}
              actor={actor}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

type DevWindowTab = DevWindowListItem & { numberedLabel: string };

function DevWindowsTabList({
  baseId,
  tabs,
  activeWindowId,
  onChange,
}: {
  baseId: string;
  tabs: readonly DevWindowTab[];
  activeWindowId: string;
  onChange: (nextId: string) => void;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Left / Right / Home / End — WAI-ARIA tablist keyboard pattern. Matches
  // the ``TabList`` in ``apps/me/components/boba-portal-card.tsx`` so the
  // two surfaces behave the same for screen-reader users.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((t) => t.window_id === activeWindowId);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    const nextId = tabs[nextIndex]?.window_id;
    if (nextId) {
      onChange(nextId);
      buttonRefs.current[nextId]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Dev windows"
      className="flex flex-wrap gap-1 rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) p-1"
    >
      {tabs.map((tab) => {
        const selected = tab.window_id === activeWindowId;
        const base =
          "relative flex-1 min-w-0 inline-flex min-h-(--bearhacks-touch-min) items-center justify-center gap-2 rounded-(--bearhacks-radius-pill) px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--bearhacks-focus-ring)";
        const tone = selected
          ? "bg-(--bearhacks-accent) text-(--bearhacks-primary) shadow-sm"
          : "text-(--bearhacks-muted) hover:text-(--bearhacks-fg) hover:bg-(--bearhacks-surface)";
        return (
          <button
            key={tab.window_id}
            ref={(el) => {
              buttonRefs.current[tab.window_id] = el;
            }}
            id={`${baseId}-tab-${tab.window_id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${tab.window_id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.window_id)}
            onKeyDown={onKeyDown}
            className={`${base} ${tone}`}
          >
            <span className="truncate">{tab.numberedLabel}</span>
            {/*
             * Small "on" dot — mirrors the ``paymentNeedsAttention``
             * pattern in the hacker portal card. Uses the success token
             * so "enabled" reads the same colour as the per-tab status
             * label below, and stays invisible when a window is off so
             * the tablist doesn't get visually noisy.
             */}
            {tab.enabled ? (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-(--bearhacks-success-fg)"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Enable + drink-cap controls for dev window 0 (``dev-test-window``).
 *
 * Dev window 0 is the ONLY dev window with a configurable multi-drink
 * cap — it reuses the richer ``/admin/boba/settings/dev-window`` endpoint
 * (enable flag + max_orders in one payload). The on/off flag is
 * optimistic so the switch feels instant; the cap uses a discrete "Save"
 * press so admins don't fire a write per keystroke.
 *
 * Real meal windows are always capped at 1/user (DB partial unique index);
 * the cap field here only affects `dev-test-window`.
 */
function DevWindow0PanelContent({
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-(--bearhacks-fg)">
            Dev window 0 ·{" "}
            <code className="font-mono">dev-test-window</code>
          </p>
          <p className="text-xs text-(--bearhacks-muted)">
            When on, dev window 0 appears in the hacker portal and admin
            dropdowns so you can place real orders against it. Off hides
            it without losing historical data. This is the ONLY dev
            window that allows multiple drinks per hacker — other dev
            window tabs behave like real event windows (1 drink + 1
            momo).
          </p>
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
              ? "Disable dev window 0"
              : "Enable dev window 0"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-(--bearhacks-border) pt-4">
        <label
          htmlFor="dev-window-max-orders"
          className="text-sm font-medium text-(--bearhacks-fg)"
        >
          Drinks/momos per hacker (dev window 0 only)
        </label>
        <p className="text-xs text-(--bearhacks-muted)">
          Real meal windows and other dev windows are always capped at
          one combined drink/momo per hacker. This cap applies to{" "}
          <span className="font-semibold">all hackers</span> ordering
          against <span className="font-mono">dev-test-window</span> and
          is not available on any other dev window. Range: 1–
          {DEV_WINDOW_MAX_ORDERS_HARD_CEILING}.
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
  );
}

/**
 * Plain on/off toggle for a single *secondary* dev window (dev-window-1,
 * future dev-window-2, …).
 *
 * Secondary dev windows behave exactly like real event windows (1 drink
 * + 1 momo per hacker, no shared cap), so there is no per-user cap to
 * configure — just a single enable switch. The richer cap knob lives on
 * dev window 0's panel and is intentionally not duplicated here.
 */
function SecondaryDevWindowPanelContent({
  row,
  actor,
}: {
  row: DevWindowListItem;
  actor: string;
}) {
  const mutation = useToggleDevWindowByIdMutation();
  const isPending =
    mutation.isPending && mutation.variables?.windowId === row.window_id;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-(--bearhacks-fg)">
          {row.label}
        </p>
        <p className="text-xs text-(--bearhacks-muted)">
          Behaves like a real event window (1 drink + 1 momo per hacker,
          no shared cap). Flip on to smoke-test real-event semantics
          without waiting for <span className="font-mono">fri-dinner</span>
          {" "}to open. Off hides it from the hacker portal and admin
          dropdowns without losing historical data.
        </p>
        <p className="mt-1 text-xs text-(--bearhacks-muted)">
          <span className="font-mono">{row.window_id}</span> · Status:{" "}
          <span
            className={
              row.enabled
                ? "font-semibold text-(--bearhacks-success-fg)"
                : "font-semibold text-(--bearhacks-muted)"
            }
          >
            {row.enabled ? "Enabled" : "Disabled"}
          </span>
        </p>
      </div>
      <Button
        variant={row.enabled ? "ghost" : "primary"}
        disabled={mutation.isPending}
        onClick={() => {
          const next = !row.enabled;
          toast.promise(
            mutation.mutateAsync({
              windowId: row.window_id,
              enabled: next,
            }),
            {
              loading: next
                ? `Enabling ${row.window_id}…`
                : `Disabling ${row.window_id}…`,
              success: () => {
                log("info", {
                  event: "admin_boba_dev_window_enable",
                  actor,
                  resourceId: row.window_id,
                  result: "success",
                  enabled: next,
                });
                return next
                  ? `${row.label} enabled.`
                  : `${row.label} disabled.`;
              },
              error: (error) => {
                log("error", {
                  event: "admin_boba_dev_window_enable",
                  actor,
                  resourceId: row.window_id,
                  result: "error",
                  error,
                });
                return error instanceof ApiError
                  ? error.message
                  : "Failed to update dev window.";
              },
            },
          );
        }}
      >
        {isPending
          ? "Saving…"
          : row.enabled
            ? "Disable"
            : "Enable"}
      </Button>
    </div>
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
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {query.data.topping_totals.map((t) => (
                  <li
                    key={t.topping_id}
                    className="rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-accent-soft) px-3 py-1 font-semibold text-(--bearhacks-primary)"
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

  // Client-side pagination — the `/admin/boba/orders` endpoint is already
  // scoped to a single meal window, so the dataset is small enough to slice
  // on the client. Mirrors the "Page N of M · X total" footer shape used in
  // the profile directory and boba-payments consoles so the three admin
  // tables read as a single product. Defaulting to 25 rows matches
  // ``PAGE_SIZE`` in ``boba-payments/page.tsx``.
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

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
              // Derive the "all visible" key set from the table's post-
              // pagination row model so clicking this checkbox only toggles
              // the rows the admin can actually *see right now* — not every
              // row matching the filter across unseen pages (a whole-window
              // foot-gun) and not raw `data` (includes rows hidden by
              // search). Off-page selections made earlier are preserved
              // because we union/diff against `selectedRowKeys` instead of
              // replacing it wholesale.
              header: ({ table }) => {
                const pageKeys = table
                  .getRowModel()
                  .rows.map((row) => rowKey(row.original));
                const allSelected =
                  pageKeys.length > 0 &&
                  pageKeys.every((k) => selectedRowKeys.has(k));
                const someSelected =
                  !allSelected &&
                  pageKeys.some((k) => selectedRowKeys.has(k));
                return (
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders on this page"
                    className="size-4 cursor-pointer accent-(--bearhacks-primary)"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => {
                      onSelectedRowKeysChange((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) {
                          for (const k of pageKeys) next.add(k);
                        } else {
                          for (const k of pageKeys) next.delete(k);
                        }
                        return next;
                      });
                    }}
                    disabled={pageKeys.length === 0 || isBulkDeleting}
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
          const fulfillable = canAdminFulfill(o);
          return (
            <Button
              type="button"
              variant={isFulfilled ? "ghost" : "pill"}
              disabled={!fulfillable}
              aria-disabled={!fulfillable}
              title={fulfillable ? undefined : FULFILL_DISABLED_REASON}
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
    state: { sorting, globalFilter: search, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Default auto-reset is ON for data/filter changes which matches what
    // we want — flipping meal window / status / search drops the admin
    // back to page 1 so they don't land on a stale empty page.
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
  // count and the confirmation dialog only ever reflect rows matching the
  // current filter. Prevents the "I searched for one hacker and select-all
  // silently queued the whole window" class of accident described in the
  // header comment above. We scope to *filtered* (not paginated) rows so an
  // admin can tick keys across pages and have them all survive into the
  // delete call — switching pages is not a deselect. Recomputed each render
  // — O(filteredN) on a few hundred rows is trivially cheap, and memoizing
  // it against the right deps is fiddly because `table.getFilteredRowModel()`
  // isn't a stable reference.
  const selectedItems: BulkDeleteItem[] = table
    .getFilteredRowModel()
    .rows.filter((row) => selectedRowKeys.has(rowKey(row.original)))
    .map((row) => ({ kind: row.original.kind, id: row.original.id }));

  // Pre-compute paging-aware "Showing X–Y of Z" counts for the card
  // description. Pulled out of the JSX so the description reads as a
  // single template string instead of an inline IIFE. Matches the
  // ``pageStart`` / ``pageEnd`` pattern in ``boba-payments/page.tsx``.
  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageRowCount = table.getRowModel().rows.length;
  const pageIndexForLabel = table.getState().pagination.pageIndex;
  const pageSizeForLabel = table.getState().pagination.pageSize;
  const rangeStart =
    filteredCount === 0 ? 0 : pageIndexForLabel * pageSizeForLabel + 1;
  const rangeEnd = pageIndexForLabel * pageSizeForLabel + pageRowCount;
  let countLabel: string;
  if (!query.data) {
    countLabel = "";
  } else if (filteredCount === data.length) {
    countLabel =
      filteredCount === 0
        ? "No rows."
        : `Showing ${rangeStart}–${rangeEnd} of ${filteredCount}.`;
  } else {
    countLabel =
      filteredCount === 0
        ? `0 of ${data.length} shown (filtered).`
        : `Showing ${rangeStart}–${rangeEnd} of ${filteredCount} filtered (${data.length} total).`;
  }

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
            ? "Select the rows to permanently delete. Use the header checkbox to toggle all visible rows on this page."
            : "Sortable, searchable, with per-row Fulfill / Unfulfill toggle."}{" "}
          {countLabel}
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
              const fulfillable = canAdminFulfill(o);
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
                    <div className="mt-3 flex flex-col gap-1">
                      <Button
                        type="button"
                        variant={isFulfilled ? "ghost" : "pill"}
                        className="w-full sm:w-auto"
                        disabled={!fulfillable}
                        aria-disabled={!fulfillable}
                        title={fulfillable ? undefined : FULFILL_DISABLED_REASON}
                        onClick={() =>
                          void onToggleStatus(
                            o,
                            isFulfilled ? "placed" : "fulfilled",
                          )
                        }
                      >
                        {isFulfilled ? "Unfulfill" : "Fulfill"}
                      </Button>
                      {!fulfillable ? (
                        <p className="text-[11px] text-(--bearhacks-muted)">
                          {FULFILL_DISABLED_REASON}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <OrdersPaginationFooter
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            pageCount={table.getPageCount()}
            total={table.getFilteredRowModel().rows.length}
            canPrev={table.getCanPreviousPage()}
            canNext={table.getCanNextPage()}
            onPrev={() => table.previousPage()}
            onNext={() => table.nextPage()}
            isFetching={query.isFetching}
          />
        </>
      )}
    </Card>
  );
}

/**
 * Pagination footer for the All orders card. Visual + labelling shape
 * mirrors ``PaginationControls`` in ``boba-payments/page.tsx`` and the
 * profile directory footer — "Page N of M · X total" on the left, Prev
 * / Next buttons on the right — so the three admin consoles feel like
 * one product. Unlike the payments footer this one is client-side
 * (pagination state lives inside TanStack Table because the orders
 * endpoint is already scoped per meal window, so the dataset is small
 * enough to slice locally).
 */
function OrdersPaginationFooter({
  pageIndex,
  pageSize,
  pageCount,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
  isFetching,
}: {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isFetching: boolean;
}) {
  // ``pageCount`` is 0 when TanStack has no rows after filtering — clamp
  // to 1 so "Page 1 of 1 · 0 total" reads sensibly instead of "Page 1
  // of 0". Same trick ``PaginationControls`` uses in boba-payments.
  const safePageCount = Math.max(1, pageCount);
  const current = Math.min(pageIndex + 1, safePageCount);
  // Hide the footer entirely when the filtered set fits on a single page
  // AND there is at least one row — there is literally nothing to
  // paginate so the control would just be visual noise. Keep it rendered
  // on an empty state so the "0 total" signal stays present for admins
  // who just cleared their filter to an empty result.
  if (safePageCount === 1 && total > 0 && !isFetching) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--bearhacks-border) px-4 py-3 text-sm text-(--bearhacks-muted)">
      <span aria-live="polite">
        Page {current} of {safePageCount} · {total} total
        {isFetching ? " · refreshing…" : ""}
        {total > 0 ? ` · ${pageSize}/page` : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onNext}
          disabled={!canNext}
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
