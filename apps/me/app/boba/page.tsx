"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { BobaStatusCard } from "@/components/boba-status-card";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  useBobaMenuQuery,
  useBobaWindowsQuery,
  useCancelBobaOrderMutation,
  useCreateBobaOrderMutation,
  useMyBobaOrderQuery,
  useUpdateBobaOrderMutation,
  type BobaMenuResponse,
  type BobaOrder,
} from "@/lib/boba-queries";
import {
  BOBA_MAX_TOPPINGS,
  BOBA_NOTES_MAX_LEN,
  buildBobaOrderSchema,
  DEFAULT_BOBA_FORM,
  ICE_VALUES,
  SWEETNESS_VALUES,
  type Ice,
  type Sweetness,
  valuesFromOrder,
} from "@/lib/boba-schema";
import { useDocumentTitle } from "@/lib/use-document-title";

const log = createLogger("me/boba-order");

const SWEETNESS_LABELS: Record<Sweetness, string> = {
  0: "0% (no sugar)",
  25: "25%",
  50: "50%",
  75: "75%",
  100: "100% (full sugar)",
};

const ICE_LABELS: Record<Ice, string> = {
  none: "No ice",
  light: "Light ice",
  regular: "Regular ice",
  extra: "Extra ice",
};

export default function BobaOrderPage() {
  const auth = useMeAuth();
  const router = useRouter();
  const userId = auth?.user?.id ?? null;
  const confirm = useConfirm();

  useDocumentTitle("Boba ordering");

  const menuQuery = useBobaMenuQuery();
  const windowsQuery = useBobaWindowsQuery();
  const myOrderQuery = useMyBobaOrderQuery(userId);

  const createMutation = useCreateBobaOrderMutation(userId);
  const updateMutation = useUpdateBobaOrderMutation(userId);
  const cancelMutation = useCancelBobaOrderMutation(userId);

  const activeWindowId = windowsQuery.data?.active_window_id ?? null;
  const activeWindow = useMemo(() => {
    if (!activeWindowId || !windowsQuery.data) return null;
    return windowsQuery.data.windows.find((w) => w.id === activeWindowId) ?? null;
  }, [activeWindowId, windowsQuery.data]);

  // Multi-order support: dev-test window may allow N drinks per user. Real
  // meal windows still cap at 1; the UI degrades to the original
  // single-order experience for them.
  //
  // Pull the array reference inside useMemo so the dep is the stable
  // ``myOrderQuery.data?.orders`` (only changes when the query data changes)
  // instead of a fresh ``[]`` literal allocated every render.
  const ordersSource = myOrderQuery.data?.orders;
  const ordersForActiveWindow = useMemo(
    () =>
      activeWindowId
        ? (ordersSource ?? []).filter(
            (o) => o.meal_window_id === activeWindowId,
          )
        : [],
    [ordersSource, activeWindowId],
  );
  const placedOrders = useMemo(
    () => ordersForActiveWindow.filter((o) => o.status === "placed"),
    [ordersForActiveWindow],
  );
  const placedCount = myOrderQuery.data?.placed_count ?? placedOrders.length;
  const maxOrders = myOrderQuery.data?.max_orders ?? 1;
  const isMultiCap = maxOrders > 1;
  const canPlaceMore = placedCount < maxOrders;

  // ``mode`` says which order (if any) the form below is currently bound to.
  //   - "auto":  defer to the cap-based default (single-cap → most recent
  //              placed order; multi-cap → place-new mode).
  //   - "new":   explicitly placing an additional drink (multi-cap only).
  //   - { kind: "edit", orderId }: editing a specific drink the hacker
  //              picked from the list above.
  type FormMode =
    | { kind: "auto" }
    | { kind: "new" }
    | { kind: "edit"; orderId: string };
  const [mode, setMode] = useState<FormMode>({ kind: "auto" });

  const editableOrder: BobaOrder | null = (() => {
    if (mode.kind === "edit") {
      return placedOrders.find((o) => o.id === mode.orderId) ?? null;
    }
    if (mode.kind === "new") return null;
    // auto: only auto-bind when the cap is 1 (single-order behaviour).
    if (!isMultiCap) {
      return placedOrders[0] ?? null;
    }
    return null;
  })();

  // Hide the form entirely in multi-cap when the hacker has hit the cap and
  // hasn't picked a specific drink to edit. They can still cancel from the
  // list above to free a slot.
  const formVisible =
    !isMultiCap || mode.kind === "edit" || canPlaceMore;

  if (!auth?.isAuthReady) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
        <p className="text-sm text-(--bearhacks-muted)">Checking session…</p>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
        <PageHeader title="Boba ordering" showBack backHref="/" />
        <Card>
          <CardHeader>
            <CardTitle>Sign in to order</CardTitle>
            <CardDescription>
              Hackers must be signed in to place a drink for the active meal
              window.
            </CardDescription>
          </CardHeader>
          <Button onClick={() => router.push("/?next=/boba")}>Sign in</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <PageHeader
        title="Boba ordering"
        subtitle={
          isMultiCap
            ? `Up to ${maxOrders} drinks per hacker for this window. Edit or cancel until the window closes.`
            : "One drink per meal window. Edit or cancel until the window closes."
        }
        showBack
        backHref="/"
        tone="marketing"
      />

      <BobaStatusCard isAuthReady userId={userId} hideEditCta />

      {menuQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t load the menu</CardTitle>
            <CardDescription>
              {menuQuery.error instanceof ApiError
                ? menuQuery.error.message
                : "Please try again in a moment."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!activeWindow ? null : !menuQuery.data ? (
        <Card>
          <p className="text-sm text-(--bearhacks-muted)">Loading menu…</p>
        </Card>
      ) : (
        <>
          {isMultiCap && placedOrders.length > 0 ? (
            <PlacedOrdersList
              orders={placedOrders}
              menu={menuQuery.data}
              maxOrders={maxOrders}
              placedCount={placedCount}
              canPlaceMore={canPlaceMore}
              currentEditingId={
                mode.kind === "edit" ? mode.orderId : null
              }
              isCancelling={cancelMutation.isPending}
              onEdit={(orderId) => {
                setMode({ kind: "edit", orderId });
                if (typeof window !== "undefined") {
                  window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
                }
              }}
              onAddAnother={() => setMode({ kind: "new" })}
              onCancelOrder={async (orderId) => {
                const ok = await confirm({
                  title: "Cancel this drink?",
                  description:
                    "You can place a new drink later as long as the meal window is still open.",
                  confirmLabel: "Cancel drink",
                  cancelLabel: "Keep drink",
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await cancelMutation.mutateAsync({ orderId });
                  toast.success("Drink cancelled");
                  // If the cancelled drink was the one being edited, drop
                  // back to a clean place-new form.
                  if (mode.kind === "edit" && mode.orderId === orderId) {
                    setMode({ kind: "new" });
                  }
                } catch (error) {
                  log.error("Boba order cancel failed", { userId, error });
                  toast.error(
                    error instanceof ApiError
                      ? error.message
                      : "Failed to cancel drink",
                  );
                }
              }}
            />
          ) : null}

          {formVisible ? (
            <BobaOrderForm
              key={
                editableOrder
                  ? `edit-${editableOrder.id}`
                  : `new-${activeWindow.id}-${mode.kind}`
              }
              menu={menuQuery.data}
              isEditing={Boolean(editableOrder)}
              existingOrderId={editableOrder?.id ?? null}
              isAdditionalDrink={isMultiCap && !editableOrder && placedOrders.length > 0}
              initial={
                editableOrder
                  ? valuesFromOrder(editableOrder)
                  : DEFAULT_BOBA_FORM
              }
              onSubmit={async (values) => {
                try {
                  if (editableOrder) {
                    await updateMutation.mutateAsync({
                      orderId: editableOrder.id,
                      values,
                    });
                    toast.success("Order updated");
                    // Stay on the edited drink so the form keeps showing it.
                    setMode({ kind: "edit", orderId: editableOrder.id });
                  } else {
                    await createMutation.mutateAsync(values);
                    toast.success("Order placed");
                    // After a successful place, return to "auto" so the
                    // next mode is decided by the cap (single-cap will
                    // bind to the new order; multi-cap will reset to a
                    // clean "place another" form on demand).
                    setMode({ kind: "auto" });
                  }
                } catch (error) {
                  log.error("Boba order submit failed", { userId, error });
                  const message =
                    error instanceof ApiError ? error.message : "Failed to save order";
                  toast.error(message);
                  throw error;
                }
              }}
              onCancel={
                editableOrder
                  ? async () => {
                      const ok = await confirm({
                        title: "Cancel this order?",
                        description:
                          "You can place a new order later as long as the meal window is still open.",
                        confirmLabel: "Cancel order",
                        cancelLabel: "Keep order",
                        tone: "danger",
                      });
                      if (!ok) return;
                      try {
                        await cancelMutation.mutateAsync({
                          orderId: editableOrder.id,
                        });
                        toast.success("Order cancelled");
                        if (isMultiCap) setMode({ kind: "new" });
                      } catch (error) {
                        log.error("Boba order cancel failed", { userId, error });
                        toast.error(
                          error instanceof ApiError
                            ? error.message
                            : "Failed to cancel order",
                        );
                      }
                    }
                  : null
              }
              isCancelling={cancelMutation.isPending}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>You&apos;re at the limit</CardTitle>
                <CardDescription>
                  You&apos;ve placed {placedCount} of {maxOrders} drinks for
                  this window. Cancel one above to free a slot, or use Edit to
                  change an existing drink.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </>
      )}
    </main>
  );
}

type PlacedOrdersListProps = {
  orders: BobaOrder[];
  menu: BobaMenuResponse;
  maxOrders: number;
  placedCount: number;
  canPlaceMore: boolean;
  currentEditingId: string | null;
  isCancelling: boolean;
  onEdit: (orderId: string) => void;
  onAddAnother: () => void;
  onCancelOrder: (orderId: string) => Promise<void>;
};

/**
 * Multi-cap-only summary list of every drink the hacker has placed for the
 * active window. Each row exposes Edit + Cancel; the page header says
 * "X of Y drinks placed" and the bottom action either kicks off another
 * order or is hidden if we're at the cap.
 */
function PlacedOrdersList({
  orders,
  menu,
  maxOrders,
  placedCount,
  canPlaceMore,
  currentEditingId,
  isCancelling,
  onEdit,
  onAddAnother,
  onCancelOrder,
}: PlacedOrdersListProps) {
  const drinkLabel = (drinkId: string) =>
    menu.drinks.find((d) => d.id === drinkId)?.label ?? drinkId;
  const toppingLabel = (toppingId: string) =>
    menu.toppings.find((t) => t.id === toppingId)?.label ?? toppingId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your drinks for this window</CardTitle>
        <CardDescription>
          {placedCount} of {maxOrders} placed. Edit or cancel any drink while
          the window is open.
        </CardDescription>
      </CardHeader>

      <ul className="flex flex-col gap-3">
        {orders.map((order) => {
          const isEditing = currentEditingId === order.id;
          return (
            <li
              key={order.id}
              className={`flex flex-col gap-2 rounded-(--bearhacks-radius-md) border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                isEditing
                  ? "border-(--bearhacks-accent) bg-(--bearhacks-accent-soft)"
                  : "border-(--bearhacks-border) bg-(--bearhacks-surface)"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-(--bearhacks-fg)">
                  {drinkLabel(order.drink_id)}
                </p>
                <p className="text-xs text-(--bearhacks-muted)">
                  {order.sweetness}% sweet · {order.ice} ice
                  {order.topping_ids.length > 0
                    ? ` · ${order.topping_ids.map(toppingLabel).join(", ")}`
                    : " · no toppings"}
                </p>
                {order.notes ? (
                  <p className="text-xs text-(--bearhacks-muted)">
                    Note: {order.notes}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={isEditing ? "primary" : "ghost"}
                  onClick={() => onEdit(order.id)}
                >
                  {isEditing ? "Editing…" : "Edit"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isCancelling}
                  onClick={() => void onCancelOrder(order.id)}
                >
                  Cancel
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {canPlaceMore ? (
        <div className="mt-4">
          <Button type="button" variant="primary" onClick={onAddAnother}>
            Add another drink
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-(--bearhacks-muted)">
          You&apos;re at the cap of {maxOrders} drink
          {maxOrders === 1 ? "" : "s"}. Cancel one above to free a slot.
        </p>
      )}
    </Card>
  );
}

type BobaOrderFormProps = {
  menu: BobaMenuResponse;
  isEditing: boolean;
  existingOrderId: string | null;
  /**
   * Multi-cap "place another drink" mode: the form is still in create mode
   * (POST), but the title/copy reflects "another" instead of the first.
   */
  isAdditionalDrink?: boolean;
  initial: ReturnType<typeof valuesFromOrder>;
  onSubmit: (values: ReturnType<typeof valuesFromOrder>) => Promise<void>;
  onCancel: (() => Promise<void>) | null;
  isCancelling: boolean;
};

function BobaOrderForm({
  menu,
  isEditing,
  isAdditionalDrink = false,
  initial,
  onSubmit,
  onCancel,
  isCancelling,
}: BobaOrderFormProps) {
  const schema = useMemo(
    () =>
      buildBobaOrderSchema({
        drink_ids: new Set(menu.drinks.map((d) => d.id)),
        topping_ids: new Set(menu.toppings.map((t) => t.id)),
      }),
    [menu],
  );

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: schema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEditing
            ? "Edit your drink"
            : isAdditionalDrink
              ? "Place another drink"
              : "Place your order"}
        </CardTitle>
        <CardDescription>
          Pick a drink, toppings, sweetness, and ice. The food team will batch
          pickups in time for the meal window.
        </CardDescription>
      </CardHeader>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="drink_id">
          {(field) => (
            <FieldShell
              label="Drink"
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
                  Select a drink…
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

        <form.Field name="topping_ids">
          {(field) => {
            const selected = new Set(field.state.value);
            const toggle = (id: string) => {
              const next = new Set(selected);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              field.handleChange(
                menu.toppings.filter((t) => next.has(t.id)).map((t) => t.id),
              );
            };
            return (
              <FieldShell
                label={`Toppings (max ${BOBA_MAX_TOPPINGS})`}
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
                    const isOn = selected.has(t.id);
                    const disabled = !isOn && selected.size >= BOBA_MAX_TOPPINGS;
                    return (
                      <li key={t.id}>
                        <label
                          className={`flex min-h-(--bearhacks-touch-min) cursor-pointer items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) px-4 py-2 ${
                            isOn
                              ? "bg-(--bearhacks-accent-soft)"
                              : "bg-(--bearhacks-surface)"
                          } ${disabled ? "opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
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

        <form.Field name="sweetness">
          {(field) => (
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
                      className={`min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-pill) border px-4 text-sm font-semibold transition-colors ${
                        isOn
                          ? "border-(--bearhacks-primary) bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
                          : "border-(--bearhacks-border) bg-(--bearhacks-surface) text-(--bearhacks-primary) hover:bg-(--bearhacks-surface-alt)"
                      }`}
                    >
                      {SWEETNESS_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </FieldShell>
          )}
        </form.Field>

        <form.Field name="ice">
          {(field) => (
            <FieldShell
              label="Ice"
              htmlFor={field.name}
              error={firstError(field.state.meta.errors)}
            >
              <div
                role="radiogroup"
                aria-label="Ice"
                className="flex flex-wrap gap-2"
              >
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
                      className={`min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-pill) border px-4 text-sm font-semibold transition-colors ${
                        isOn
                          ? "border-(--bearhacks-primary) bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
                          : "border-(--bearhacks-border) bg-(--bearhacks-surface) text-(--bearhacks-primary) hover:bg-(--bearhacks-surface-alt)"
                      }`}
                    >
                      {ICE_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </FieldShell>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <FieldShell
              label="Notes (optional)"
              htmlFor={field.name}
              error={firstError(field.state.meta.errors)}
              hint={`${field.state.value.length}/${BOBA_NOTES_MAX_LEN}`}
            >
              <textarea
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={3}
                maxLength={BOBA_NOTES_MAX_LEN}
                placeholder="Allergies, special asks, etc."
                className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-primary) focus:outline-none"
              />
            </FieldShell>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
            isDirty: state.isDirty,
          })}
        >
          {({ canSubmit, isSubmitting, isDirty }) => (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              {onCancel ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void onCancel()}
                  disabled={isCancelling || isSubmitting}
                >
                  {isCancelling ? "Cancelling…" : "Cancel order"}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                disabled={
                  !canSubmit || isSubmitting || (isEditing && !isDirty)
                }
              >
                {isSubmitting
                  ? isEditing
                    ? "Saving…"
                    : "Placing…"
                  : isEditing
                    ? "Save changes"
                    : isAdditionalDrink
                      ? "Place another drink"
                      : "Place order"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </Card>
  );
}

type FieldShellProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
};

function FieldShell({ label, htmlFor, error, hint, children }: FieldShellProps) {
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

const selectClasses =
  "min-h-(--bearhacks-touch-min) w-full rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-primary) focus:outline-none";

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
