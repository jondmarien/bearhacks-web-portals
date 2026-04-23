"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useState } from "react";
import { toast } from "sonner";
import {
  useSubmitBobaPaymentMutation,
  useUndoBobaPaymentMutation,
  type BobaMenuResponse,
  type BobaMomoOrder,
  type BobaOrder,
  type BobaPayment,
} from "@/lib/boba-queries";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const log = createLogger("me/boba-payment");

type Props = {
  /** Drinks placed for the active window, each carrying its own payment. */
  drinks: readonly BobaOrder[];
  /** Momo orders placed for the active window, each carrying their own payment. */
  momos: readonly BobaMomoOrder[];
  /** Menu data used to render readable drink/momo labels per row. */
  menu: BobaMenuResponse | null;
  /** E-transfer recipient name (e.g. "Audrey"). */
  recipientName: string;
  /** E-transfer email address. */
  etransferEmail: string;
  /** Discount note shown under the total ("40% off Gong Cha menu, taxes included"). */
  discountNote: string;
  /**
   * Rendering mode:
   *   - ``"card"`` (default): wraps the contents in a ``<Card>`` surface
   *     with a status-driven border tone.
   *   - ``"section"``: renders the header + body inline, without the
   *     outer card shell or status-tone border. Used inside
   *     ``BobaPortalCard`` so the tabbed portal owns the single surface.
   */
  variant?: "card" | "section";
};

type PayableRow = {
  key: string;
  kind: "drink" | "momo";
  orderId: string;
  title: string;
  payment: BobaPayment;
};

/**
 * Per-order payment UI.
 *
 * Each placed drink + momo carries its own ``payment`` row in the
 * per-order model, so this card renders:
 *
 *   - A rollup header ("$X across N orders · Y unpaid · Z confirmed")
 *   - Shared e-transfer instructions while *any* row still needs money
 *   - A ``<ul>`` of per-order rows with their own status pill and CTA
 *
 * Drift (hacker edited the size after confirmation so ``expected_cents``
 * moves above ``received_cents``) is scoped to a single row — the
 * backend auto-flips that payment back to ``unpaid`` on the next
 * recompute, and the drift banner / CTA appears only on that row.
 */
