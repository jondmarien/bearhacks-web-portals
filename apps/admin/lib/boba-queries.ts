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
 * super-admin and are 403 otherwise. The query key factory (`adminBobaKeys`)
 * lets the page invalidate sibling caches (orders + windows + summaries) in
 * one call after a fulfill, so counts and table rows update together.
 *
 * Pagination/filtering uses `placeholderData: keepPreviousData` so the table
 * doesn't blank out while the user toggles filters — the row set just fades
 * into the new one.
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

export type AdminOrder = {
  id: string;
  user_id: string;
  meal_window_id: string;
  drink_id: string;
  topping_ids: string[];
  sweetness: number;
  ice: string;
  notes: string | null;
  status: BobaStatus;
  created_at: string;
  updated_at: string;
  display_name: string | null;
};

export type OrdersResponse = {
  meal_window_id: string | null;
  status: BobaStatus | null;
  count: number;
  orders: AdminOrder[];
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
      // Optimistic flip — the switch should feel instantaneous.
      // We snapshot the previous value so the catch handler can roll back.
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
      // Refresh windows / counts so the dropdown picks up (or drops) the
      // dev entry after the toggle, and so the cap label stays in sync.
      void qc.invalidateQueries({ queryKey: adminBobaKeys.devWindowSetting() });
      void qc.invalidateQueries({ queryKey: adminBobaKeys.windows() });
    },
  });
}

export function useFulfillOrderMutation(): UseMutationResult<
  AdminOrder,
  Error,
  { orderId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId }) =>
      (client as ApiClient).fetchJson<AdminOrder>(
        `/admin/boba/orders/${orderId}/fulfill`,
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
