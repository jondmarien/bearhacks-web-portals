"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useSubmitBobaPaymentMutation,
  type BobaMenuResponse,
  type BobaMomoOrder,
  type BobaOrder,
  type BobaPayment,
} from "@/lib/boba-queries";

const log = createLogger("me/boba-success-modal");

type Props = {
  open: boolean;
  /** Drink that was just placed by the create call (if any). */
  drink: BobaOrder | null;
  /** Momo order that was just placed by the create call (if any). */
  momo: BobaMomoOrder | null;
  /** Bundled payment for the active window after the create call. */
  payment: BobaPayment | null;
  menu: BobaMenuResponse;
  /** Active meal-window id used for the self-submit body. */
  mealWindowId: string | null;
  /**
   * Closes the modal. Caller is responsible for the post-close behaviour
   * for plain dismissal paths (x button, Escape, overlay click, Close button).
   */
  onClose: () => void;
  /** Closes the modal and jumps to the payment section. */
  onGoToPayment: () => void;
};

// Keeps SSR happy: `createPortal` must not run during the server render
// pass, so we gate on a client-only mount flag via `useSyncExternalStore`.
const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

/**
 * Post-order success dialog.
 *
 * Dismissable on overlay click, escape, or the explicit "Take me to the
 * payment section" button. Embeds the same e-transfer flow as
 * `BobaPaymentCard` so the hacker can fire-and-forget the payment from
 * inside the modal — the underlying card will reflect the same state once
 * dismissed (both read from the same `boba.myOrder` query cache).
 */
