"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { createApiClient } from "@bearhacks/api-client";
import { useApiClient } from "@/lib/use-api-client";
import type { BobaStatus } from "@/lib/boba-schema";

/**
 * React Query hooks for the admin boba domain.
 *
 * Mirrors `bearhacks-backend/routers/admin_boba.py` — all endpoints require
 * super-admin and are 403 otherwise. Now covers drinks + momos as a single
 * row union (``kind`` discriminator) so the table can render both side by
 * side, with bidirectional fulfill/unfulfill toggles per row.
 *
 * Pagination/filtering uses `placeholderData: keepPreviousData` so the table
 * doesn't blank out while the user toggles filters.
 */

type ApiClient = ReturnType<typeof createApiClient>;

export type AdminWindow = {
  id: string;
  label: string;
  opens_at: string;
  closes_at: string;
  pickup_hint: string;
};

export type WindowsResponse = {
  now: string;
  active_window_id: string | null;
  next_upcoming_window_id: string | null;
  windows: AdminWindow[];
  counts_by_window: Record<
    string,
    { placed: number; cancelled: number; fulfilled: number; total: number }
  >;
};

/** Discriminated union row from ``GET /admin/boba/orders``. */
export type AdminOrderRow = {
  id: string;
  user_id: string;
  meal_window_id: string;
  /** "drink" or "momo". */
  kind: "drink" | "momo";
  /** Drink size id (e.g. ``"medium"``) — null for momo rows. */
  size: string | null;
  /** Drink size human label (e.g. ``"Medium (16 oz)"``) — null for momo rows. */
  size_label: string | null;
  /** Pre-rendered "Classic Milk Tea + Pearls · 50% sugar · regular ice" copy. */
  detail: string;
  /** Per-row CAD cents. */
  amount_cents: number;
  status: BobaStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  hacker_name: string;
  hacker_email: string | null;

  // Drink-only fields. Present (and possibly empty) when ``kind === "drink"``.
  drink_id?: string;
  topping_ids?: string[];
  sweetness?: number;
  ice?: string;

  // Momo-only fields. Present when ``kind === "momo"``.
  filling?: string;
  sauce?: string;
};

export type OrdersResponse = {
  meal_window_id: string | null;
  status: BobaStatus | null;
  include: "drinks" | "momos" | "both";
  count: number;
  orders: AdminOrderRow[];
};

export type PrepVariant = {
  count: number;
  drink_id: string;
  topping_ids: string[];
  sweetness: number;
  ice: string;
  description: string;
};

export type PrepDrink = {
  drink_id: string;
  drink_label: string;
  total: number;
  variants: PrepVariant[];
};

export type PrepSummaryResponse = {
  meal_window_id: string;
  total_orders: number;
  drinks: PrepDrink[];
  topping_totals: Array<{ topping_id: string; label: string; count: number }>;
};

export type PickupRow = {
  order_id: string;
  user_id: string;
  name: string;
  topping_labels: string[];
  topping_ids: string[];
  sweetness: number;
  ice: string;
  notes: string | null;
  status: BobaStatus;
};

export type PickupListResponse = {
  meal_window_id: string;
  total_orders: number;
  drinks: Array<{
    drink_id: string;
    drink_label: string;
    count: number;
    rows: PickupRow[];
  }>;
};

export type DevWindowSetting = {
  window_id: string;
  enabled: boolean;
  max_orders: number;
};

export type DevWindowSettingPatch = Partial<
  Pick<DevWindowSetting, "enabled" | "max_orders">
>;

/**
 * Per-order payment row from ``GET /admin/boba/payments``.
 *
 * Post per-order migration, each row covers exactly one drink or momo
 * order via ``boba_order_id`` / ``momo_order_id`` (exactly one non-null).
 * The admin table renders one row per item instead of the old bundle
 * with an inline cancelled-items collapsible.
 */
