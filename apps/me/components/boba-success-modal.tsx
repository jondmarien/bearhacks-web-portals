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
  /** Drink that was just placed by the create call (if any), carrying its own payment. */
  drink: BobaOrder | null;
  /** Momo order that was just placed by the create call (if any), carrying its own payment. */
  momo: BobaMomoOrder | null;
  menu: BobaMenuResponse;
  /**
   * Plain dismissal (x button, Escape, overlay click, "Close" footer
   * button). Caller should NOT scroll the payment section into view for
   * this path — users clicking "Close" don't expect a scroll side-effect.
   */
  onClose: () => void;
  /**
   * Explicit "Take me to payment ↓" action. Caller is expected to close
   * the modal and scroll/highlight the payment card on the underlying page.
   */
  onGoToPayment: () => void;
};

type SubmittableRow = {
  key: string;
  kind: "drink" | "momo";
  orderId: string;
  title: string;
  payment: BobaPayment;
};

// Keeps SSR happy: `createPortal` must not run during the server render
// pass, so we gate on a client-only mount flag via `useSyncExternalStore`.
const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

/**
 * Post-order success dialog.
 *
 * Per-order model: shows exactly what the hacker just placed (drink,
 * momo, or both) with each item's own price and per-row "I sent the
 * e-transfer" button. There's no cross-order total bleed-in from
 * earlier orders in the window — each placed order stands alone here,
 * which is the bug this modal used to have and the whole reason for
 * the per-order payments migration.
 */
export function BobaSuccessModal({
  open,
  drink,
  momo,
  menu,
  onClose,
  onGoToPayment,
}: Props) {
  const submit = useSubmitBobaPaymentMutation();
  const [referencesByKey, setReferencesByKey] = useState<Record<string, string>>(
    {},
  );
  const [submittedKeys, setSubmittedKeys] = useState<Record<string, boolean>>(
    {},
  );
  const [emailCopied, setEmailCopied] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

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

  const rows = useMemo<SubmittableRow[]>(() => {
    const out: SubmittableRow[] = [];
    if (drink && drink.payment) {
      out.push({
        key: `drink:${drink.id}`,
        kind: "drink",
        orderId: drink.id,
        title: describeDrink(drink, menu) ?? "Drink",
        payment: drink.payment,
      });
    }
    if (momo && momo.payment) {
      out.push({
        key: `momo:${momo.id}`,
        kind: "momo",
        orderId: momo.id,
        title: describeMomo(momo, menu) ?? "Momos",
        payment: momo.payment,
      });
    }
    return out;
  }, [drink, momo, menu]);

  if (!open || !mounted) return null;

  const totalExpected = rows.reduce(
    (sum, r) => sum + r.payment.expected_cents,
    0,
  );
  const totalReceived = rows.reduce(
    (sum, r) => sum + (r.payment.received_cents ?? 0),
    0,
  );
  const outstanding = Math.max(totalExpected - totalReceived, 0);
  const outstandingDollars = (outstanding / 100).toFixed(2);
  const totalExpectedDollars = (totalExpected / 100).toFixed(2);

  const allFullyPaid =
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.payment.status === "confirmed" &&
        (r.payment.received_cents ?? 0) >= r.payment.expected_cents,
    );

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

  const onSubmitRow = async (row: SubmittableRow) => {
    const reference = (referencesByKey[row.key] ?? "").trim();
    setPendingKey(row.key);
    try {
      await submit.mutateAsync({
        kind: row.kind,
        order_id: row.orderId,
        reference: reference || undefined,
      });
      setSubmittedKeys((prev) => ({ ...prev, [row.key]: true }));
      toast.success("Marked as sent — admins will confirm shortly.");
    } catch (error) {
      log.error("Boba payment self-submit failed (modal)", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't mark payment as sent.",
      );
    } finally {
      setPendingKey(null);
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
              {allFullyPaid
                ? "You're in. Payment already settled."
                : "You're in. Now finish payment."}
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

        {/* Payment block --------------------------------------------------- */}
        {rows.length > 0 && !allFullyPaid ? (
          <section
            aria-label="Payment instructions"
            className="flex flex-col gap-3 rounded-(--bearhacks-radius-md) border-2 border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 py-4 text-(--bearhacks-primary)"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--bearhacks-primary)/80">
                {rows.length === 1 ? "To send" : "Total to send"}
              </p>
              <p className="text-2xl font-semibold text-(--bearhacks-primary)">
                ${outstanding > 0 ? outstandingDollars : totalExpectedDollars}{" "}
                <span className="text-sm font-medium">CAD</span>
              </p>
            </div>
            <p className="text-xs text-(--bearhacks-primary)/80">
              {menu.payment.discount_note} One e-transfer per order.
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

            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <SuccessRow
                  key={row.key}
                  row={row}
                  reference={referencesByKey[row.key] ?? ""}
                  onReferenceChange={(value) =>
                    setReferencesByKey((prev) => ({
                      ...prev,
                      [row.key]: value,
                    }))
                  }
                  submittedHere={Boolean(submittedKeys[row.key])}
                  pending={pendingKey === row.key && submit.isPending}
                  onSubmit={() => void onSubmitRow(row)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {rows.length > 0 && allFullyPaid ? (
          <section
            aria-label="Payment status"
            className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-success-border) bg-(--bearhacks-success-bg) px-4 py-3"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--bearhacks-success-fg)">
              Already paid
            </p>
            <p className="text-sm text-(--bearhacks-success-fg)">
              This order is already confirmed — nothing more to send.
            </p>
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
          {!allFullyPaid ? (
            <Button type="button" variant="primary" onClick={onGoToPayment}>
              Take me to payment ↓
            </Button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function SuccessRow({
  row,
  reference,
  onReferenceChange,
  submittedHere,
  pending,
  onSubmit,
}: {
  row: SubmittableRow;
  reference: string;
  onReferenceChange: (value: string) => void;
  submittedHere: boolean;
  pending: boolean;
  onSubmit: () => void;
}) {
  const { payment } = row;
  const expected = (payment.expected_cents / 100).toFixed(2);
  const received = payment.received_cents ?? 0;
  const fullyPaid =
    payment.status === "confirmed" && received >= payment.expected_cents;
  const showSubmittedAck =
    !fullyPaid && (submittedHere || payment.status === "submitted");
  const canSubmit =
    !fullyPaid && !submittedHere && payment.status === "unpaid";
  const inputId = `boba-success-ref-${row.key}`;

  return (
    <li className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3 text-(--bearhacks-fg)">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{row.title}</p>
        <p className="text-sm font-semibold">${expected} CAD</p>
      </div>

      {canSubmit ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-xs font-medium">
            Reference (optional)
          </label>
          <input
            id={inputId}
            value={reference}
            onChange={(e) => onReferenceChange(e.target.value)}
            maxLength={120}
            placeholder='e.g. "Sam — Sat dinner"'
            className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 py-2 text-sm text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            onClick={onSubmit}
            disabled={pending}
          >
            {pending ? "Marking…" : "I sent the e-transfer"}
          </Button>
        </div>
      ) : null}

      {showSubmittedAck ? (
        <p className="rounded-(--bearhacks-radius-md) bg-(--bearhacks-surface-alt) px-3 py-2 text-xs">
          Thanks — marked as sent. The food team will confirm shortly.
        </p>
      ) : null}

      {fullyPaid ? (
        <p className="rounded-(--bearhacks-radius-md) bg-(--bearhacks-success-bg) px-3 py-2 text-xs text-(--bearhacks-success-fg)">
          Already paid.
        </p>
      ) : null}
    </li>
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
