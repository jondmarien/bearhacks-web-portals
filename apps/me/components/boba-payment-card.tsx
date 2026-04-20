"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useState } from "react";
import { toast } from "sonner";
import {
  useSubmitBobaPaymentMutation,
  useUndoBobaPaymentMutation,
  type BobaPayment,
} from "@/lib/boba-queries";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const log = createLogger("me/boba-payment");

type Props = {
  /** Payment bundle for the active window. ``null`` until first order placed. */
  payment: BobaPayment | null;
  /** Active meal-window id (used for the self-submit body). */
  mealWindowId: string | null;
  /** E-transfer recipient name (e.g. "Audrey"). */
  recipientName: string;
  /** E-transfer email address. */
  etransferEmail: string;
  /** Discount note shown under the total ("40% off Gong Cha menu, taxes included"). */
  discountNote: string;
};

/**
 * Per-window payment bundle UI.
 *
 * States:
 *   - no expected (nothing placed) -> hidden by parent
 *   - unpaid -> shows e-transfer instructions + "I sent it" CTA
 *   - submitted -> shows reference + "Undo I sent it" CTA + waiting copy
 *   - confirmed -> success state with received amount
 *   - refunded -> reversed state
 */
export function BobaPaymentCard({
  payment,
  mealWindowId,
  recipientName,
  etransferEmail,
  discountNote,
}: Props) {
  const submit = useSubmitBobaPaymentMutation();
  const undo = useUndoBobaPaymentMutation();
  const [reference, setReference] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);

  if (!payment || payment.expected_cents === 0 || !mealWindowId) {
    return null;
  }

  const expectedDollars = (payment.expected_cents / 100).toFixed(2);
  const receivedDollars =
    payment.received_cents != null
      ? (payment.received_cents / 100).toFixed(2)
      : null;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(etransferEmail);
      setEmailCopied(true);
      toast.success("E-transfer email copied");
      window.setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, permissions, …).
      // Surface a single, calm toast — the email is right there for manual
      // copy.
      toast.info(`Copy this email manually: ${etransferEmail}`);
    }
  };

  const onSubmit = async () => {
    try {
      await submit.mutateAsync({
        meal_window_id: mealWindowId,
        reference: reference.trim() || undefined,
      });
      toast.success("Marked as sent — admins will confirm shortly.");
      setReference("");
    } catch (error) {
      log.error("Boba payment self-submit failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't mark payment as sent.",
      );
    }
  };

  const onUndo = async () => {
    try {
      await undo.mutateAsync({ meal_window_id: mealWindowId });
      toast.success("Reverted — you can resend the e-transfer.");
    } catch (error) {
      log.error("Boba payment undo failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't undo the submission.",
      );
    }
  };

  return (
    <Card className={paymentToneClass(payment.status)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Payment</span>
          <PaymentStatusPill status={payment.status} />
        </CardTitle>
        <CardDescription>
          Bundle covers every drink + momo you placed for this meal window.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-3">
        <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3">
          <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
            Total to send
          </p>
          <p className="text-2xl font-semibold text-(--bearhacks-fg)">
            ${expectedDollars} <span className="text-sm font-medium">CAD</span>
          </p>
          <p className="mt-1 text-xs text-(--bearhacks-muted)">{discountNote}</p>
        </div>

        {payment.status === "unpaid" || payment.status === "submitted" ? (
          <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
              E-transfer to
            </p>
            <p className="text-sm font-semibold text-(--bearhacks-fg)">
              {recipientName}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <code className="min-w-0 max-w-full break-all rounded-(--bearhacks-radius-md) bg-(--bearhacks-surface-alt) px-2 py-1 text-sm text-(--bearhacks-fg) select-all">
                {etransferEmail}
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
              Tip: include your name in the e-transfer message so we can match
              it quickly.
            </p>
          </div>
        ) : null}

        {payment.status === "unpaid" ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="payment-reference"
              className="text-sm font-medium text-(--bearhacks-title)"
            >
              E-transfer reference (optional)
            </label>
            <input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              placeholder='e.g. "Sam — Sat dinner"'
              className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-3 py-2 text-base text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted)/70 focus:border-(--bearhacks-focus-ring) focus:outline-none"
            />
            <Button
              type="button"
              variant="primary"
              className="w-full sm:w-auto"
              onClick={() => void onSubmit()}
              disabled={submit.isPending}
            >
              {submit.isPending ? "Marking…" : "I sent the e-transfer"}
            </Button>
          </div>
        ) : null}

        {payment.status === "submitted" ? (
          <div className="flex flex-col gap-2">
            {payment.reference ? (
              <p className="text-sm text-(--bearhacks-fg)">
                Reference on file:{" "}
                <span className="font-medium">{payment.reference}</span>
              </p>
            ) : null}
            <p className="text-sm text-(--bearhacks-muted)">
              Waiting on the food team to confirm. Hang tight!
            </p>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => void onUndo()}
              disabled={undo.isPending}
            >
              {undo.isPending ? "Undoing…" : "Undo: I haven't sent it yet"}
            </Button>
          </div>
        ) : null}

        {payment.status === "confirmed" ? (
          <p className="text-sm text-(--bearhacks-fg)">
            Confirmed by the food team
            {receivedDollars != null ? ` — $${receivedDollars} received.` : "."}{" "}
            You&apos;re all set.
          </p>
        ) : null}

        {payment.status === "refunded" ? (
          <p className="text-sm text-(--bearhacks-fg)">
            This payment was refunded. Reach out in the hackers channel if this
            looks wrong.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function paymentToneClass(status: BobaPayment["status"]): string {
  switch (status) {
    case "confirmed":
      return "border-(--bearhacks-success-border) ring-1 ring-(--bearhacks-success-border)/60";
    case "submitted":
      return "border-(--bearhacks-warning-border) ring-1 ring-(--bearhacks-warning-border)/60";
    case "refunded":
      return "border-(--bearhacks-border) opacity-90";
    case "unpaid":
    default:
      return "border-(--bearhacks-accent) ring-2 ring-(--bearhacks-accent)/40";
  }
}

function PaymentStatusPill({ status }: { status: BobaPayment["status"] }) {
  const map: Record<BobaPayment["status"], { label: string; cls: string }> = {
    unpaid: {
      label: "Action needed",
      cls: "bg-(--bearhacks-accent) text-(--bearhacks-primary)",
    },
    submitted: {
      label: "Waiting confirmation",
      cls: "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)",
    },
    confirmed: {
      label: "Paid",
      cls: "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)",
    },
    refunded: {
      label: "Refunded",
      cls: "bg-(--bearhacks-surface-alt) text-(--bearhacks-muted) border border-(--bearhacks-border)",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${cls}`}
    >
      {label}
    </span>
  );
}