export type AdminPaymentRow = {
  id: string;
  user_id: string;
  meal_window_id: string;
  status: "unpaid" | "submitted" | "confirmed" | "refunded";
  expected_cents: number;
  received_cents: number | null;
  reference: string | null;
  notes: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
  hacker_name: string;
  hacker_email: string | null;
  display_name: string | null;
  /** Polymorphic FK — exactly one of these is set per XOR constraint. */
  boba_order_id: string | null;
  momo_order_id: string | null;
  /** Discriminator for the single order this payment covers. */
  kind: "drink" | "momo";
  /** The underlying order's id (drink or momo, per ``kind``). */
  order_id: string;
  /** Pre-rendered "Classic Milk Tea + Pearls · 50% sugar · Regular ice" copy. */
  item_detail: string;
  /** Current status of the underlying drink/momo order. */
  item_status: BobaStatus;
  /** Drink size id when ``kind === "drink"``; ``null`` for momo rows. */
  item_size: string | null;
};

export type PaymentsResponse = {
  meal_window_id: string | null;
  /** Echoed multi-select filter — empty array means "all statuses". */
  status: AdminPaymentRow["status"][];
  search: string | null;
  /** Total matches across the filter (pre-pagination) — drives the pager. */
  total: number;
  limit: number;
  offset: number;
  /** Rows on the current page — already sliced by offset/limit on the server. */
  count: number;
  payments: AdminPaymentRow[];
  summary: {
    total_expected_cents: number;
    total_received_cents: number;
    by_status: Record<AdminPaymentRow["status"], number>;
  };
};

export type AdminPaymentsQueryParams = {
  meal_window_id?: string;
  /** Multi-select — empty array / undefined means "any status". */
  statuses?: readonly AdminPaymentRow["status"][];
  /** Server-side substring search across name/email/ref/notes/items. */
  search?: string;
  limit: number;
  offset: number;
};

export const adminBobaKeys = {
  all: ["admin-boba"] as const,
  windows: () => [...adminBobaKeys.all, "windows"] as const,
  orders: (params: { meal_window_id?: string; status?: BobaStatus }) =>
    [...adminBobaKeys.all, "orders", params] as const,
  prepSummary: (mealWindowId: string) =>
    [...adminBobaKeys.all, "prep", mealWindowId] as const,
  pickupList: (mealWindowId: string) =>
    [...adminBobaKeys.all, "pickup", mealWindowId] as const,
  devWindowSetting: () =>
    [...adminBobaKeys.all, "settings", "dev-window"] as const,
  payments: (params: AdminPaymentsQueryParams) =>
    [
      ...adminBobaKeys.all,
      "payments",
      {
        meal_window_id: params.meal_window_id ?? null,
        // Sort for key stability — React Query does a structural compare and
        // we don't want ["unpaid","submitted"] vs ["submitted","unpaid"] to
        // split the cache. Normalise the search too (undefined ≡ "").
        statuses: params.statuses ? [...params.statuses].sort() : [],
        search: (params.search ?? "").trim(),
        limit: params.limit,
        offset: params.offset,
      },
    ] as const,
};

export function useAdminWindowsQuery(
  enabled: boolean,
): UseQueryResult<WindowsResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: adminBobaKeys.windows(),
    queryFn: () =>
      (client as ApiClient).fetchJson<WindowsResponse>("/admin/boba/windows"),
    enabled: enabled && Boolean(client),
    refetchInterval: 60_000,
  });
}

