"use client";

import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useEffect, useMemo } from "react";
import {
  BOBA_MAX_TOPPINGS,
  BOBA_NOTES_MAX_LEN,
  CONTACT_DISCORD_MAX_LEN,
  CONTACT_PHONE_MAX_LEN,
  buildBobaOrderSchema,
  DEFAULT_BOBA_FORM,
  ICE_VALUES,
  SWEETNESS_VALUES,
  drinkValuesFromOrder,
  momoValuesFromOrder,
  type BobaOrderFormValues,
  type ContactFormValues,
  type DrinkFormValues,
  type Ice,
  type MomoFormValues,
  type Size,
  type Sweetness,
} from "@/lib/boba-schema";
import type { BobaMenuResponse } from "@/lib/boba-queries";
import { Button } from "@/components/ui/button";

const SWEETNESS_LABELS: Record<Sweetness, string> = {
  0: "0%",
  25: "25%",
  50: "50%",
  75: "75%",
  100: "100%",
};

const ICE_LABELS: Record<Ice, string> = {
  none: "No ice",
  light: "Light",
  regular: "Regular",
  extra: "Extra",
};

function buildSchemaInput(menu: BobaMenuResponse) {
  const constraints: Record<string, ReadonlySet<string>> = {};
  for (const [tid, drinkIds] of Object.entries(menu.topping_constraints ?? {})) {
    constraints[tid] = new Set(drinkIds);
  }
  return {
    drink_ids: new Set(menu.drinks.map((d) => d.id)),
    topping_ids: new Set(menu.toppings.map((t) => t.id)),
    size_ids: new Set(menu.sizes.map((s) => s.id)),
    momo_filling_ids: new Set(menu.momos.fillings.map((f) => f.id)),
    momo_sauce_ids: new Set(menu.momos.sauces.map((s) => s.id)),
    topping_constraints: constraints,
  };
}

function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Combined create form — drink + momo (either or both)
// ---------------------------------------------------------------------------

type CombinedFormProps = {
  menu: BobaMenuResponse;
  /** ``true`` after the user has already placed at least one drink/momo. */
  isAdditional: boolean;
  /** ``false`` when the hacker already placed a drink for this window. */
  canPlaceDrink?: boolean;
  /** ``false`` when the hacker already placed a momo order for this window. */
  canPlaceMomo?: boolean;
  /**
   * Contact info already saved on the hacker's profile (if any). Pre-fills
   * the contact section so a returning hacker doesn't re-enter what we
   * already have. ``null`` / undefined == treat as empty.
   */
  defaultContact?: ContactFormValues | null;
  onSubmit: (values: BobaOrderFormValues) => Promise<void>;
};

