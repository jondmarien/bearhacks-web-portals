"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { BobaPaymentCard } from "@/components/boba-payment-card";
import { BobaStatusCard } from "@/components/boba-status-card";
import { Card } from "@/components/ui/card";
import type { BobaPayment } from "@/lib/boba-queries";

type Panel = "order" | "payment";

type Props = {
  isAuthReady: boolean;
  userId: string | null;
  payment: BobaPayment | null;
  mealWindowId: string | null;
  recipientName: string;
  etransferEmail: string;
  discountNote: string;
  /**
   * When true, flashes a transient accent ring on the whole card and
   * auto-switches to the Payment tab (if it is available). Used by the
   * ``/?payment=highlight`` deep-link handoff from ``/boba`` so the
   * hacker lands directly on the payment view after placing an order.
   */
  highlightPayment?: boolean;
};

/**
 * Combined Boba status + payment surface with a tabbed switcher.
 *
 * Replaces the previous two-card stack (``BobaStatusCard`` above
 * ``BobaPaymentCard``) so the portal home page reads as a single,
 * compact hub. Only one panel renders at a time.
 *
 * The Payment tab only appears when there is actually a bundle to pay
 * for (``expected_cents > 0`` and a live meal window). If it disappears
 * while active, we fall back to the Order tab so the surface never
 * shows an empty panel.
 */
export function BobaPortalCard({
  isAuthReady,
  userId,
  payment,
  mealWindowId,
  recipientName,
  etransferEmail,
  discountNote,
  highlightPayment = false,
}: Props) {
  const hasPaymentPanel = Boolean(
    payment && payment.expected_cents > 0 && mealWindowId,
  );

  const [panel, setPanel] = useState<Panel>(
    highlightPayment && hasPaymentPanel ? "payment" : "order",
  );

  // Deep-link auto-switch: when the parent sets ``highlightPayment`` true
  // (the ``/?payment=highlight`` flow) and the payment panel is ready,
  // jump to it. Running on every change of either input means a late-
  // arriving payment bundle still routes the hacker to the right tab.
  useEffect(() => {
    if (highlightPayment && hasPaymentPanel) setPanel("payment");
  }, [highlightPayment, hasPaymentPanel]);

  // Guard against the payment panel disappearing mid-session (e.g. every
  // order in the window was cancelled) — drop back to Order so the tab
  // bar never sits on an empty panel.
  useEffect(() => {
    if (panel === "payment" && !hasPaymentPanel) setPanel("order");
  }, [panel, hasPaymentPanel]);

  // Small "action needed" dot on the Payment tab. Triggers when the
  // hacker still owes money: the bundle is unpaid, or the bundle was
  // confirmed but drift has re-opened the balance.
  const receivedCents = payment?.received_cents ?? 0;
  const paymentNeedsAttention =
    payment != null &&
    (payment.status === "unpaid" ||
      (payment.status === "confirmed" &&
        receivedCents < payment.expected_cents));

  const ringClass = highlightPayment
    ? "ring-4 ring-(--bearhacks-accent)/70"
    : "";

  // Stable ids so tabs' ``aria-controls`` and panels' ``aria-labelledby``
  // reference each other. React's ``useId`` is SSR-safe.
  const baseId = useId();
  const orderTabId = `${baseId}-order-tab`;
  const orderPanelId = `${baseId}-order-panel`;
  const paymentTabId = `${baseId}-payment-tab`;
  const paymentPanelId = `${baseId}-payment-panel`;

  return (
    <Card className={`transition-shadow duration-500 ${ringClass}`}>
      {hasPaymentPanel ? (
        <TabList
          panel={panel}
          onChange={setPanel}
          paymentNeedsAttention={paymentNeedsAttention}
          orderTabId={orderTabId}
          orderPanelId={orderPanelId}
          paymentTabId={paymentTabId}
          paymentPanelId={paymentPanelId}
        />
      ) : null}

      {panel === "order" ? (
        <div
          id={orderPanelId}
          role="tabpanel"
          aria-labelledby={orderTabId}
        >
          <BobaStatusCard
            variant="section"
            isAuthReady={isAuthReady}
            userId={userId}
          />
        </div>
      ) : (
        <div
          id={paymentPanelId}
          role="tabpanel"
          aria-labelledby={paymentTabId}
        >
          <BobaPaymentCard
            variant="section"
            payment={payment}
            mealWindowId={mealWindowId}
            recipientName={recipientName}
            etransferEmail={etransferEmail}
            discountNote={discountNote}
          />
        </div>
      )}
    </Card>
  );
}

function TabList({
  panel,
  onChange,
  paymentNeedsAttention,
  orderTabId,
  orderPanelId,
  paymentTabId,
  paymentPanelId,
}: {
  panel: Panel;
  onChange: (next: Panel) => void;
  paymentNeedsAttention: boolean;
  orderTabId: string;
  orderPanelId: string;
  paymentTabId: string;
  paymentPanelId: string;
}) {
  const orderRef = useRef<HTMLButtonElement | null>(null);
  const paymentRef = useRef<HTMLButtonElement | null>(null);

  // ARIA tabs pattern: arrow keys move focus + selection between tabs.
  // With two tabs, ArrowLeft/ArrowRight/Home/End all flip to the other
  // tab. Auto-activation is safe here — swapping panels is cheap.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next: Panel = panel === "order" ? "payment" : "order";
    onChange(next);
    (next === "order" ? orderRef : paymentRef).current?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Boba portal sections"
      className="mb-4 flex gap-1 rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) p-1"
    >
      <TabButton
        id={orderTabId}
        panelId={orderPanelId}
        buttonRef={orderRef}
        selected={panel === "order"}
        onClick={() => onChange("order")}
        onKeyDown={onKeyDown}
      >
        Order
      </TabButton>
      <TabButton
        id={paymentTabId}
        panelId={paymentPanelId}
        buttonRef={paymentRef}
        selected={panel === "payment"}
        onClick={() => onChange("payment")}
        onKeyDown={onKeyDown}
        indicator={paymentNeedsAttention}
        indicatorLabel="Payment action needed"
      >
        Payment
      </TabButton>
    </div>
  );
}

function TabButton({
  id,
  panelId,
  buttonRef,
  selected,
  onClick,
  onKeyDown,
  indicator = false,
  indicatorLabel,
  children,
}: {
  id: string;
  panelId: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  selected: boolean;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  indicator?: boolean;
  indicatorLabel?: string;
  children: React.ReactNode;
}) {
  const base =
    "relative flex-1 inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-pill) px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--bearhacks-focus-ring)";
  const tone = selected
    ? "bg-(--bearhacks-accent) text-(--bearhacks-primary) shadow-sm"
    : "text-(--bearhacks-muted) hover:text-(--bearhacks-fg) hover:bg-(--bearhacks-surface)";
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`${base} ${tone}`}
    >
      {children}
      {indicator ? (
        <span
          className="ml-2 inline-block h-2 w-2 rounded-full bg-(--bearhacks-danger)"
          aria-label={indicatorLabel}
          role="status"
        />
      ) : null}
    </button>
  );
}
