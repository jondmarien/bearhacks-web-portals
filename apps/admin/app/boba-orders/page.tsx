"use client";

/**
 * Super-admin food-team console.
 *
 * Three views over the same underlying orders set, picked from a single meal
 * window:
 *   - Prep summary: drink groups + variants + topping totals (barista view)
 *   - Pickup list: drinks → hackers (call-out view)
 *   - Orders table: TanStack Table v8 with controlled sort + global filter
 *     (audit/triage view, with per-row "fulfill" action)
 *
 * Filter bar is a TanStack Form so we get the same `revalidateLogic` +
 * `form.Subscribe` ergonomics as the hacker order page. Filter changes pipe
 * into React Query keys; results stay on screen via `keepPreviousData`.
 */

import { ApiError } from "@bearhacks/api-client";
import { revalidateLogic, useForm } from "@tanstack/react-form";
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
import { useEffect, useMemo, useState } from "react";
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
  useDevWindowSettingQuery,
  useFulfillOrderMutation,
  useToggleDevWindowMutation,
  type AdminOrder,
  type AdminWindow,
  type WindowsResponse,
} from "@/lib/boba-queries";
import {
  adminFilterSchema,
  DEFAULT_ADMIN_FILTER,
  ICE_LABELS,
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  STATUS_VALUES,
  SWEETNESS_LABELS,
  type AdminFilterValues,
  type BobaStatus,
} from "@/lib/boba-schema";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { isStaffUser, isSuperAdminUser } from "@/lib/supabase-role";
import { createStructuredLogger } from "@/lib/structured-logging";
import { useQueryClient } from "@tanstack/react-query";

const log = createStructuredLogger("admin/boba-orders");