export function BobaCombinedOrderForm({
  menu,
  isAdditional,
  canPlaceDrink = true,
  canPlaceMomo = true,
  defaultContact,
  onSubmit,
}: CombinedFormProps) {
  const schema = useMemo(() => buildBobaOrderSchema(buildSchemaInput(menu)), [menu]);

  // Pre-toggle the section the hacker can still place. If both are open we
  // leave the defaults alone; if only one kind is available we flip the
  // toggles so the user doesn't have to tick a checkbox before the form
  // lets them continue. Contact defaults flow in from the profile so
  // returning hackers see their saved Discord/phone pre-populated.
  const initialValues = useMemo<BobaOrderFormValues>(() => {
    const base: BobaOrderFormValues = {
      ...DEFAULT_BOBA_FORM,
      contact: {
        discord_username: defaultContact?.discord_username ?? "",
        phone_number: defaultContact?.phone_number ?? "",
      },
    };
    if (canPlaceDrink && canPlaceMomo) return base;
    return {
      ...base,
      includeDrink: canPlaceDrink,
      includeMomo: canPlaceMomo,
    };
  }, [canPlaceDrink, canPlaceMomo, defaultContact]);

  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {/* DRINK SECTION ------------------------------------------------------ */}
      <form.Field name="includeDrink">
        {(field: TanField<boolean>) => (
          <SectionToggle
            id={field.name}
            checked={field.state.value && canPlaceDrink}
            onChange={(next) => {
              if (!canPlaceDrink) return;
              field.handleChange(next);
            }}
            disabled={!canPlaceDrink}
            title="Drink"
            subtitle={
              canPlaceDrink
                ? "Tea + topping + size."
                : "You already placed a drink for this window — edit or cancel it above."
            }
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.includeDrink}>
        {(include) =>
          include && canPlaceDrink ? (
            <DrinkSubForm form={form} menu={menu} />
          ) : null
        }
      </form.Subscribe>

      {/* MOMO SECTION ------------------------------------------------------- */}
      <form.Field name="includeMomo">
        {(field: TanField<boolean>) => (
          <SectionToggle
            id={field.name}
            checked={field.state.value && canPlaceMomo}
            onChange={(next) => {
              if (!canPlaceMomo) return;
              field.handleChange(next);
            }}
            disabled={!canPlaceMomo}
            title={`Momos — ${formatPriceCents(menu.momos.price_cents)}`}
            subtitle={
              canPlaceMomo
                ? menu.momos.description
                : "You already placed a momo order (5 momos) for this window — edit or cancel it above."
            }
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.includeMomo}>
        {(include) =>
          include && canPlaceMomo ? (
            <MomoSubForm form={form} menu={menu} />
          ) : null
        }
      </form.Subscribe>

      {/* CONTACT SECTION ---------------------------------------------------- */}
      <ContactSubForm form={form} hasSavedContact={Boolean(defaultContact)} />

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          values: state.values,
        })}
      >
        {({ canSubmit, isSubmitting, values }) => {
          const effectiveDrink = values.includeDrink && canPlaceDrink;
          const effectiveMomo = values.includeMomo && canPlaceMomo;

          const hasDrinkContent =
            effectiveDrink && values.drink.drink_id !== "";
          const hasMomoContent =
            effectiveMomo &&
            values.momo.filling !== "" &&
            values.momo.sauce !== "";
          const hasContent = hasDrinkContent || hasMomoContent;
          return (
            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={!canSubmit || isSubmitting || !hasContent}
              >
                {isSubmitting
                  ? "Placing…"
                  : isAdditional
                    ? "Place additional order"
                    : "Place order"}
              </Button>
              {!effectiveDrink && !effectiveMomo ? (
                <p className="text-xs text-(--bearhacks-danger)">
                  Pick a drink, momos, or both.
                </p>
              ) : !hasContent ? (
                <p className="text-xs text-(--bearhacks-muted)">
                  {effectiveDrink && !hasDrinkContent
                    ? "Pick a tea to enable Place order."
                    : "Pick a momo filling and sauce to enable Place order."}
                </p>
              ) : null}
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub-forms (shared between create and edit)
// ---------------------------------------------------------------------------

// TanStack Form's full generic chain (10 generics on `useForm` / `FieldApi`)
// is not portable across component boundaries without dragging every sibling
// generic along, so the `form` prop is intentionally opaque at the sub-form
// boundary. Inside each render callback we type the `field` with TanField<T>
// so value / handleChange stay sound — the Zod schema enforces correctness
// at submit time, and field-path strings mirror TanStack Form's own runtime
// contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = any;

/** Narrow projection of TanStack Form's FieldApi — what we actually render with. */
type TanField<T> = {
  name: string;
  state: { value: T; meta: { errors: readonly unknown[] } };
  handleChange: (next: T) => void;
  handleBlur: () => void;
};

/**
 * Topping picker for the drink sub-form.
 *
 * Rules encoded here (in addition to the Zod schema):
 *   1. No drink selected → every topping is locked. Without a drink we can't
 *      validate any constraint, and silently allowing a pick that will later
 *      be disabled is confusing (e.g. Oreo before picking Coffee Milk Tea).
 *   2. Drink changed → drop any selected topping that is no longer allowed
 *      for the new drink. Leaving a disabled-but-still-selected radio in
 *      form state would ship an invalid order on submit.
 */
function ToppingsFieldUI({
  field,
  menu,
  currentDrink,
}: {
  field: TanField<string[]>;
  menu: BobaMenuResponse;
  currentDrink: string;
}) {
  const noDrinkSelected = !currentDrink;
  const selectedValues = field.state.value;

  // Reconcile selections whenever the drink changes (or is cleared).
  useEffect(() => {
    if (selectedValues.length === 0) return;
    const next = selectedValues.filter((id) => {
      const allowed = menu.topping_constraints[id];
      if (!allowed) return true;
      if (!currentDrink) return false;
      return allowed.includes(currentDrink);
    });
    if (next.length !== selectedValues.length) {
      field.handleChange(next);
    }
    // field is stable enough across renders; listing it would cause spurious
    // re-runs without changing behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDrink, selectedValues, menu.topping_constraints]);

  const selected = new Set(selectedValues);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    // Hard 1-topping cap: clicking another topping replaces.
    else {
      next.clear();
      next.add(id);
    }
    field.handleChange(
      menu.toppings.filter((t) => next.has(t.id)).map((t) => t.id),
    );
  };

  const hint = noDrinkSelected
    ? "Pick a tea first to unlock toppings."
    : `${selected.size}/${BOBA_MAX_TOPPINGS} selected`;

  return (
    <FieldShell
      label={`Topping (max ${BOBA_MAX_TOPPINGS}, optional)`}
      htmlFor={field.name}
      error={firstError(field.state.meta.errors)}
      hint={hint}
    >
      <ul
        id={field.name}
        className="flex flex-col gap-2"
        role="group"
        aria-label="Toppings"
      >
        {menu.toppings.map((t) => {
          const allowed = menu.topping_constraints[t.id];
          const lockedByDrink = Boolean(
            allowed && currentDrink && !allowed.includes(currentDrink),
          );
          const disabled = noDrinkSelected || lockedByDrink;
          const isOn = selected.has(t.id);
          return (
            <li key={t.id}>
              <label
                className={`flex min-h-(--bearhacks-touch-min) items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) px-4 py-2 ${
                  isOn
                    ? "bg-(--bearhacks-accent-soft)"
                    : "bg-(--bearhacks-surface)"
                } ${
                  disabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name={field.name}
                  checked={isOn}
                  disabled={disabled}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-(--bearhacks-fg)">{t.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </FieldShell>
  );
}

function DrinkSubForm({
  form,
  menu,
}: {
  form: AnyForm;
  menu: BobaMenuResponse;
}) {
  return (
    // `aria-label` keeps the fieldset semantically grouped for assistive tech
    // without rendering a visible "Drink" legend — the section is already
    // labelled by the SectionToggle above ("Drink · Tea + topping + size.").
    <fieldset
      aria-label="Drink selection"
      className="flex flex-col gap-4 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-4"
    >
      <form.Field name="drink.drink_id">
        {(field: TanField<string>) => (
          <FieldShell
            label="Tea"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <select
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              className={selectClasses}
            >
              <option value="" disabled>
                Select a tea…
              </option>
              {menu.drinks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="drink.size">
        {(field: TanField<Size>) => (
          <FieldShell
            label="Size"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
            hint={priceHintForSize(menu, field.state.value as Size)}
          >
            <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-2">
              {menu.sizes.map((s) => {
                const isOn = field.state.value === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => field.handleChange(s.id as Size)}
                    onBlur={field.handleBlur}
                    className={pillClasses(isOn)}
                  >
                    {s.label} ·{" "}
                    {formatPriceCents(menu.payment.size_prices_cents[s.id] ?? 0)}
                  </button>
                );
              })}
            </div>
          </FieldShell>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state: { values: BobaOrderFormValues }) =>
          state.values.drink.drink_id
        }
      >
        {(currentDrink: string) => (
          <form.Field name="drink.topping_ids">
            {(field: TanField<string[]>) => (
              <ToppingsFieldUI
                field={field}
                menu={menu}
                currentDrink={currentDrink}
              />
            )}
          </form.Field>
        )}
      </form.Subscribe>

      <form.Field name="drink.sweetness">
        {(field: TanField<Sweetness>) => (
          <FieldShell
            label="Sweetness"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <div
              role="radiogroup"
              aria-label="Sweetness"
              className="flex flex-wrap gap-2"
            >
              {SWEETNESS_VALUES.map((value) => {
                const isOn = field.state.value === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => field.handleChange(value)}
                    onBlur={field.handleBlur}
                    className={pillClasses(isOn)}
                  >
                    {SWEETNESS_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="drink.ice">
        {(field: TanField<Ice>) => (
          <FieldShell
            label="Ice"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <div role="radiogroup" aria-label="Ice" className="flex flex-wrap gap-2">
              {ICE_VALUES.map((value) => {
                const isOn = field.state.value === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => field.handleChange(value)}
                    onBlur={field.handleBlur}
                    className={pillClasses(isOn)}
                  >
                    {ICE_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="drink.notes">
        {(field: TanField<string>) => (
          <FieldShell
            label="Drink notes (optional)"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
            hint={`${field.state.value.length}/${BOBA_NOTES_MAX_LEN}`}
          >
            <textarea
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              rows={2}
              maxLength={BOBA_NOTES_MAX_LEN}
              placeholder="Allergies, special asks, etc."
              className={textareaClasses}
            />
          </FieldShell>
        )}
      </form.Field>
    </fieldset>
  );
}

function MomoSubForm({
  form,
  menu,
}: {
  form: AnyForm;
  menu: BobaMenuResponse;
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-4">
      <legend className="px-2 text-sm font-semibold text-(--bearhacks-title)">
        Momos — {formatPriceCents(menu.momos.price_cents)}
      </legend>

      <form.Field name="momo.filling">
        {(field: TanField<string>) => (
          <FieldShell
            label="Filling"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <div
              role="radiogroup"
              aria-label="Filling"
              className="flex flex-wrap gap-2"
            >
              {menu.momos.fillings.map((f) => {
                const isOn = field.state.value === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => field.handleChange(f.id)}
                    onBlur={field.handleBlur}
                    className={pillClasses(isOn)}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="momo.sauce">
        {(field: TanField<string>) => (
          <FieldShell
            label="Sauce"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <div
              role="radiogroup"
              aria-label="Sauce"
              className="flex flex-wrap gap-2"
            >
              {menu.momos.sauces.map((s) => {
                const isOn = field.state.value === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={isOn}
                    onClick={() => field.handleChange(s.id)}
                    onBlur={field.handleBlur}
                    className={pillClasses(isOn)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="momo.notes">
        {(field: TanField<string>) => (
          <FieldShell
            label="Momo notes (optional)"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
            hint={`${field.state.value.length}/${BOBA_NOTES_MAX_LEN}`}
          >
            <textarea
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              rows={2}
              maxLength={BOBA_NOTES_MAX_LEN}
              placeholder="Allergies, spice level, etc."
              className={textareaClasses}
            />
          </FieldShell>
        )}
      </form.Field>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Contact sub-form — Discord username + phone number, at least one required
// ---------------------------------------------------------------------------

function ContactSubForm({
  form,
  hasSavedContact,
}: {
  form: AnyForm;
  hasSavedContact: boolean;
}) {
  return (
    <fieldset
      aria-label="Contact info for logistics"
      className="flex flex-col gap-4 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <legend className="text-sm font-semibold text-(--bearhacks-title)">
          How can we reach you?
        </legend>
        <p className="text-xs text-(--bearhacks-muted)">
          {hasSavedContact
            ? "Saved on your profile — edit if it's changed. Used by the food team to find you at pickup."
            : "We'll save this to your profile so you don't need to re-enter it. At least one is required."}
        </p>
      </div>

      <form.Field name="contact.discord_username">
        {(field: TanField<string>) => (
          <FieldShell
            label="Discord username"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
            hint={`${field.state.value.length}/${CONTACT_DISCORD_MAX_LEN}`}
          >
            <input
              id={field.name}
              type="text"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              maxLength={CONTACT_DISCORD_MAX_LEN}
              autoComplete="username"
              placeholder="e.g. yourname"
              className={inputClasses}
            />
          </FieldShell>
        )}
      </form.Field>

      <form.Field name="contact.phone_number">
        {(field: TanField<string>) => (
          <FieldShell
            label="Mobile number"
            htmlFor={field.name}
            error={firstError(field.state.meta.errors)}
          >
            <input
              id={field.name}
              type="tel"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              maxLength={CONTACT_PHONE_MAX_LEN}
              autoComplete="tel"
              inputMode="tel"
              placeholder="e.g. +1 555 123 4567"
              className={inputClasses}
            />
          </FieldShell>
        )}
      </form.Field>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Edit forms (single drink or single momo)
// ---------------------------------------------------------------------------

type EditDrinkFormProps = {
  menu: BobaMenuResponse;
  initial: DrinkFormValues;
  onSubmit: (values: DrinkFormValues) => Promise<void>;
  onCancelEdit: () => void;
  /** Promise-returning cancel-this-drink action. ``null`` to hide the button. */
  onCancelOrder: (() => Promise<void>) | null;
  isCancelling: boolean;
};

export function BobaDrinkEditForm({
  menu,
  initial,
  onSubmit,
  onCancelEdit,
  onCancelOrder,
  isCancelling,
}: EditDrinkFormProps) {
  // Wrap the drink-only edit values in the combined shape so we can reuse
  // the same Zod schema + DrinkSubForm without duplicating a single-shape
  // schema variant. The contact section is intentionally absent from the
  // edit form (contact lives on the profile, not per-order); we seed the
  // schema with the order's snapshot so validation still passes.
  const wrappedInitial: BobaOrderFormValues = {
    includeDrink: true,
    includeMomo: false,
    drink: initial,
    momo: { filling: "", sauce: "", notes: "" },
    contact: {
      discord_username: "edit-mode-bypass",
      phone_number: "",
    },
  };
  const schema = useMemo(() => buildBobaOrderSchema(buildSchemaInput(menu)), [menu]);

  const form = useForm({
    defaultValues: wrappedInitial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      await onSubmit(value.drink);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <DrinkSubForm form={form} menu={menu} />

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          isDirty: state.isDirty,
        })}
      >
        {({ canSubmit, isSubmitting, isDirty }) => (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancelEdit}
                disabled={isSubmitting}
              >
                Stop editing
              </Button>
              {onCancelOrder ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onCancelOrder()}
                  disabled={isCancelling || isSubmitting}
                  className="border-(--bearhacks-danger)/40 text-(--bearhacks-danger) hover:bg-(--bearhacks-danger-soft)"
                >
                  {isCancelling ? "Cancelling…" : "Cancel drink"}
                </Button>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || isSubmitting || !isDirty}
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

type EditMomoFormProps = {
  menu: BobaMenuResponse;
  initial: MomoFormValues;
  onSubmit: (values: MomoFormValues) => Promise<void>;
  onCancelEdit: () => void;
  onCancelOrder: (() => Promise<void>) | null;
  isCancelling: boolean;
};

export function BobaMomoEditForm({
  menu,
  initial,
  onSubmit,
  onCancelEdit,
  onCancelOrder,
  isCancelling,
}: EditMomoFormProps) {
  const wrappedInitial: BobaOrderFormValues = {
    includeDrink: false,
    includeMomo: true,
    drink: { ...DEFAULT_BOBA_FORM.drink },
    momo: initial,
    contact: {
      discord_username: "edit-mode-bypass",
      phone_number: "",
    },
  };
  const schema = useMemo(() => buildBobaOrderSchema(buildSchemaInput(menu)), [menu]);

  const form = useForm({
    defaultValues: wrappedInitial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema },
    onSubmit: async ({ value }) => {
      await onSubmit(value.momo);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <MomoSubForm form={form} menu={menu} />

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          isDirty: state.isDirty,
        })}
      >
        {({ canSubmit, isSubmitting, isDirty }) => (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancelEdit}
                disabled={isSubmitting}
              >
                Stop editing
              </Button>
              {onCancelOrder ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onCancelOrder()}
                  disabled={isCancelling || isSubmitting}
                  className="border-(--bearhacks-danger)/40 text-(--bearhacks-danger) hover:bg-(--bearhacks-danger-soft)"
                >
                  {isCancelling ? "Cancelling…" : "Cancel momos"}
                </Button>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || isSubmitting || !isDirty}
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

// Re-export converters so the page can use them without re-importing the
// schema module directly when it's already pulling form components.
export { drinkValuesFromOrder, momoValuesFromOrder };

// ---------------------------------------------------------------------------
// Tiny styling helpers (kept inside this module so the page stays clean)
// ---------------------------------------------------------------------------

function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-(--bearhacks-title)"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-(--bearhacks-muted)">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-(--bearhacks-danger)">{error}</p> : null}
    </div>
  );
}

function SectionToggle({
  id,
  checked,
  onChange,
  title,
  subtitle,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  subtitle?: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-(--bearhacks-fg)">{title}</span>
        {subtitle ? (
          <span className="text-xs text-(--bearhacks-muted)">{subtitle}</span>
        ) : null}
      </span>
    </label>
  );
}

function priceHintForSize(menu: BobaMenuResponse, size: Size): string {
  const cents = menu.payment.size_prices_cents[size];
  if (cents == null) return "";
  return `${formatPriceCents(cents)} CAD · ${menu.payment.discount_note}`;
}

const selectClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-focus-ring) focus:outline-none";

const inputClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none";

// `resize-y` restricts the drag-handle to vertical only so the width stays
// aligned with the form column, `min-h-20` (5rem ≈ 2-row floor) prevents
// users from shrinking the notes field to a useless single-line sliver, and
// `max-h-64` (16rem ≈ 12 rows) caps the upper drag so the notes area can't
// swallow the viewport — these fields back ≤200-char allergy/special-ask
// notes, not free-form prose.
const textareaClasses =
  "min-h-20 max-h-64 resize-y rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none";

function pillClasses(isOn: boolean): string {
  return `min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-pill) border px-4 text-sm font-semibold transition-colors ${
    isOn
      ? "border-(--bearhacks-primary) bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
      : "border-(--bearhacks-border-strong) bg-(--bearhacks-surface) text-(--bearhacks-fg) hover:bg-(--bearhacks-surface-alt)"
  }`;
}

function firstError(errors: unknown): string | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const head = errors[0];
  if (head == null) return undefined;
  if (typeof head === "string") return head;
  if (typeof head === "object" && "message" in head) {
    const m = (head as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}