export function useAdminOrdersQuery(
  params: { meal_window_id?: string; status?: BobaStatus },
  enabled: boolean,
): UseQueryResult<OrdersResponse> {
  const client = useApiClient();
  const search = new URLSearchParams();
  if (params.meal_window_id)
    search.set("meal_window_id", params.meal_window_id);
  if (params.status) search.set("status", params.status);
  const qs = search.toString();
  return useQuery({
    queryKey: adminBobaKeys.orders(params),
    queryFn: () =>
      (client as ApiClient).fetchJson<OrdersResponse>(
        qs ? `/admin/boba/orders?${qs}` : "/admin/boba/orders",
      ),
    enabled: enabled && Boolean(client),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPrepSummaryQuery(
  mealWindowId: string | null | undefined,
  enabled: boolean,
): UseQueryResult<PrepSummaryResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: mealWindowId
      ? adminBobaKeys.prepSummary(mealWindowId)
      : ["admin-boba", "prep", "none"],
    queryFn: () =>
      (client as ApiClient).fetchJson<PrepSummaryResponse>(
        `/admin/boba/orders/prep-summary?meal_window_id=${encodeURIComponent(
          mealWindowId ?? "",
        )}`,
      ),
    enabled: enabled && Boolean(client && mealWindowId),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPickupListQuery(
  mealWindowId: string | null | undefined,
  enabled: boolean,
): UseQueryResult<PickupListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: mealWindowId
      ? adminBobaKeys.pickupList(mealWindowId)
      : ["admin-boba", "pickup", "none"],
    queryFn: () =>
      (client as ApiClient).fetchJson<PickupListResponse>(
        `/admin/boba/orders/pickup-list?meal_window_id=${encodeURIComponent(
          mealWindowId ?? "",
        )}`,
      ),
    enabled: enabled && Boolean(client && mealWindowId),
    placeholderData: keepPreviousData,
  });
}

export function useDevWindowSettingQuery(
  enabled: boolean,
): UseQueryResult<DevWindowSetting> {
  const client = useApiClient();
  return useQuery({
    queryKey: adminBobaKeys.devWindowSetting(),
    queryFn: () =>
      (client as ApiClient).fetchJson<DevWindowSetting>(
        "/admin/boba/settings/dev-window",
      ),
    enabled: enabled && Boolean(client),
  });
}

export function useToggleDevWindowMutation(): UseMutationResult<
  DevWindowSetting,
  Error,
  DevWindowSettingPatch,
  { previous: DevWindowSetting | undefined }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch) =>
      (client as ApiClient).fetchJson<DevWindowSetting>(
        "/admin/boba/settings/dev-window",
        {
          method: "PUT",
          body: JSON.stringify(patch),
          headers: { "Content-Type": "application/json" },
        },
      ),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: adminBobaKeys.devWindowSetting() });
      const previous = qc.getQueryData<DevWindowSetting>(
        adminBobaKeys.devWindowSetting(),
      );
      if (previous) {
        qc.setQueryData<DevWindowSetting>(adminBobaKeys.devWindowSetting(), {
          ...previous,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.max_orders !== undefined
            ? { max_orders: patch.max_orders }
            : {}),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData<DevWindowSetting>(
          adminBobaKeys.devWindowSetting(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.devWindowSetting() });
      void qc.invalidateQueries({ queryKey: adminBobaKeys.windows() });
    },
  });
}

// ----------------------------------------------------------------------------
// Fulfill / Unfulfill — drinks and momos, both directions
// ----------------------------------------------------------------------------

type StatusToggleVars = { row: AdminOrderRow; nextStatus: "placed" | "fulfilled" };

