"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { AllergenInfoModal } from "@/components/allergen-info-modal";
import { BobaStatusCard } from "@/components/boba-status-card";
import { BobaPaymentCard } from "@/components/boba-payment-card";
import {
  BobaCombinedOrderForm,
  BobaDrinkEditForm,
  BobaMomoEditForm,
  drinkValuesFromOrder,
  momoValuesFromOrder,
} from "@/components/boba-order-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  useBobaMenuQuery,
  useBobaWindowsQuery,
  useCancelBobaDrinkMutation,
  useCancelBobaMomoMutation,
  useCreateBobaOrderMutation,
  useMyBobaOrderQuery,
  useUpdateBobaDrinkMutation,
  useUpdateBobaMomoMutation,
  type BobaMenuResponse,
  type BobaMomoOrder,
  type BobaOrder,
} from "@/lib/boba-queries";
import { useDocumentTitle } from "@/lib/use-document-title";

const log = createLogger("me/boba-order");

type EditTarget =
  | { kind: "drink"; id: string }
  | { kind: "momo"; id: string }
  | null;

export default function BobaOrderPage() {
  const auth = useMeAuth();
  const router = useRouter();
  const userId = auth?.user?.id ?? null;
  const confirm = useConfirm();

  useDocumentTitle("Boba & Momo ordering");

  const menuQuery = useBobaMenuQuery();
  const windowsQuery = useBobaWindowsQuery();
  const myOrderQuery = useMyBobaOrderQuery(userId);

  const createMutation = useCreateBobaOrderMutation();
  const updateDrinkMutation = useUpdateBobaDrinkMutation();
  const cancelDrinkMutation = useCancelBobaDrinkMutation();
  const updateMomoMutation = useUpdateBobaMomoMutation();
  const cancelMomoMutation = useCancelBobaMomoMutation();

  const activeWindowId = windowsQuery.data?.active_window_id ?? null;
  const activeWindow = useMemo(() => {
    if (!activeWindowId || !windowsQuery.data) return null;
    return windowsQuery.data.windows.find((w) => w.id === activeWindowId) ?? null;
  }, [activeWindowId, windowsQuery.data]);

  const drinksSource = myOrderQuery.data?.drinks;
  const momosSource = myOrderQuery.data?.momos;

  const placedDrinks = useMemo(
    () =>
      activeWindowId
        ? (drinksSource ?? []).filter(
            (o) => o.meal_window_id === activeWindowId && o.status === "placed",
          )
        : [],
    [drinksSource, activeWindowId],
  );

  const placedMomos = useMemo(
    () =>
      activeWindowId
        ? (momosSource ?? []).filter(
            (o) => o.meal_window_id === activeWindowId && o.status === "placed",
          )
        : [],
    [momosSource, activeWindowId],
  );

  const placedCount = myOrderQuery.data?.placed_count ?? 0;
  const maxOrders = myOrderQuery.data?.max_orders ?? 1;
  const canPlaceMore = placedCount < maxOrders;

  const [editTarget, setEditTarget] = useState<EditTarget>(null);

  // Anything placed at all? Used to flip the "place your first order" copy.
  const hasAnyPlaced = placedDrinks.length > 0 || placedMomos.length > 0;

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
        <PageHeader title="Boba & Momo ordering" showBack backHref="/" />
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
        title="Boba & Momo ordering"
        subtitle={
          maxOrders > 1
            ? `Up to ${maxOrders} drinks/momos per hacker for this window. Edit or cancel until the window closes.`
            : "One drink/momo per meal window. Edit or cancel until the window closes."
        }
        showBack
        backHref="/"
        tone="marketing"
      />

      <BobaStatusCard isAuthReady userId={userId} hideEditCta />

      {activeWindow ? (
        <div className="flex justify-end">
          <AllergenInfoModal />
        </div>
      ) : null}

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
          {placedDrinks.length > 0 ? (
            <PlacedDrinksCard
              drinks={placedDrinks}
              menu={menuQuery.data}
              editingId={editTarget?.kind === "drink" ? editTarget.id : null}
              onStartEdit={(id) => setEditTarget({ kind: "drink", id })}
              onStopEdit={() => setEditTarget(null)}
              onSaveEdit={async (id, values) => {
                try {
                  await updateDrinkMutation.mutateAsync({
                    orderId: id,
                    values,
                  });
                  toast.success("Drink updated");
                  setEditTarget(null);
                } catch (error) {
                  log.error("Drink update failed", { userId, error });
                  toast.error(
                    error instanceof ApiError
                      ? error.message
                      : "Failed to save drink",
                  );
                  throw error;
                }
              }}
              onCancelOrder={async (id) => {
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
                  await cancelDrinkMutation.mutateAsync({ orderId: id });
                  toast.success("Drink cancelled");
                  setEditTarget(null);
                } catch (error) {
                  log.error("Drink cancel failed", { userId, error });
                  toast.error(
                    error instanceof ApiError
                      ? error.message
                      : "Failed to cancel drink",
                  );
                }
              }}
              isCancelling={cancelDrinkMutation.isPending}
            />
          ) : null}

          {placedMomos.length > 0 ? (
            <PlacedMomosCard
              momos={placedMomos}
              menu={menuQuery.data}
              editingId={editTarget?.kind === "momo" ? editTarget.id : null}
              onStartEdit={(id) => setEditTarget({ kind: "momo", id })}
              onStopEdit={() => setEditTarget(null)}
              onSaveEdit={async (id, values) => {
                try {
                  await updateMomoMutation.mutateAsync({
                    momoId: id,
                    values,
                  });
                  toast.success("Momos updated");
                  setEditTarget(null);
                } catch (error) {
                  log.error("Momo update failed", { userId, error });
                  toast.error(
                    error instanceof ApiError
                      ? error.message
                      : "Failed to save momos",
                  );
                  throw error;
                }
              }}
              onCancelOrder={async (id) => {
                const ok = await confirm({
                  title: "Cancel this momo order?",
                  description:
                    "You can place a new momo order later as long as the meal window is still open.",
                  confirmLabel: "Cancel momos",
                  cancelLabel: "Keep momos",
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await cancelMomoMutation.mutateAsync({ momoId: id });
                  toast.success("Momos cancelled");
                  setEditTarget(null);
                } catch (error) {
                  log.error("Momo cancel failed", { userId, error });
                  toast.error(
                    error instanceof ApiError
                      ? error.message
                      : "Failed to cancel momos",
                  );
                }
              }}
              isCancelling={cancelMomoMutation.isPending}
            />
          ) : null}

          {canPlaceMore ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {hasAnyPlaced ? "Place additional order" : "Place your order"}
                </CardTitle>
                <CardDescription>
                  Pick a drink, momos, or both. The food team will batch
                  pickups in time for the meal window.
                </CardDescription>
              </CardHeader>

              <BobaCombinedOrderForm
                key={`${activeWindow.id}-${placedCount}`}
                menu={menuQuery.data}
                isAdditional={hasAnyPlaced}
                onSubmit={async (values) => {
                  try {
                    await createMutation.mutateAsync(values);
                    toast.success("Order placed");
                  } catch (error) {
                    log.error("Boba order create failed", { userId, error });
                    const message =
                      error instanceof ApiError ? error.message : "Failed to save order";
                    toast.error(message);
                    throw error;
                  }
                }}
              />
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>You&apos;re at the limit</CardTitle>
                <CardDescription>
                  You&apos;ve placed {placedCount} of {maxOrders} drinks/momos
                  for this window. Cancel one above to free a slot, or use Edit
                  to change an existing one.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <BobaPaymentCard
            payment={myOrderQuery.data?.payment ?? null}
            mealWindowId={activeWindow.id}
            recipientName={menuQuery.data.payment.etransfer_recipient_name}
            etransferEmail={menuQuery.data.payment.etransfer_email}
            discountNote={menuQuery.data.payment.discount_note}
          />
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Drink list card
// ---------------------------------------------------------------------------

function PlacedDrinksCard({
  drinks,
  menu,
  editingId,
  onStartEdit,
  onStopEdit,
  onSaveEdit,
  onCancelOrder,
  isCancelling,
}: {
  drinks: BobaOrder[];
  menu: BobaMenuResponse;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onSaveEdit: (
    id: string,
    values: ReturnType<typeof drinkValuesFromOrder>,
  ) => Promise<void>;
  onCancelOrder: (id: string) => Promise<void>;
  isCancelling: boolean;
}) {
  const drinkLabel = (id: string) =>
    menu.drinks.find((d) => d.id === id)?.label ?? id;
  const sizeLabel = (id: string) =>
    menu.sizes.find((s) => s.id === id)?.label ?? id;
  const toppingLabel = (id: string) =>
    menu.toppings.find((t) => t.id === id)?.label ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your drinks</CardTitle>
        <CardDescription>
          Edit or cancel any drink while the window is open.
        </CardDescription>
      </CardHeader>

      <ul className="flex flex-col gap-3">
        {drinks.map((order) => {
          const isEditing = editingId === order.id;
          if (isEditing) {
            return (
              <li
                key={order.id}
                className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 py-4"
              >
                <p className="mb-3 text-sm font-semibold text-(--bearhacks-fg)">
                  Editing {drinkLabel(order.drink_id)}
                </p>
                <BobaDrinkEditForm
                  menu={menu}
                  initial={drinkValuesFromOrder(order)}
                  onSubmit={(values) => onSaveEdit(order.id, values)}
                  onCancelEdit={onStopEdit}
                  onCancelOrder={() => onCancelOrder(order.id)}
                  isCancelling={isCancelling}
                />
              </li>
            );
          }
          return (
            <li
              key={order.id}
              className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-(--bearhacks-fg)">
                  {drinkLabel(order.drink_id)} · {sizeLabel(order.size)}
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
                  variant="ghost"
                  onClick={() => onStartEdit(order.id)}
                >
                  Edit
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Momo list card
// ---------------------------------------------------------------------------

function PlacedMomosCard({
  momos,
  menu,
  editingId,
  onStartEdit,
  onStopEdit,
  onSaveEdit,
  onCancelOrder,
  isCancelling,
}: {
  momos: BobaMomoOrder[];
  menu: BobaMenuResponse;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onSaveEdit: (
    id: string,
    values: ReturnType<typeof momoValuesFromOrder>,
  ) => Promise<void>;
  onCancelOrder: (id: string) => Promise<void>;
  isCancelling: boolean;
}) {
  const fillingLabel = (id: string) =>
    menu.momos.fillings.find((f) => f.id === id)?.label ?? id;
  const sauceLabel = (id: string) =>
    menu.momos.sauces.find((s) => s.id === id)?.label ?? id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your momos</CardTitle>
        <CardDescription>
          {menu.momos.description}. Edit or cancel any momo order while the
          window is open.
        </CardDescription>
      </CardHeader>

      <ul className="flex flex-col gap-3">
        {momos.map((order) => {
          const isEditing = editingId === order.id;
          if (isEditing) {
            return (
              <li
                key={order.id}
                className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 py-4"
              >
                <p className="mb-3 text-sm font-semibold text-(--bearhacks-fg)">
                  Editing momos
                </p>
                <BobaMomoEditForm
                  menu={menu}
                  initial={momoValuesFromOrder(order)}
                  onSubmit={(values) => onSaveEdit(order.id, values)}
                  onCancelEdit={onStopEdit}
                  onCancelOrder={() => onCancelOrder(order.id)}
                  isCancelling={isCancelling}
                />
              </li>
            );
          }
          return (
            <li
              key={order.id}
              className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-(--bearhacks-fg)">
                  Momos · {fillingLabel(order.filling)}
                </p>
                <p className="text-xs text-(--bearhacks-muted)">
                  Sauce: {sauceLabel(order.sauce)}
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
                  variant="ghost"
                  onClick={() => onStartEdit(order.id)}
                >
                  Edit
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
    </Card>
  );
}
