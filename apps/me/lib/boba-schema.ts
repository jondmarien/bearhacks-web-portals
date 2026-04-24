import { z } from "zod";

/**
 * Boba ordering schema (apps/me).
 *
 * Mirrors `bearhacks-backend/routers/boba.py` so client-side validation
 * matches the server's accepted values exactly. Drink, topping, size, and
 * momo option ids are validated dynamically against `/boba/menu` at runtime
 * to stay in sync with the backend without hard-coding the catalogue here.
 */

export const SWEETNESS_VALUES = [0, 25, 50, 75, 100] as const;
export type Sweetness = (typeof SWEETNESS_VALUES)[number];

export const ICE_VALUES = ["none", "light", "regular", "extra"] as const;
export type Ice = (typeof ICE_VALUES)[number];

export const SIZE_VALUES = ["medium", "large"] as const;
export type Size = (typeof SIZE_VALUES)[number];

/**
 * Vendor-imposed cap. The backend hard-enforces 1 topping per drink (down
 * from 4 in v1) so we mirror that locally. Stored as a constant so a future
 * relax/tighten is a single-line change.
 */
export const BOBA_MAX_TOPPINGS = 1;
export const BOBA_NOTES_MAX_LEN = 200;

// Mirrors the backend bounds in `routers/profiles.py` and the contact
// validators in `routers/boba.py`. Kept here so the form can show a
// consistent character counter / maxLength without round-tripping.
export const CONTACT_DISCORD_MAX_LEN = 50;
export const CONTACT_PHONE_MAX_LEN = 30;

export const sweetnessSchema = z.union([
  z.literal(0),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]);

export const iceSchema = z.enum(ICE_VALUES);
export const sizeSchema = z.enum(SIZE_VALUES);

export type DrinkFormValues = {
  drink_id: string;
  topping_ids: string[];
  sweetness: Sweetness;
  ice: Ice;
  size: Size;
  notes: string;
};

export type MomoFormValues = {
  filling: string;
  sauce: string;
  notes: string;
};

/**
 * Combined form values used by TanStack Form. ``includeDrink`` /
 * ``includeMomo`` say which sections are active. The submit handler only
 * sends the included sections to the backend; the backend rejects empty
 * submissions with HTTP 422.
 */
/**
 * Logistics contact info collected at order time. Either field can be
 * empty in the form, but the Zod schema (and the backend) enforce that
 * at least one is non-empty so the food team can always reach the hacker
 * about a paid order.
 */
export type ContactFormValues = {
  discord_username: string;
  phone_number: string;
};

export type BobaOrderFormValues = {
  includeDrink: boolean;
  includeMomo: boolean;
  drink: DrinkFormValues;
  momo: MomoFormValues;
  contact: ContactFormValues;
};

export const DEFAULT_DRINK_FORM: DrinkFormValues = {
  drink_id: "",
  topping_ids: [],
  sweetness: 50,
  ice: "regular",
  size: "medium",
  notes: "",
};

export const DEFAULT_MOMO_FORM: MomoFormValues = {
  filling: "",
  sauce: "",
  notes: "",
};

export const DEFAULT_CONTACT_FORM: ContactFormValues = {
  discord_username: "",
  phone_number: "",
};

export const DEFAULT_BOBA_FORM: BobaOrderFormValues = {
  includeDrink: true,
  includeMomo: false,
  drink: DEFAULT_DRINK_FORM,
  momo: DEFAULT_MOMO_FORM,
  contact: DEFAULT_CONTACT_FORM,
};

/**
 * Build a Zod schema once the menu catalogue is known. We refine ids
 * against the live catalogue so a renamed/removed drink in the backend
 * instantly surfaces as a validation error in the UI. ``toppingConstraints``
 * lets us enforce the Oreo-only-on-Coffee-Milk-Tea rule client-side.
 */