export function useToggleOrderStatusMutation(): UseMutationResult<
  AdminOrderRow,
  Error,
  StatusToggleVars
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ row, nextStatus }) => {
      const path = pathForToggle(row, nextStatus);
      return (client as ApiClient).fetchJson<AdminOrderRow>(path, {
        method: "POST",
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

function pathForToggle(
  row: AdminOrderRow,
  nextStatus: "placed" | "fulfilled",
): string {
  const action = nextStatus === "fulfilled" ? "fulfill" : "unfulfill";
  return row.kind === "drink"
    ? `/admin/boba/orders/${row.id}/${action}`
    : `/admin/boba/momos/${row.id}/${action}`;
}

// ----------------------------------------------------------------------------
// Bulk delete — mixed drink + momo hard-delete, used by the "clear old orders"
// flow. Mirrors the QR admin's ``Bulk delete`` ergonomics so the food team
// can sweep a window clean without clicking through per-row confirms.
// ----------------------------------------------------------------------------

export type BulkDeleteItem = { kind: "drink" | "momo"; id: string };

export type BulkDeleteResponse = {
  deleted: BulkDeleteItem[];
  failed: (BulkDeleteItem & { reason: string })[];
};

export function useBulkDeleteOrdersMutation(): UseMutationResult<
  BulkDeleteResponse,
  Error,
  BulkDeleteItem[]
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items) =>
      (client as ApiClient).fetchJson<BulkDeleteResponse>(
        "/admin/boba/orders/bulk-delete",
        {
          method: "POST",
          body: JSON.stringify({ items }),
          headers: { "Content-Type": "application/json" },
        },
      ),
    onSuccess: () => {
      // Wholesale invalidate — orders/prep-summary/pickup-list/payments are
      // all downstream of this delete and will refetch lazily.
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

// ----------------------------------------------------------------------------
// Payments — list + confirm / refund / unconfirm
// ----------------------------------------------------------------------------

export function useAdminPaymentsQuery(
  params: AdminPaymentsQueryParams,
  enabled: boolean,
): UseQueryResult<PaymentsResponse> {
  const client = useApiClient();
  const query = new URLSearchParams();
  if (params.meal_window_id)
    query.set("meal_window_id", params.meal_window_id);
  // `status` repeats rather than comma-joins to match FastAPI's list query
  // parsing (``status: list[str] = Query(...)``) and mirrors the profiles
  // directory's ``?role=...&role=...`` convention for multi-filters.
  if (params.statuses) {
    for (const s of params.statuses) query.append("status", s);
  }
  const trimmedSearch = (params.search ?? "").trim();
  if (trimmedSearch) query.set("search", trimmedSearch);
  query.set("limit", String(params.limit));
  query.set("offset", String(params.offset));
  const qs = query.toString();
  return useQuery({
    queryKey: adminBobaKeys.payments(params),
    queryFn: () =>
      (client as ApiClient).fetchJson<PaymentsResponse>(
        `/admin/boba/payments?${qs}`,
      ),
    enabled: enabled && Boolean(client),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useConfirmPaymentMutation(): UseMutationResult<
  AdminPaymentRow,
  Error,
  { paymentId: string; receivedCents?: number | null; notes?: string | null }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, receivedCents, notes }) =>
      (client as ApiClient).fetchJson<AdminPaymentRow>(
        `/admin/boba/payments/${paymentId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            received_cents: receivedCents ?? null,
            notes: notes ?? null,
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

export function useRefundPaymentMutation(): UseMutationResult<
  AdminPaymentRow,
  Error,
  { paymentId: string; notes?: string | null }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, notes }) =>
      (client as ApiClient).fetchJson<AdminPaymentRow>(
        `/admin/boba/payments/${paymentId}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notes ?? null }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

export function useUnconfirmPaymentMutation(): UseMutationResult<
  AdminPaymentRow,
  Error,
  { paymentId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId }) =>
      (client as ApiClient).fetchJson<AdminPaymentRow>(
        `/admin/boba/payments/${paymentId}/unconfirm`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

export function useUnrefundPaymentMutation(): UseMutationResult<
  AdminPaymentRow,
  Error,
  { paymentId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId }) =>
      (client as ApiClient).fetchJson<AdminPaymentRow>(
        `/admin/boba/payments/${paymentId}/unrefund`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminBobaKeys.all });
    },
  });
}

/** Build the CSV download URL with the current bearer token + filter. */
export async function downloadOrdersCsv(
  client: ApiClient,
  params: { meal_window_id?: string },
): Promise<void> {
  const search = new URLSearchParams();
  if (params.meal_window_id)
    search.set("meal_window_id", params.meal_window_id);
  const qs = search.toString();
  const path = qs
    ? `/admin/boba/orders/export.csv?${qs}`
    : "/admin/boba/orders/export.csv";
  const res = await client.request(path, { method: "GET" });
  if (!res.ok) {
    throw new Error(`CSV export failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `boba-orders-${params.meal_window_id ?? "all"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