export function BobaSuccessModal({
  open,
  drink,
  momo,
  payment,
  menu,
  mealWindowId,
  onClose,
  onGoToPayment,
}: Props) {
  const submit = useSubmitBobaPaymentMutation();
  const [reference, setReference] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);
  const [submittedHere, setSubmittedHere] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // Per-open state (reference / submittedHere) is reset automatically by
  // remounting this component — the caller in /boba/page.tsx passes a
  // `key` prop tied to the current order's identity, so each new success
  // dialog gets fresh `useState` initial values. This keeps us compliant
  // with React 19's `react-hooks/set-state-in-effect` rule.

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const drinkSummary = useMemo(() => describeDrink(drink, menu), [drink, menu]);
  const momoSummary = useMemo(() => describeMomo(momo, menu), [momo, menu]);

  if (!open || !mounted) return null;

  const expectedDollars =
    payment != null ? (payment.expected_cents / 100).toFixed(2) : null;
  const isUnpaid = payment?.status === "unpaid";
  // ``submittedHere`` covers the optimistic moment between clicking "I
  // sent it" and the server's `submitted` status reaching the client; the
  // payment-status arm covers reopens after the cache caught up.
  const showSubmittedAck = submittedHere || payment?.status === "submitted";

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(menu.payment.etransfer_email);
      setEmailCopied(true);
      toast.success("E-transfer email copied");
      window.setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      toast.info(`Copy this email manually: ${menu.payment.etransfer_email}`);
    }
  };

  const onSubmitPayment = async () => {
    if (!mealWindowId) return;
    try {
      await submit.mutateAsync({
        meal_window_id: mealWindowId,
        reference: reference.trim() || undefined,
      });
      setSubmittedHere(true);
      toast.success("Marked as sent — admins will confirm shortly.");
    } catch (error) {
      log.error("Boba payment self-submit failed (modal)", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't mark payment as sent.",
      );
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="boba-success-title"
      className="fixed inset-0 z-100 flex items-end justify-center overflow-y-auto bg-(--bearhacks-overlay) p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="my-0 flex w-full max-w-lg flex-col gap-4 rounded-t-(--bearhacks-radius-lg) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface-raised) p-5 shadow-xl sm:my-4 sm:rounded-(--bearhacks-radius-lg)">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--bearhacks-success-fg)">
              Order placed
            </p>
            <h2
              id="boba-success-title"
              className="mt-1 text-xl font-semibold text-(--bearhacks-title)"
            >
              You&apos;re in. Now finish payment.
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-(--bearhacks-radius-md) p-2 text-(--bearhacks-muted) hover:bg-(--bearhacks-surface-alt) hover:text-(--bearhacks-fg)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {/* Order summary --------------------------------------------------- */}
        <section
          aria-label="Order summary"
          className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3"
        >
          <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
            Just placed
          </p>
          <ul className="flex flex-col gap-1 text-sm text-(--bearhacks-fg)">
            {drinkSummary ? (
              <li>
                <span className="font-semibold">Drink:</span> {drinkSummary}
              </li>
            ) : null}
            {momoSummary ? (
              <li>
                <span className="font-semibold">Momos:</span> {momoSummary}
              </li>
            ) : null}
          </ul>
        </section>

        {/* Payment block --------------------------------------------------- */}
        {payment != null && expectedDollars != null && mealWindowId ? (
          <section
            aria-label="Payment instructions"
            className="flex flex-col gap-3 rounded-(--bearhacks-radius-md) border-2 border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 py-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
                Total to send
              </p>
              <p className="text-2xl font-semibold text-(--bearhacks-fg)">
                ${expectedDollars}{" "}
                <span className="text-sm font-medium">CAD</span>
              </p>
            </div>
            <p className="text-xs text-(--bearhacks-muted)">
              {menu.payment.discount_note}. Bundle covers every drink + momo
              for this meal window.
            </p>

            <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-2">
              <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
                E-transfer to
              </p>
              <p className="text-sm font-semibold text-(--bearhacks-fg)">
                {menu.payment.etransfer_recipient_name}
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <code className="min-w-0 max-w-full break-all rounded-(--bearhacks-radius-md) bg-(--bearhacks-surface-alt) px-2 py-1 text-sm text-(--bearhacks-fg) select-all">
                  {menu.payment.etransfer_email}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => void copyEmail()}
                >
                  {emailCopied ? "Copied!" : "Copy email"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-(--bearhacks-muted)">
                Tip: include your name in the e-transfer message so we can
                match it quickly.
              </p>
            </div>

            {isUnpaid && !submittedHere ? (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="boba-success-reference"
                  className="text-sm font-medium text-(--bearhacks-title)"
                >
                  E-transfer reference (optional)
                </label>
                <input
                  id="boba-success-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={120}
                  placeholder='e.g. "Sam — Sat dinner"'
                  className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void onSubmitPayment()}
                  disabled={submit.isPending}
                >
                  {submit.isPending ? "Marking…" : "I sent the e-transfer"}
                </Button>
              </div>
            ) : null}

            {showSubmittedAck ? (
              <p className="rounded-(--bearhacks-radius-md) bg-(--bearhacks-surface) px-3 py-2 text-sm text-(--bearhacks-fg)">
                Thanks — marked as sent. The food team will confirm shortly.
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            Close
          </Button>
          <Button type="button" variant="primary" onClick={onGoToPayment}>
            Take me to payment ↓
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Summarizers — keep the modal copy identical to the placed-list cards so
// the hacker recognises what they just submitted at a glance.
// ---------------------------------------------------------------------------

function describeDrink(
  drink: BobaOrder | null,
  menu: BobaMenuResponse,
): string | null {
  if (!drink) return null;
  const name = menu.drinks.find((d) => d.id === drink.drink_id)?.label ?? drink.drink_id;
  const size = menu.sizes.find((s) => s.id === drink.size)?.label ?? drink.size;
  const toppings = drink.topping_ids
    .map((tid) => menu.toppings.find((t) => t.id === tid)?.label ?? tid)
    .join(", ");
  const toppingPart = toppings ? ` · ${toppings}` : " · no toppings";
  return `${name} · ${size} · ${drink.sweetness}% sweet · ${drink.ice} ice${toppingPart}`;
}

function describeMomo(
  momo: BobaMomoOrder | null,
  menu: BobaMenuResponse,
): string | null {
  if (!momo) return null;
  const filling =
    menu.momos.fillings.find((f) => f.id === momo.filling)?.label ??
    momo.filling;
  const sauce =
    menu.momos.sauces.find((s) => s.id === momo.sauce)?.label ?? momo.sauce;
  return `${filling} · sauce: ${sauce}`;
}