export function buildBobaOrderSchema(menu: {
  drink_ids: ReadonlySet<string>;
  topping_ids: ReadonlySet<string>;
  size_ids: ReadonlySet<string>;
  momo_filling_ids: ReadonlySet<string>;
  momo_sauce_ids: ReadonlySet<string>;
  topping_constraints: Readonly<Record<string, ReadonlySet<string>>>;
}) {
  const drinkSchema = z
    .object({
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
        .max(BOBA_MAX_TOPPINGS, `At most ${BOBA_MAX_TOPPINGS} topping`)
        .refine((arr) => new Set(arr).size === arr.length, {
          message: "Duplicate topping",
        }),
      sweetness: sweetnessSchema,
      ice: iceSchema,
      size: sizeSchema.refine((v) => menu.size_ids.has(v), {
        message: "Unknown size",
      }),
      notes: z
        .string()
        .max(BOBA_NOTES_MAX_LEN, `Notes must be ≤ ${BOBA_NOTES_MAX_LEN} characters`),
    })
    .superRefine((value, ctx) => {
      for (const tid of value.topping_ids) {
        const allowedDrinks = menu.topping_constraints[tid];
        if (allowedDrinks && !allowedDrinks.has(value.drink_id)) {
          ctx.addIssue({
            code: "custom",
            path: ["topping_ids"],
            message: `That topping isn't available with this drink.`,
          });
        }
      }
    });

  const momoSchema = z.object({
    filling: z
      .string()
      .min(1, "Pick a filling")
      .refine((v) => menu.momo_filling_ids.has(v), { message: "Unknown filling" }),
    sauce: z
      .string()
      .min(1, "Pick a sauce")
      .refine((v) => menu.momo_sauce_ids.has(v), { message: "Unknown sauce" }),
    notes: z
      .string()
      .max(BOBA_NOTES_MAX_LEN, `Notes must be ≤ ${BOBA_NOTES_MAX_LEN} characters`),
  });

  const contactSchema = z.object({
    discord_username: z
      .string()
      .max(
        CONTACT_DISCORD_MAX_LEN,
        `Discord username must be ≤ ${CONTACT_DISCORD_MAX_LEN} characters`,
      ),
    phone_number: z
      .string()
      .max(
        CONTACT_PHONE_MAX_LEN,
        `Phone number must be ≤ ${CONTACT_PHONE_MAX_LEN} characters`,
      ),
  });

  const drinkLooseSchema = z.object({
    drink_id: z.string(),
    topping_ids: z.array(z.string()),
    sweetness: sweetnessSchema,
    ice: iceSchema,
    size: sizeSchema,
    notes: z.string().max(BOBA_NOTES_MAX_LEN),
  });

  const momoLooseSchema = z.object({
    filling: z.string(),
    sauce: z.string(),
    notes: z.string().max(BOBA_NOTES_MAX_LEN),
  });

  return z
    .object({
      includeDrink: z.boolean(),
      includeMomo: z.boolean(),
      drink: drinkLooseSchema,
      momo: momoLooseSchema,
      contact: contactSchema,
    })
    .superRefine((value, ctx) => {
      if (!value.includeDrink && !value.includeMomo) {
        ctx.addIssue({
          code: "custom",
          path: ["includeDrink"],
          message: "Pick a drink, momos, or both.",
        });
      }
      if (value.includeDrink) {
        const result = drinkSchema.safeParse(value.drink);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["drink", ...issue.path] });
          }
        }
      }
      if (value.includeMomo) {
        const result = momoSchema.safeParse(value.momo);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["momo", ...issue.path] });
          }
        }
      }
      const discord = value.contact.discord_username.trim();
      const phone = value.contact.phone_number.trim();
      if (!discord && !phone) {
        ctx.addIssue({
          code: "custom",
          path: ["contact", "discord_username"],
          message: "Add a Discord username or phone number so we can reach you.",
        });
      }
    });
}

export type BobaOrderSchema = ReturnType<typeof buildBobaOrderSchema>;

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Convert combined form values into the JSON body the FastAPI endpoint expects. */
export function toApiBody(values: BobaOrderFormValues): {
  drink: {
    drink_id: string;
    topping_ids: string[];
    sweetness: Sweetness;
    ice: Ice;
    size: Size;
    notes: string | null;
  } | null;
  momo: {
    filling: string;
    sauce: string;
    notes: string | null;
  } | null;
  contact_discord_username: string | null;
  contact_phone_number: string | null;
} {
  return {
    drink: values.includeDrink
      ? {
          drink_id: values.drink.drink_id,
          topping_ids: values.drink.topping_ids,
          sweetness: values.drink.sweetness,
          ice: values.drink.ice,
          size: values.drink.size,
          notes: trimmedOrNull(values.drink.notes),
        }
      : null,
    momo: values.includeMomo
      ? {
          filling: values.momo.filling,
          sauce: values.momo.sauce,
          notes: trimmedOrNull(values.momo.notes),
        }
      : null,
    contact_discord_username: trimmedOrNull(values.contact.discord_username),
    contact_phone_number: trimmedOrNull(values.contact.phone_number),
  };
}

/** Convert just-the-drink edit values into the PATCH body for /boba/drinks/{id}. */
export function drinkToApiBody(values: DrinkFormValues): {
  drink_id: string;
  topping_ids: string[];
  sweetness: Sweetness;
  ice: Ice;
  size: Size;
  notes: string | null;
} {
  return {
    drink_id: values.drink_id,
    topping_ids: values.topping_ids,
    sweetness: values.sweetness,
    ice: values.ice,
    size: values.size,
    notes: trimmedOrNull(values.notes),
  };
}

/** Convert just-the-momo edit values into the PATCH body for /boba/momos/{id}. */
export function momoToApiBody(values: MomoFormValues): {
  filling: string;
  sauce: string;
  notes: string | null;
} {
  return {
    filling: values.filling,
    sauce: values.sauce,
    notes: trimmedOrNull(values.notes),
  };
}

export function drinkValuesFromOrder(order: {
  drink_id: string;
  topping_ids: string[] | null;
  sweetness: number;
  ice: string;
  size: string | null;
  notes: string | null;
}): DrinkFormValues {
  return {
    drink_id: order.drink_id,
    topping_ids: order.topping_ids ?? [],
    sweetness: SWEETNESS_VALUES.includes(order.sweetness as Sweetness)
      ? (order.sweetness as Sweetness)
      : 50,
    ice: ICE_VALUES.includes(order.ice as Ice) ? (order.ice as Ice) : "regular",
    size: SIZE_VALUES.includes(order.size as Size)
      ? (order.size as Size)
      : "medium",
    notes: order.notes ?? "",
  };
}

export function momoValuesFromOrder(order: {
  filling: string;
  sauce: string;
  notes: string | null;
}): MomoFormValues {
  return {
    filling: order.filling,
    sauce: order.sauce,
    notes: order.notes ?? "",
  };
}
