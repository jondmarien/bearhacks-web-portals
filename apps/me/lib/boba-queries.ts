"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { createApiClient } from "@bearhacks/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { toApiBody, type BobaOrderFormValues } from "@/lib/boba-schema";

/**
 * React Query hooks for the boba ordering domain (apps/me).
 *
 * Centralising the query keys, fetchers, and invalidation here keeps every
 * component on the same cache contract:
 * - `bobaKeys.menu` — static drink/topping catalogue
 * - `bobaKeys.windows` — server-truth meal window schedule + which is open
 * - `bobaKeys.myOrder` — caller's order for the active window (or fallback)
 *
 * Mutations all invalidate `myOrder` and `windows` so the status card and
 * order page recompute together without ad-hoc cache surgery.
 */

type ApiClient = ReturnType<typeof createApiClient>;

export type BobaMenuResponse = {
  drinks: Array<{ id: string; label: string }>;
  toppings: Array<{ id: string; label: string }>;
  sweetness_options: number[];
  ice_options: string[];
};

export type BobaWindowPayload = {
  id: string;
  label: string;
  opens_at: string;
  closes_at: string;
  pickup_hint: string;
};

export type BobaWindowsResponse = {
  now: string;
  active_window_id: string | null;
  next_upcoming_window_id: string | null;
  windows: BobaWindowPayload[];
};

export type BobaOrder = {
  id: string;
  user_id: string;
  meal_window_id: string;
  drink_id: string;
  topping_ids: string[];
  sweetness: number;
  ice: string;
  notes: string | null;
  status: "placed" | "cancelled" | "fulfilled";
  created_at: string;
  updated_at: string;
};

export type MyOrderResponse = {
  /** Most recent order (any status). Backwards-compatible with the v1 shape. */
  order: BobaOrder | null;
  /** Every order for the focused window, newest first. */
  orders: BobaOrder[];
  /** Count of `status='placed'` rows in `orders`. */
  placed_count: number;
  /**
   * Per-user drink cap for the active window. 1 for real meal windows;
   * configurable by super-admins for the dev-test window.
   */
  max_orders: number;
  active_window_id: string | null;
};

export const bobaKeys = {
  all: ["boba"] as const,
  menu: () => [...bobaKeys.all, "menu"] as const,
  windows: () => [...bobaKeys.all, "windows"] as const,
  myOrder: (userId: string | null | undefined) =>
    [...bobaKeys.all, "my-order", userId ?? "anon"] as const,
};

export function useBobaMenuQuery(): UseQueryResult<BobaMenuResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: bobaKeys.menu(),
    queryFn: () => (client as ApiClient).fetchJson<BobaMenuResponse>("/boba/menu"),
    enabled: Boolean(client),
    staleTime: 5 * 60_000,
  });
}

export function useBobaWindowsQuery(): UseQueryResult<BobaWindowsResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: bobaKeys.windows(),
    queryFn: () =>
      (client as ApiClient).fetchJson<BobaWindowsResponse>("/boba/windows"),
    enabled: Boolean(client),
    // Windows are time-sensitive: refetch every minute so the "opens at"
    // copy and the order form gating flip without a full reload.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useMyBobaOrderQuery(
  userId: string | null,
): UseQueryResult<MyOrderResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: bobaKeys.myOrder(userId),
    queryFn: () =>
      (client as ApiClient).fetchJson<MyOrderResponse>("/boba/orders/me"),
    enabled: Boolean(client && userId),
    refetchInterval: 60_000,
  });
}

function invalidateBobaCaches(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: bobaKeys.windows() });
  void qc.invalidateQueries({ queryKey: bobaKeys.all });
}

// Cache patcher used by every mutation: surgically updates the orders[]
// list (replace-or-prepend) so the UI stays correct between the mutation
// returning and the subsequent invalidate refetch.
function patchMyOrderCache(
  qc: ReturnType<typeof useQueryClient>,
  userId: string | null,
  next: BobaOrder,
): void {
  qc.setQueryData<MyOrderResponse | undefined>(
    bobaKeys.myOrder(userId),
    (prev) => {
      if (!prev) {
        return {
          order: next,
          orders: [next],
          placed_count: next.status === "placed" ? 1 : 0,
          max_orders: next.status === "placed" ? 1 : 1,
          active_window_id: next.meal_window_id,
        };
      }
      const existingIdx = prev.orders.findIndex((o) => o.id === next.id);
      const orders =
        existingIdx >= 0
          ? prev.orders.map((o, i) => (i === existingIdx ? next : o))
          : [next, ...prev.orders];
      const placed_count = orders.filter((o) => o.status === "placed").length;
      // Recompute the convenience `order` field as the newest by created_at.
      const newest = orders.reduce<BobaOrder | null>(
        (acc, o) =>
          !acc || new Date(o.created_at) > new Date(acc.created_at) ? o : acc,
        null,
      );
      return {
        ...prev,
        order: newest ?? prev.order,
        orders,
        placed_count,
        active_window_id: prev.active_window_id ?? next.meal_window_id,
      };
    },
  );
}

export function useCreateBobaOrderMutation(
  userId: string | null,
): UseMutationResult<BobaOrder, Error, BobaOrderFormValues> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: BobaOrderFormValues) =>
      (client as ApiClient).fetchJson<BobaOrder>("/boba/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiBody(values)),
      }),
    onSuccess: (order) => {
      patchMyOrderCache(qc, userId, order);
      invalidateBobaCaches(qc);
    },
  });
}

export function useUpdateBobaOrderMutation(
  userId: string | null,
): UseMutationResult<
  BobaOrder,
  Error,
  { orderId: string; values: BobaOrderFormValues }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, values }) =>
      (client as ApiClient).fetchJson<BobaOrder>(`/boba/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiBody(values)),
      }),
    onSuccess: (order) => {
      patchMyOrderCache(qc, userId, order);
      invalidateBobaCaches(qc);
    },
  });
}

export function useCancelBobaOrderMutation(
  userId: string | null,
): UseMutationResult<BobaOrder, Error, { orderId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId }) =>
      (client as ApiClient).fetchJson<BobaOrder>(`/boba/orders/${orderId}`, {
        method: "DELETE",
      }),
    onSuccess: (order) => {
      patchMyOrderCache(qc, userId, order);
      invalidateBobaCaches(qc);
    },
  });
}
