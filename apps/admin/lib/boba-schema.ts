import { z } from "zod";

/**
 * Admin-side boba schema.
 *
 * Mirrors the server enums in `bearhacks-backend/routers/admin_boba.py` so
 * filter and bulk-action UIs can compose the same constants without drifting
 * from FastAPI. Hackers' write schema lives in `apps/me/lib/boba-schema.ts`
 * — admins do not place orders here, only triage them.
 */

export const STATUS_VALUES = ["placed", "cancelled", "fulfilled"] as const;
export type BobaStatus = (typeof STATUS_VALUES)[number];

export const STATUS_LABELS: Record<BobaStatus, string> = {
  placed: "Placed",
  cancelled: "Cancelled",
  fulfilled: "Fulfilled",
};

export const STATUS_BADGE_CLASSES: Record<BobaStatus, string> = {
  placed:
    "bg-(--bearhacks-accent) text-(--bearhacks-primary) border border-transparent",
  cancelled:
    "bg-(--bearhacks-surface-alt) text-(--bearhacks-muted) border border-(--bearhacks-border)",
  fulfilled:
    "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)",
};

export const adminFilterSchema = z.object({
  meal_window_id: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  search: z.string().optional(),
});

export type AdminFilterValues = z.infer<typeof adminFilterSchema>;

export const DEFAULT_ADMIN_FILTER: AdminFilterValues = {
  meal_window_id: undefined,
  status: undefined,
  search: undefined,
};

export const SWEETNESS_LABELS: Record<number, string> = {
  0: "0%",
  25: "25%",
  50: "50%",
  75: "75%",
  100: "100%",
};

export const ICE_LABELS: Record<string, string> = {
  none: "No ice",
  light: "Light",
  regular: "Regular",
  extra: "Extra",
};