export function BobaPaymentCard({
  drinks,
  momos,
  menu,
  recipientName,
  etransferEmail,
  discountNote,
  variant = "card",
}: Props) {
  const submit = useSubmitBobaPaymentMutation();
  const undo = useUndoBobaPaymentMutation();
  const [emailCopied, setEmailCopied] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const rows: PayableRow[] = [
    ...drinks
      .filter((d): d is BobaOrder & { payment: BobaPayment } => d.payment != null)
      .map((d) => ({
        key: `drink:${d.id}`,
        kind: "drink" as const,
        orderId: d.id,
        title: describeDrinkRow(d, menu),
        payment: d.payment,
      })),
    ...momos
      .filter(
        (m): m is BobaMomoOrder & { payment: BobaPayment } => m.payment != null,
      )
      .map((m) => ({
        key: `momo:${m.id}`,
        kind: "momo" as const,
        orderId: m.id,
        title: describeMomoRow(m, menu),
        payment: m.payment,
      })),
  ];

  if (rows.length === 0) return null;

  const totalExpected = rows.reduce(
    (sum, r) => sum + r.payment.expected_cents,
    0,
  );
  const totalReceived = rows.reduce(
    (sum, r) => sum + (r.payment.received_cents ?? 0),
    0,
  );
  const outstandingCents = Math.max(totalExpected - totalReceived, 0);
  const outstandingDollars = (outstandingCents / 100).toFixed(2);
  const totalExpectedDollars = (totalExpected / 100).toFixed(2);

  // Drift (confirmed but under-received) is a sub-state of ``confirmed``
  // — splitting it into its own bucket keeps the rollup buckets mutually
  // exclusive so they always sum to ``rows.length``. If we double-counted
  // drift rows into both ``confirmed`` and ``drift``, two drifted rows
  // would render as "2 confirmed · 2 with drift", misleading the hacker
  // into thinking two extra payments were fully settled.
  const counts = rows.reduce(
    (acc, r) => {
      if (isDrift(r.payment)) {
        acc.drift += 1;
      } else {
        acc[r.payment.status] += 1;
      }
      return acc;
    },
    { unpaid: 0, submitted: 0, confirmed: 0, refunded: 0, drift: 0 },
  );

  const anyPayable = rows.some(
    (r) =>
      r.payment.status === "unpaid" ||
      r.payment.status === "submitted" ||
      isDrift(r.payment),
  );

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(etransferEmail);
      setEmailCopied(true);
      toast.success("E-transfer email copied");
      window.setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      toast.info(`Copy this email manually: ${etransferEmail}`);
    }
  };

  const onSubmit = async (row: PayableRow) => {
    setPendingKey(row.key);
    try {
      await submit.mutateAsync({ kind: row.kind, order_id: row.orderId });
      toast.success("Marked as sent — admins will confirm shortly.");
    } catch (error) {
      log.error("Boba payment self-submit failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't mark payment as sent.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const onUndo = async (row: PayableRow) => {
    setPendingKey(row.key);
    try {
      await undo.mutateAsync({ kind: row.kind, order_id: row.orderId });
      toast.success("Reverted — you can resend the e-transfer.");
    } catch (error) {
      log.error("Boba payment undo failed", { error });
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't undo the submission.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  const rollupParts: string[] = [];
  if (counts.unpaid > 0) rollupParts.push(`${counts.unpaid} unpaid`);
  if (counts.submitted > 0) rollupParts.push(`${counts.submitted} submitted`);
  if (counts.confirmed > 0) rollupParts.push(`${counts.confirmed} confirmed`);
  if (counts.refunded > 0) rollupParts.push(`${counts.refunded} refunded`);
  if (counts.drift > 0) rollupParts.push(`${counts.drift} with drift`);

  const header = (
    <CardHeader>
      <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
        <span>Payment</span>
        <span className="text-sm font-medium text-(--bearhacks-muted)">
          ${totalExpectedDollars} across {rows.length} order
          {rows.length === 1 ? "" : "s"}
        </span>
      </CardTitle>
      <CardDescription>
        {rollupParts.length > 0 ? rollupParts.join(" · ") : "All set."}
      </CardDescription>
    </CardHeader>
  );

  const body = (
    <div className="flex flex-col gap-3">
      {anyPayable ? (
        <>
          <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3">
            <p className="text-xs uppercase tracking-[0.08em] text-(--bearhacks-muted)">
              Still to send
            </p>
            <p className="text-2xl font-semibold text-(--bearhacks-fg)">
              ${outstandingDollars}{" "}
              <span className="text-sm font-medium">CAD</span>
            </p>
            <p className="mt-1 text-xs text-(--bearhacks-muted)">
              {discountNote} One e-transfer per order — mark each one sent below.
            </p>
          </div>

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
        </>
      ) : null}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <PaymentRow
            key={row.key}
            row={row}
            pending={pendingKey === row.key && (submit.isPending || undo.isPending)}
            onSubmit={() => void onSubmit(row)}
            onUndo={() => void onUndo(row)}
          />
        ))}
      </ul>
    </div>
  );

  if (variant === "section") {
    return (
      <div className="flex flex-col">
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card className={cardToneClass(rows)}>
      {header}
      {body}
    </Card>
  );
}

/**
 * True when a payment is ``confirmed`` but the underlying order has
 * since grown (``expected_cents > received_cents``). The backend
 * normally flips the row back to ``unpaid`` on the next recompute, but
 * stale cache reads can still surface this transition — we treat it as
 * drift so the UI asks for the diff instead of lying about being paid.
 */
function isDrift(payment: BobaPayment): boolean {
  const received = payment.received_cents ?? 0;
  return payment.status === "confirmed" && payment.expected_cents > received;
}

function cardToneClass(rows: PayableRow[]): string {
  const anyDrift = rows.some((r) => isDrift(r.payment));
  const anyUnpaid = rows.some((r) => r.payment.status === "unpaid");
  const anySubmitted = rows.some((r) => r.payment.status === "submitted");
  const allConfirmed = rows.every((r) => r.payment.status === "confirmed");
  if (anyDrift || anyUnpaid) {
    return "border-(--bearhacks-accent) ring-2 ring-(--bearhacks-accent)/40";
  }
  if (anySubmitted) {
    return "border-(--bearhacks-warning-border) ring-1 ring-(--bearhacks-warning-border)/60";
  }
  if (allConfirmed) {
    return "border-(--bearhacks-success-border) ring-1 ring-(--bearhacks-success-border)/60";
  }
  return "border-(--bearhacks-border) opacity-90";
}

function PaymentRow({
  row,
  pending,
  onSubmit,
  onUndo,
}: {
  row: PayableRow;
  pending: boolean;
  onSubmit: () => void;
  onUndo: () => void;
}) {
  const { payment } = row;
  const expected = (payment.expected_cents / 100).toFixed(2);
  const received = payment.received_cents ?? 0;
  const drift = isDrift(payment);
  const outstanding = Math.max(payment.expected_cents - received, 0);
  const outstandingDollars = (outstanding / 100).toFixed(2);
  const receivedDollars = (received / 100).toFixed(2);

  return (
    <li className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-(--bearhacks-fg)">
            {row.title}
          </p>
          <p className="text-xs text-(--bearhacks-muted)">${expected} CAD</p>
        </div>
        <PaymentStatusPill payment={payment} drift={drift} />
      </div>

      {payment.status === "unpaid" ? (
        <Button
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={onSubmit}
        >
          {pending ? "Marking…" : "I sent the e-transfer"}
        </Button>
      ) : null}

      {payment.status === "submitted" ? (
        <div className="flex flex-col gap-1">
          {payment.reference ? (
            <p className="text-xs text-(--bearhacks-fg)">
              Reference:{" "}
              <span className="font-medium">{payment.reference}</span>
            </p>
          ) : null}
          <p className="text-xs text-(--bearhacks-muted)">
            Waiting on the food team to confirm.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={onUndo}
          >
            {pending ? "Undoing…" : "Undo"}
          </Button>
        </div>
      ) : null}

      {payment.status === "confirmed" && !drift ? (
        <p className="text-xs text-(--bearhacks-fg)">
          Confirmed{received > 0 ? ` — $${receivedDollars} received.` : "."}
        </p>
      ) : null}

      {drift ? (
        <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-warning-border) bg-(--bearhacks-warning-bg) px-3 py-2 text-xs text-(--bearhacks-warning-fg)">
          You edited this order after confirmation. New total ${expected},
          received ${receivedDollars}. Send the ${outstandingDollars}{" "}
          difference and ping the food team to reconcile.
        </div>
      ) : null}

      {payment.status === "refunded" ? (
        <p className="text-xs text-(--bearhacks-fg)">
          Refunded. If this looks wrong, open a ticket in #support-tickets on
          Discord.
        </p>
      ) : null}
    </li>
  );
}

function PaymentStatusPill({
  payment,
  drift,
}: {
  payment: BobaPayment;
  drift: boolean;
}) {
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
  const resolved = drift
    ? {
        label: "Additional due",
        cls: "bg-(--bearhacks-accent) text-(--bearhacks-primary)",
      }
    : map[payment.status];
  return (
    <span
      className={`inline-flex items-center rounded-(--bearhacks-radius-pill) px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${resolved.cls}`}
    >
      {resolved.label}
    </span>
  );
}

function describeDrinkRow(
  drink: BobaOrder,
  menu: BobaMenuResponse | null,
): string {
  if (!menu) return `Drink · ${drink.size}`;
  const name =
    menu.drinks.find((d) => d.id === drink.drink_id)?.label ?? drink.drink_id;
  const size = menu.sizes.find((s) => s.id === drink.size)?.label ?? drink.size;
  return `${name} · ${size}`;
}

function describeMomoRow(
  momo: BobaMomoOrder,
  menu: BobaMenuResponse | null,
): string {
  if (!menu) return `Momos · ${momo.filling}`;
  const filling =
    menu.momos.fillings.find((f) => f.id === momo.filling)?.label ??
    momo.filling;
  return `Momos · ${filling}`;
}
