"use client";

import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMemo } from "react";
import {
  BOBA_MAX_TOPPINGS,
  BOBA_NOTES_MAX_LEN,
  buildBobaOrderSchema,
  DEFAULT_BOBA_FORM,
  ICE_VALUES,
  SWEETNESS_VALUES,
  drinkValuesFromOrder,
  momoValuesFromOrder,
  type BobaOrderFormValues,
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
  onSubmit: (values: BobaOrderFormValues) => Promise<void>;
};

export function BobaCombinedOrderForm({
  menu,
  isAdditional,
  onSubmit,
}: CombinedFormProps) {
  const schema = useMemo(() => buildBobaOrderSchema(buildSchemaInput(menu)), [menu]);

  const form = useForm({
    defaultValues: DEFAULT_BOBA_FORM,
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
      <p className="text-xs text-(--bearhacks-muted)">
        Pick a drink, momos, or both for this meal window. Toggle off whichever
        you don&apos;t want.
      </p>

      {/* DRINK SECTION ------------------------------------------------------ */}
      <form.Field name="includeDrink">
        {(field: TanField<boolean>) => (
          <SectionToggle
            id={field.name}
            checked={field.state.value}
            onChange={field.handleChange}
            title="Drink"
            subtitle="Tea + topping + size."
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.includeDrink}>
        {(include) =>
          include ? (
            <DrinkSubForm form={form} menu={menu} />
          ) : null
        }
      </form.Subscribe>

      {/* MOMO SECTION ------------------------------------------------------- */}
      <form.Field name="includeMomo">
        {(field: TanField<boolean>) => (
          <SectionToggle
            id={field.name}
            checked={field.state.value}
            onChange={field.handleChange}
            title={`Momos — ${formatPriceCents(menu.momos.price_cents)}`}
            subtitle={menu.momos.description}
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.includeMomo}>
        {(include) =>
          include ? <MomoSubForm form={form} menu={menu} /> : null
        }
      </form.Subscribe>

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          includeDrink: state.values.includeDrink,
          includeMomo: state.values.includeMomo,
        })}
      >
        {({ canSubmit, isSubmitting, includeDrink, includeMomo }) => (
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || isSubmitting || (!includeDrink && !includeMomo)}
            >
              {isSubmitting
                ? "Placing…"
                : isAdditional
                  ? "Place additional order"
                  : "Place order"}
            </Button>
            {!includeDrink && !includeMomo ? (
              <p className="text-xs text-red-700">
                Pick a drink, momos, or both.
              </p>
            ) : null}
          </div>
        )}
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
            {(field: TanField<string[]>) => {
              const selected = new Set(field.state.value);
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
              return (
                <FieldShell
                  label={`Topping (max ${BOBA_MAX_TOPPINGS}, optional)`}
                  htmlFor={field.name}
                  error={firstError(field.state.meta.errors)}
                  hint={`${selected.size}/${BOBA_MAX_TOPPINGS} selected`}
                >
                  <ul
                    id={field.name}
                    className="flex flex-col gap-2"
                    role="group"
                    aria-label="Toppings"
                  >
                    {menu.toppings.map((t) => {
                      const allowed = menu.topping_constraints[t.id];
                      const lockedByDrink =
                        allowed && currentDrink && !allowed.includes(currentDrink);
                      const isOn = selected.has(t.id);
                      const disabled = Boolean(lockedByDrink);
                      return (
                        <li key={t.id}>
                          <label
                            className={`flex min-h-(--bearhacks-touch-min) cursor-pointer items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) px-4 py-2 ${
                              isOn
                                ? "bg-(--bearhacks-accent-soft)"
                                : "bg-(--bearhacks-surface)"
                            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                          >
                            <input
                              type="radio"
                              name={field.name}
                              checked={isOn}
                              disabled={disabled}
                              onChange={() => toggle(t.id)}
                              className="h-4 w-4"
                            />
                            <span className="text-sm text-(--bearhacks-fg)">
                              {t.label}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </FieldShell>
              );
            }}
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
      <legend className="px-2 text-sm font-semibold text-(--bearhacks-primary)">
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
  // schema variant.
  const wrappedInitial: BobaOrderFormValues = {
    includeDrink: true,
    includeMomo: false,
    drink: initial,
    momo: { filling: "", sauce: "", notes: "" },
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
                  className="border-red-300 text-red-700 hover:bg-red-50"
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
                  className="border-red-300 text-red-700 hover:bg-red-50"
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
        className="text-sm font-medium text-(--bearhacks-primary)"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-(--bearhacks-muted)">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function SectionToggle({
  id,
  checked,
  onChange,
  title,
  subtitle,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
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
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-primary) focus:outline-none";

// `resize-y` restricts the drag-handle to vertical only so the width stays
// aligned with the form column, and `min-h-20` (5rem ≈ 2-row floor) prevents
// users from shrinking the notes field to a useless single-line sliver.
const textareaClasses =
  "min-h-20 resize-y rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-primary) focus:outline-none";

function pillClasses(isOn: boolean): string {
  return `min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-pill) border px-4 text-sm font-semibold transition-colors ${
    isOn
      ? "border-(--bearhacks-primary) bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
      : "border-(--bearhacks-border) bg-(--bearhacks-surface) text-(--bearhacks-primary) hover:bg-(--bearhacks-surface-alt)"
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