export default function AdminBobaOrdersPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  useDocumentTitle("Boba orders");

  const [user, setUser] = useState<User | null>(null);
  const [filters, setFilters] = useState<AdminFilterValues>(DEFAULT_ADMIN_FILTER);

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

  // The food-team console is single-window by design: prep summary, pickup
  // list, and the orders table are all scoped to one meal window. We derive
  // a focused window at render time so the user never starts on an empty
  // screen and we don't need a setState-in-effect to "auto-select".
  //   - If the user explicitly picked a window, honour that.
  //   - Otherwise fall back to the active window, then the next upcoming,
  //     then the first window in the list.
  const fallbackWindowId =
    windowsQuery.data?.active_window_id ??
    windowsQuery.data?.next_upcoming_window_id ??
    windowsQuery.data?.windows[0]?.id;
  const focusedWindowId = filters.meal_window_id ?? fallbackWindowId;

  const ordersQuery = useAdminOrdersQuery(
    {
      meal_window_id: focusedWindowId,
      status: filters.status,
    },
    isSuper,
  );

  const prepQuery = useAdminPrepSummaryQuery(focusedWindowId, isSuper);
  const pickupQuery = useAdminPickupListQuery(focusedWindowId, isSuper);

  const fulfillMutation = useFulfillOrderMutation();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Boba orders"
        tone="marketing"
        subtitle="Live food-team console — prep summary, pickup list, and full order audit per meal window."
        backHref="/"
        showBack
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
        <Card className="border-amber-200 bg-amber-50">
          <CardTitle className="text-amber-900">
            Super Admin access required
          </CardTitle>
          <CardDescription className="mt-1 text-amber-900">
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
          onExportCsv={async () => {
            if (!client) return;
            try {
              await downloadOrdersCsv(client, {
                meal_window_id: focusedWindowId,
              });
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
              toast.error(
                error instanceof Error ? error.message : "CSV export failed",
              );
            }
          }}
        />
      ) : null}

      {isSuper ? (
        <PrepSummaryCard
          query={prepQuery}
          windowLabel={windowLabel(windowsQuery.data, focusedWindowId) ?? "—"}
        />
      ) : null}

      {isSuper ? (
        <PickupListCard
          query={pickupQuery}
          windowLabel={windowLabel(windowsQuery.data, focusedWindowId) ?? "—"}
        />
      ) : null}

      {isSuper ? (
        <OrdersTableCard
          query={ordersQuery}
          windows={windowsQuery.data?.windows ?? []}
          search={filters.search ?? ""}
          onFulfill={async (order) => {
            const ok = await confirm({
              title: "Mark this order fulfilled?",
              description: `${order.display_name ?? order.user_id.slice(0, 8)} — once marked, it drops off the prep view.`,
              confirmLabel: "Mark fulfilled",
            });
            if (!ok) return;
            try {
              await fulfillMutation.mutateAsync({ orderId: order.id });
              log("info", {
                event: "admin_boba_fulfill",
                actor,
                resourceId: order.id,
                result: "success",
              });
              toast.success("Order fulfilled.");
              void queryClient.invalidateQueries({ queryKey: adminBobaKeys.all });
            } catch (error) {
              log("error", {
                event: "admin_boba_fulfill",
                actor,
                resourceId: order.id,
                result: "error",
                error,
              });
              toast.error(
                error instanceof ApiError ? error.message : "Failed to fulfill",
              );
            }
          }}
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

  // Local draft for the cap input so the field doesn't re-clobber while
  // the admin is mid-edit. Re-syncs whenever the server value changes.
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
                    ? "font-semibold text-emerald-700"
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
            Drinks per hacker (dev window only)
          </label>
          <p className="text-xs text-(--bearhacks-muted)">
            Real meal windows are always capped at one drink per hacker. This
            cap applies to <span className="font-semibold">all hackers</span>{" "}
            ordering against the dev-test window. Range: 1–
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
                <p className="text-xs text-red-600">
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
                        return `Cap set to ${data.max_orders} drink${
                          data.max_orders === 1 ? "" : "s"
                        } per hacker.`;
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
              {isLoading ? "…" : `${serverCap} drink${serverCap === 1 ? "" : "s"}`}
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

type FilterBarProps = {
  windows: WindowsResponse;
  values: AdminFilterValues;
  // Window the page falls back to when the user hasn't picked one yet.
  // Surfaced here so the <select> shows the same window the queries use.
  fallbackWindowId: string | undefined;
  onChange: (next: AdminFilterValues) => void;
  onExportCsv: () => void | Promise<void>;
};

function FilterBar({
  windows,
  values,
  fallbackWindowId,
  onChange,
  onExportCsv,
}: FilterBarProps) {
  const form = useForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: adminFilterSchema,
    },
    onSubmit: ({ value }) => {
      onChange(value);
    },
  });

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <form.Field name="meal_window_id">
            {(field) => (
              <FilterField label="Meal window" htmlFor={field.name}>
                <select
                  id={field.name}
                  // Show the focused window even before the user picks one,
                  // so the dropdown matches what prep/pickup/orders queries
                  // actually loaded. We deliberately drop "All windows" —
                  // this console is single-window by design.
                  value={field.state.value ?? fallbackWindowId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || undefined;
                    field.handleChange(next);
                    onChange({ ...values, meal_window_id: next });
                  }}
                  className={selectClasses}
                >
                  {windows.windows.map((w) => {
                    const counts =
                      windows.counts_by_window[w.id] ?? {
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
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <FilterField label="Status" htmlFor={field.name}>
                <select
                  id={field.name}
                  value={field.state.value ?? ""}
                  onChange={(e) => {
                    const next = (e.target.value || undefined) as
                      | BobaStatus
                      | undefined;
                    field.handleChange(next);
                    onChange({ ...values, status: next });
                  }}
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
            )}
          </form.Field>

          <form.Field name="search">
            {(field) => (
              <FilterField label="Search (name / notes)" htmlFor={field.name}>
                <input
                  id={field.name}
                  type="search"
                  value={field.state.value ?? ""}
                  placeholder="Type to filter the table…"
                  onChange={(e) => {
                    const next = e.target.value;
                    field.handleChange(next);
                    onChange({ ...values, search: next });
                  }}
                  className={inputClasses}
                />
              </FilterField>
            )}
          </form.Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-(--bearhacks-muted)">
            Filters update live as you type. CSV always reflects the current
            window filter.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.reset();
                onChange(DEFAULT_ADMIN_FILTER);
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void onExportCsv()}
            >
              Export CSV
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

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
        <p className="mt-4 text-sm text-red-700">
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
                  <span className="text-sm font-semibold text-(--bearhacks-primary)">
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

type PickupListCardProps = {
  query: ReturnType<typeof useAdminPickupListQuery>;
  windowLabel: string;
};

function PickupListCard({ query, windowLabel }: PickupListCardProps) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>
          Pickup <span className="bg-(--bearhacks-cream) px-1 rounded-sm">list</span>
        </CardTitle>
        <span className="text-xs text-(--bearhacks-muted)">{windowLabel}</span>
      </div>
      <CardDescription className="mt-1">
        Call hackers up by drink. Names sorted alphabetically.
      </CardDescription>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="mt-4 text-sm text-red-700">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load pickup list"}
        </p>
      ) : !query.data || query.data.total_orders === 0 ? (
        <p className="mt-4 text-sm text-(--bearhacks-muted)">
          No placed orders for this window yet.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {query.data.drinks.map((drink) => (
            <li
              key={drink.drink_id}
              className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-(--bearhacks-primary)">
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
                        {SWEETNESS_LABELS[row.sweetness] ?? `${row.sweetness}%`}{" "}
                        · {ICE_LABELS[row.ice] ?? row.ice}
                        {row.topping_labels.length > 0
                          ? ` · ${row.topping_labels.join(", ")}`
                          : " · no toppings"}
                      </p>
                      {row.notes ? (
                        <p className="text-xs italic text-(--bearhacks-text-marketing)/70">
                          “{row.notes}”
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type OrdersTableCardProps = {
  query: ReturnType<typeof useAdminOrdersQuery>;
  windows: AdminWindow[];
  search: string;
  onFulfill: (order: AdminOrder) => Promise<void>;
};

function OrdersTableCard({
  query,
  windows,
  search,
  onFulfill,
}: OrdersTableCardProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created_at", desc: true },
  ]);

  const windowLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of windows) m.set(w.id, w.label);
    return m;
  }, [windows]);

  const data = query.data?.orders ?? [];

  const columns = useMemo<ColumnDef<AdminOrder>[]>(
    () => [
      {
        accessorKey: "display_name",
        header: "Hacker",
        cell: (ctx) => (
          <span className="text-sm font-semibold text-(--bearhacks-fg)">
            {ctx.row.original.display_name?.trim() ||
              `(no profile) ${ctx.row.original.user_id.slice(0, 8)}`}
          </span>
        ),
        sortingFn: (a, b) =>
          (a.original.display_name ?? "").localeCompare(
            b.original.display_name ?? "",
            "en",
            { sensitivity: "base" },
          ),
      },
      {
        accessorKey: "drink_id",
        header: "Drink",
        cell: (ctx) => (
          <span className="text-sm text-(--bearhacks-fg)">
            {ctx.row.original.drink_id}
          </span>
        ),
      },
      {
        id: "customization",
        header: "Customization",
        cell: (ctx) => {
          const o = ctx.row.original;
          return (
            <span className="text-xs text-(--bearhacks-muted)">
              {SWEETNESS_LABELS[o.sweetness] ?? `${o.sweetness}%`} ·{" "}
              {ICE_LABELS[o.ice] ?? o.ice}
              {o.topping_ids.length > 0
                ? ` · ${o.topping_ids.join(", ")}`
                : " · no toppings"}
            </span>
          );
        },
        enableSorting: false,
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
          if (o.status !== "placed") {
            return <span className="text-xs text-(--bearhacks-muted)">—</span>;
          }
          return (
            <Button
              type="button"
              variant="pill"
              onClick={() => void onFulfill(o)}
            >
              Fulfill
            </Button>
          );
        },
        enableSorting: false,
      },
    ],
    [windowLabelById, onFulfill],
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
        o.display_name,
        o.notes,
        o.drink_id,
        o.topping_ids.join(" "),
        o.user_id,
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
          All <span className="bg-(--bearhacks-cream) px-1 rounded-sm">orders</span>
        </CardTitle>
        <CardDescription>
          Sortable, searchable, with per-row fulfill action.{" "}
          {query.data ? `${table.getFilteredRowModel().rows.length} of ${data.length} shown.` : null}
        </CardDescription>
      </div>

      {query.isLoading ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">Loading…</p>
      ) : query.isError ? (
        <p className="px-4 py-6 text-sm text-red-700">
          {query.error instanceof ApiError
            ? query.error.message
            : "Failed to load orders"}
        </p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-sm text-(--bearhacks-muted)">
          No orders match the current filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
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
        className="text-sm font-medium text-(--bearhacks-primary)"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-primary) focus:outline-none";

const selectClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-primary) focus:outline-none";
