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
import {
  drinkToApiBody,
  momoToApiBody,
  toApiBody,
  type BobaOrderFormValues,
  type DrinkFormValues,
  type MomoFormValues,
} from "@/lib/boba-schema";

/**
 * React Query hooks for the boba ordering domain (apps/me).
 *
 * Centralising the query keys, fetchers, and invalidation here keeps every
 * component on the same cache contract:
 * - `bobaKeys.menu` — static drink/topping/sizes/momos catalogue + payment metadata
 * - `bobaKeys.windows` — server-truth meal window schedule + which is open
 * - `bobaKeys.myOrder` — caller's drinks + momos + payment for the active window
 *
 * Mutations all invalidate `myOrder` and `windows` so the status card and
 * order page recompute together without ad-hoc cache surgery.
 */

type ApiClient = ReturnType<typeof createApiClient>;

export type BobaMenuResponse = {
  drinks: Array<{ id: string; label: string }>;
  toppings: Array<{ id: string; label: string }>;
  sizes: Array<{ id: string; label: string }>;
  sweetness_options: number[];
  ice_options: string[];
  max_toppings_per_order: number;
  /** ``topping_id -> [drink_id, ...]`` allowlist; entry absent = universal. */
  topping_constraints: Record<string, string[]>;
  momos: {
    fillings: Array<{ id: string; label: string }>;
    sauces: Array<{ id: string; label: string }>;
    price_cents: number;
    description: string;
  };
  payment: {
    etransfer_email: string;
    etransfer_recipient_name: string;
    size_prices_cents: Record<string, number>;
    momo_price_cents: number;
    discount_note: string;
  };
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
  size: string;
  notes: string | null;
  status: "placed" | "cancelled" | "fulfilled";
  created_at: string;
  updated_at: string;
};

export type BobaMomoOrder = {
  id: string;
  user_id: string;
  meal_window_id: string;
  filling: string;
  sauce: string;
  notes: string | null;
  status: "placed" | "cancelled" | "fulfilled";
  created_at: string;
  updated_at: string;
};

export type BobaPaymentStatus =
  | "unpaid"
  | "submitted"
  | "confirmed"
  | "refunded";

export type BobaPayment = {
  id: string;
  user_id: string;
  meal_window_id: string;
  status: BobaPaymentStatus;
  expected_cents: number;
  received_cents: number | null;
  reference: string | null;
  notes: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MyOrderResponse = {
  /** Most recent drink (any status). Backwards-compatible with the v1 shape. */
  order: BobaOrder | null;
  /** Drinks for the focused window, newest first. Same as ``drinks``. */
  orders: BobaOrder[];
  /** Drinks for the focused window, newest first. */
  drinks: BobaOrder[];
  /** Momos for the focused window, newest first. */
  momos: BobaMomoOrder[];
  /** Sum of placed drinks + placed momos (shared cap). */
  placed_count: number;
  /**
   * Per-user combined cap for the active window. 1 for real meal windows;
   * configurable by super-admins for the dev-test window.
   */
  max_orders: number;
  /** Placed-drink count for the active window. */
  placed_drinks: number;
  /** Placed-momo-order count for the active window (each row = 5 momos). */
  placed_momos: number;
  /**
   * Per-user drink cap for the active window. 1 for real meal windows;
   * matches ``max_orders`` for the dev-test window.
   */
  max_drinks: number;
  /**
   * Per-user momo-order cap for the active window. 1 for real meal windows;
   * matches ``max_orders`` for the dev-test window. One momo order == 5 momos.
   */
  max_momos: number;
  active_window_id: string | null;
  /** Bundled payment for the active window, or ``null`` if nothing placed. */
  payment: BobaPayment | null;
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

// ----------------------------------------------------------------------------
// Combined create — POST /boba/orders accepting drink and/or momo
// ----------------------------------------------------------------------------

/** Server response for the combined POST. */
export type CombinedOrderResponse = {
  drink: BobaOrder | null;
  momo: BobaMomoOrder | null;
  payment: BobaPayment | null;
} & Partial<BobaOrder>;

export function useCreateBobaOrderMutation(): UseMutationResult<
  CombinedOrderResponse,
  Error,
  BobaOrderFormValues
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: BobaOrderFormValues) =>
      (client as ApiClient).fetchJson<CombinedOrderResponse>("/boba/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiBody(values)),
      }),
    onSuccess: () => {
      // Easier to refetch than to merge two heterogenous shapes; the read
      // query is cheap.
      invalidateBobaCaches(qc);
    },
  });
}

// ----------------------------------------------------------------------------
// Drink-specific edit/cancel — PATCH/DELETE /boba/drinks/{id}
// ----------------------------------------------------------------------------

export function useUpdateBobaDrinkMutation(): UseMutationResult<
  BobaOrder,
  Error,
  { orderId: string; values: DrinkFormValues }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, values }) =>
      (client as ApiClient).fetchJson<BobaOrder>(`/boba/drinks/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drinkToApiBody(values)),
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}

export function useCancelBobaDrinkMutation(): UseMutationResult<
  BobaOrder,
  Error,
  { orderId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId }) =>
      (client as ApiClient).fetchJson<BobaOrder>(`/boba/drinks/${orderId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}

// ----------------------------------------------------------------------------
// Momo-specific edit/cancel — PATCH/DELETE /boba/momos/{id}
// ----------------------------------------------------------------------------

export function useUpdateBobaMomoMutation(): UseMutationResult<
  BobaMomoOrder,
  Error,
  { momoId: string; values: MomoFormValues }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ momoId, values }) =>
      (client as ApiClient).fetchJson<BobaMomoOrder>(`/boba/momos/${momoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(momoToApiBody(values)),
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}

export function useCancelBobaMomoMutation(): UseMutationResult<
  BobaMomoOrder,
  Error,
  { momoId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ momoId }) =>
      (client as ApiClient).fetchJson<BobaMomoOrder>(`/boba/momos/${momoId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}

// ----------------------------------------------------------------------------
// Payment self-submit / undo — POST/DELETE /boba/payments/me
// ----------------------------------------------------------------------------

export function useSubmitBobaPaymentMutation(): UseMutationResult<
  BobaPayment,
  Error,
  { meal_window_id: string; reference?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      (client as ApiClient).fetchJson<BobaPayment>("/boba/payments/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}

export function useUndoBobaPaymentMutation(): UseMutationResult<
  BobaPayment,
  Error,
  { meal_window_id: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      (client as ApiClient).fetchJson<BobaPayment>("/boba/payments/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateBobaCaches(qc),
  });
}
