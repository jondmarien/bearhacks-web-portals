"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  BobaMenuResponse,
  BobaMomoOrder,
  BobaOrder,
  BobaPayment,
} from "@/lib/boba-queries";

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
   * This is the intended happy-path exit from the modal: users actually
   * confirm they sent the e-transfer on the dashboard payment card, not
   * inside this modal.
   */
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
 * Intentionally slim: shows *where* to send the e-transfer and *how much*
 * for what was just placed, then hands off to the dashboard payment card
 * via `onGoToPayment`. The hacker confirms "I sent the e-transfer" on the
 * dashboard, not here — this modal is purely the "order received, now
 * pay" acknowledgement.
 */
export function BobaSuccessModal({
  open,
  drink,
  momo,
  menu,
  onClose,
  onGoToPayment,
}: Props) {
  const [emailCopied, setEmailCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const goToPaymentRef = useRef<HTMLButtonElement | null>(null);

  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  useEffect(() => {
    if (!open) return;
    // Focus the primary CTA so keyboard users land on the intended next
    // step rather than on Close.
    goToPaymentRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const payments: BobaPayment[] = [];
  if (drink?.payment) payments.push(drink.payment);
  if (momo?.payment) payments.push(momo.payment);

  const totalExpected = payments.reduce((sum, p) => sum + p.expected_cents, 0);
  const totalReceived = payments.reduce(
    (sum, p) => sum + (p.received_cents ?? 0),
    0,
  );
  const outstanding = Math.max(totalExpected - totalReceived, 0);
  const outstandingDollars = (outstanding / 100).toFixed(2);
  const totalExpectedDollars = (totalExpected / 100).toFixed(2);

  const allFullyPaid =
    payments.length > 0 &&
    payments.every(
      (p) =>
        p.status === "confirmed" &&
        (p.received_cents ?? 0) >= p.expected_cents,
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

  const showPaymentBlock = payments.length > 0 && !allFullyPaid;

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

        {showPaymentBlock ? (
          <section
            aria-label="Payment instructions"
            // Accent *border* marks this as the payment action block, but
            // the fill stays on theme-aware surface tokens so the block
            // doesn't turn into a blinding pale-yellow slab in dark mode
            // (the `--bearhacks-accent-soft` token is #ffe196 regardless
            // of theme — fine next to light surfaces, wrong on dark).
            // This mirrors the dashboard `BobaPaymentCard` summary block.
            className="flex flex-col gap-4 rounded-(--bearhacks-radius-md) border-2 border-(--bearhacks-accent) bg-(--bearhacks-surface-alt) px-4 py-4 text-(--bearhacks-fg)"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-(--bearhacks-muted)">
                {payments.length === 1 ? "To send" : "Total to send"}
              </p>
              <p className="text-2xl font-semibold text-(--bearhacks-fg)">
                ${outstanding > 0 ? outstandingDollars : totalExpectedDollars}{" "}
                <span className="text-sm font-medium">CAD</span>
              </p>
            </div>
            <p className="text-xs text-(--bearhacks-muted)">
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

            {/*
             * Primary CTA. Lives inside the payment block (not in the
             * footer) so it reads as "this is the next step" — the hacker
             * goes to the dashboard payment card to actually mark the
             * e-transfer as sent.
             */}
            <div className="flex flex-col gap-1">
              <Button
                ref={goToPaymentRef}
                type="button"
                variant="primary"
                onClick={onGoToPayment}
                className="w-full"
              >
                Take me to payment ↓
              </Button>
              <p className="text-center text-xs text-(--bearhacks-muted)">
                Confirm you sent the e-transfer on your dashboard.
              </p>
            </div>
          </section>
        ) : null}

        {payments.length > 0 && allFullyPaid ? (
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

        <footer className="flex justify-end">
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            Close
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
