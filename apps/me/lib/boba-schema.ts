import { z } from "zod";

/**
 * Boba ordering schema (apps/me).
 *
 * Mirrors `bearhacks-backend/routers/boba.py` (`BobaOrderInput` Pydantic model)
 * so client-side validation matches the server's accepted values exactly. Drink
 * and topping ids are validated dynamically against `/boba/menu` at runtime to
 * stay in sync with the backend without hard-coding the catalogue here.
 *
 * The numeric `sweetness` and string `ice` enums are first-class columns, so
 * we encode them as literal unions for autocomplete and exhaustive switches.
 */

export const SWEETNESS_VALUES = [0, 25, 50, 75, 100] as const;
export type Sweetness = (typeof SWEETNESS_VALUES)[number];

export const ICE_VALUES = ["none", "light", "regular", "extra"] as const;
export type Ice = (typeof ICE_VALUES)[number];

export const BOBA_MAX_TOPPINGS = 4;
export const BOBA_NOTES_MAX_LEN = 200;

export const sweetnessSchema = z.union([
  z.literal(0),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]);

export const iceSchema = z.enum(ICE_VALUES);

/** Form values used by TanStack Form. Keep exactly aligned with POST body. */
export type BobaOrderFormValues = {
  drink_id: string;
  topping_ids: string[];
  sweetness: Sweetness;
  ice: Ice;
  notes: string;
};

export const DEFAULT_BOBA_FORM: BobaOrderFormValues = {
  drink_id: "",
  topping_ids: [],
  sweetness: 50,
  ice: "regular",
  notes: "",
};

/**
 * Build a Zod schema once the menu catalogue is known. We refine `drink_id`
 * and `topping_ids` against the live catalogue so a renamed/removed drink in
 * the backend instantly surfaces as a validation error in the UI.
 */
export function buildBobaOrderSchema(menu: {
  drink_ids: ReadonlySet<string>;
  topping_ids: ReadonlySet<string>;
}) {
  return z.object({
    drink_id: z
      .string()
      .min(1, "Pick a drink")
      .refine((v) => menu.drink_ids.has(v), {
        message: "Unknown drink — refresh the menu",
      }),
    topping_ids: z
      .array(
        z.string().refine((v) => menu.topping_ids.has(v), {
          message: "Unknown topping",
        }),
      )
      .max(BOBA_MAX_TOPPINGS, `At most ${BOBA_MAX_TOPPINGS} toppings`)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "Duplicate topping",
      }),
    sweetness: sweetnessSchema,
    ice: iceSchema,
    notes: z
      .string()
      .max(BOBA_NOTES_MAX_LEN, `Notes must be ≤ ${BOBA_NOTES_MAX_LEN} characters`),
  });
}

export type BobaOrderSchema = ReturnType<typeof buildBobaOrderSchema>;

/** Convert form values into the JSON body the FastAPI endpoint expects. */
export function toApiBody(values: BobaOrderFormValues): {
  drink_id: string;
  topping_ids: string[];
  sweetness: Sweetness;
  ice: Ice;
  notes: string | null;
} {
  const trimmed = values.notes.trim();
  return {
    drink_id: values.drink_id,
    topping_ids: values.topping_ids,
    sweetness: values.sweetness,
    ice: values.ice,
    notes: trimmed.length > 0 ? trimmed : null,
  };
}

export function valuesFromOrder(order: {
  drink_id: string;
  topping_ids: string[];
  sweetness: number;
  ice: string;
  notes: string | null;
}): BobaOrderFormValues {
  return {
    drink_id: order.drink_id,
    topping_ids: order.topping_ids ?? [],
    sweetness: SWEETNESS_VALUES.includes(order.sweetness as Sweetness)
      ? (order.sweetness as Sweetness)
      : 50,
    ice: ICE_VALUES.includes(order.ice as Ice) ? (order.ice as Ice) : "regular",
    notes: order.notes ?? "",
  };
}
