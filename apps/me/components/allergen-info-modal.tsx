"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Hidden-by-default modal with curated allergen + vegan info pulled from the
 * Gong Cha "Vegan & Allergens" PDF (in the backend repo). Triggered from the
 * /boba ordering page so hackers can self-screen without us listing every
 * ingredient inline.
 *
 * Content is intentionally short — exhaustive ingredient lists belong in the
 * source PDF. We surface the rules that change ordering decisions: which
 * drinks/toppings are vegan, which contain dairy/egg/soy/nuts, and the
 * cross-contact warning.
 */

type DrinkRow = {
  label: string;
  vegan: "yes" | "with-substitution" | "no";
  notes: string;
};

type ToppingRow = {
  label: string;
  vegan: "yes" | "no";
  notes: string;
};

const DRINK_ROWS: DrinkRow[] = [
  {
    label: "Brown Sugar Milk Tea",
    vegan: "with-substitution",
    notes:
      "Contains dairy by default. Vegan-friendly when ordered with oat or almond milk.",
  },
  {
    label: "Classic Milk Tea",
    vegan: "with-substitution",
    notes:
      "Contains dairy by default. Vegan-friendly when ordered with oat or almond milk.",
  },
  {
    label: "Mango Green Tea",
    vegan: "yes",
    notes: "Vegan as ordered. Contains naturally derived flavour syrup.",
  },
  {
    label: "Peach Green Tea",
    vegan: "yes",
    notes: "Vegan as ordered. Contains naturally derived flavour syrup.",
  },
  {
    label: "Lychee Oolong Tea",
    vegan: "yes",
    notes: "Vegan as ordered. Contains naturally derived flavour syrup.",
  },
  {
    label: "Coffee Milk Tea",
    vegan: "with-substitution",
    notes:
      "Contains dairy and caffeine. Vegan-friendly when ordered with oat or almond milk.",
  },
];

const TOPPING_ROWS: ToppingRow[] = [
  { label: "Pearls (tapioca)", vegan: "yes", notes: "Vegan. Contains gluten-free starch." },
  { label: "Coconut Jelly", vegan: "yes", notes: "Vegan. Contains coconut." },
  { label: "QQ (pearls + coconut jelly)", vegan: "yes", notes: "Vegan. Contains coconut." },
  { label: "Mango Jelly", vegan: "yes", notes: "Vegan. Contains naturally derived mango flavour." },
  { label: "Grass Jelly", vegan: "yes", notes: "Vegan. Made from herbal extract." },
  { label: "White Peach Jelly", vegan: "yes", notes: "Vegan. Contains naturally derived peach flavour." },
  {
    label: "Oreo (Coffee Milk Tea only)",
    vegan: "no",
    notes:
      "Contains wheat (gluten), soy. May contain traces of milk per Mondelēz allergen statement.",
  },
];

const COMMON_ALLERGENS = [
  "Dairy (milk teas as ordered with regular milk)",
  "Wheat / gluten (Oreo topping)",
  "Soy (Oreo topping; some flavour syrups)",
  "Tree nuts (almond milk substitution; cross-contact possible)",
];

type Props = {
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
  /**
   * When true, render the trigger as a 32×32 ⓘ icon-only button instead of
   * the full "Allergens & vegan info" pill. Used when the trigger lives
   * inside the Boba & Momo status card's top-right corner, where the full
   * pill would collide with the card title on narrow screens.
   */
  compact?: boolean;
};

/**
 * Subscribe-free snapshot used by {@link useSyncExternalStore} so we can
 * safely read a DOM-capability flag during render without tripping hydration.
 * The capability never changes for the life of the page.
 */
function subscribeNoop(): () => void {
  return () => {};
}

function getInterestSupportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof HTMLButtonElement === "undefined") return false;
  return "interestForElement" in HTMLButtonElement.prototype;
}

function getServerSnapshot(): boolean {
  return false;
}

const HIDE_DELAY_MS = 120;

export function AllergenInfoModal({
  triggerClassName = "",
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);

  // Hover tooltip machinery — only meaningful for the `compact` ⓘ variant,
  // where the trigger has no visible text label. The non-compact pill
  // already reads "Allergens & vegan info", so we skip the popover there.
  //
  // Pattern mirrors apps/admin/components/profile-name-tooltip.tsx:
  //   - Chromium 142+ supports `interestfor=` (Interest Invokers), where the
  //     browser handles hover/focus/long-press with spec-recommended delays
  //     and restores focus on dismiss.
  //   - Everywhere else we fall back to `popover="auto"` + manual
  //     mouseenter/focus/mouseleave/blur handlers, which still gives us the
  //     top-layer rendering and click-light-dismiss from the Popover API.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const reactId = useId();
  const tipId = `allergen-tip-${reactId.replace(/:/g, "")}`;

  const supportsInterest = useSyncExternalStore(
    subscribeNoop,
    getInterestSupportSnapshot,
    getServerSnapshot,
  );

  // Position the tooltip below the trigger in viewport space. Popovers
  // render in the top layer with no default positioning, so we anchor
  // manually. Clamp horizontally so the 8px viewport gutter is preserved
  // even when the ⓘ sits in the top-right of the status card.
  const positionTip = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gutter = 8;
    const preferredLeft = triggerRect.right - tipRect.width;
    const maxLeft = window.innerWidth - tipRect.width - gutter;
    const left = Math.max(gutter, Math.min(preferredLeft, maxLeft));
    tip.style.position = "fixed";
    tip.style.margin = "0";
    tip.style.top = `${Math.round(triggerRect.bottom + 6)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }, []);

  // === Interest Invokers path =======================================
  // Browser opens/closes the hint popover on its own — we only need to
  // reposition on each `interest` event so the tooltip tracks the
  // trigger after scroll/resize-driven layout shifts.
  useEffect(() => {
    if (!compact || !supportsInterest) return;
    const tip = tipRef.current;
    if (!tip) return;
    const onInterest = () => positionTip();
    tip.addEventListener("interest", onInterest);
    return () => {
      tip.removeEventListener("interest", onInterest);
    };
  }, [compact, supportsInterest, positionTip]);

  const fallbackShow = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const tip = tipRef.current;
    if (!tip || typeof tip.showPopover !== "function") return;
    try {
      // Show first, then measure + reposition; `getBoundingClientRect()`
      // returns 0×0 for a display:none popover before `showPopover()`.
      tip.showPopover();
      positionTip();
    } catch {
      // already open or unsupported
    }
  }, [positionTip]);

  const fallbackHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      const tip = tipRef.current;
      if (!tip || typeof tip.hidePopover !== "function") return;
      try {
        tip.hidePopover();
      } catch {
        /* not open */
      }
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);

    // Lock page scroll behind the modal so iOS Safari doesn't let the user
    // pan the underlying `/boba` page while the sheet is open. Restore the
    // prior value on close — using `previousOverflow` (not hardcoded "")
    // keeps any ambient lock from an outer modal intact.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Hide the hover tooltip the moment the modal opens — otherwise the
  // browser may keep the hint visible behind the backdrop until the
  // pointer moves.
  useEffect(() => {
    if (!open) return;
    const tip = tipRef.current;
    if (!tip || typeof tip.hidePopover !== "function") return;
    try {
      tip.hidePopover();
    } catch {
      /* not open */
    }
  }, [open]);

  // Compact trigger keeps the full 44×44 touch target mandated by
  // `--bearhacks-touch-min` (WCAG 2.5.5 / iOS HIG) — shrinking to h-9 here
  // would break thumb-reach on phones. `touch-manipulation` disables the
  // 300ms click-delay Safari still ships on some pages, and
  // `-webkit-tap-highlight-color:transparent` suppresses the grey iOS flash
  // in favour of the styled hover/focus state.
  const triggerClasses = compact
    ? `inline-flex h-11 w-11 min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) cursor-pointer items-center justify-center rounded-full border border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) text-lg font-semibold leading-none text-(--bearhacks-primary) touch-manipulation [-webkit-tap-highlight-color:transparent] hover:bg-(--bearhacks-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--bearhacks-focus-ring) ${triggerClassName}`
    : `inline-flex w-fit min-h-(--bearhacks-touch-min) cursor-pointer items-center gap-2 rounded-(--bearhacks-radius-pill) border border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 text-sm font-semibold text-(--bearhacks-primary) touch-manipulation [-webkit-tap-highlight-color:transparent] hover:bg-(--bearhacks-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--bearhacks-focus-ring) ${triggerClassName}`;

  // `interestfor` is a brand-new HTML global attribute and isn't in React's
  // HTMLButtonElement attribute types yet — cast through unknown to attach
  // it declaratively only when the browser supports the API.
  const hoverProps: ButtonHTMLAttributes<HTMLButtonElement> =
    compact && supportsInterest
      ? ({ interestfor: tipId } as unknown as ButtonHTMLAttributes<HTMLButtonElement>)
      : compact
        ? {
            onMouseEnter: fallbackShow,
            onFocus: fallbackShow,
            onMouseLeave: fallbackHide,
            onBlur: fallbackHide,
          }
        : {};

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className={triggerClasses}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={compact ? "Allergens & vegan info" : undefined}
        aria-describedby={compact ? tipId : undefined}
        {...hoverProps}
      >
        <span aria-hidden="true">ⓘ</span>
        {compact ? null : "Allergens & vegan info"}
      </button>

      {compact ? (
        <div
          ref={tipRef}
          id={tipId}
          // `hint` coexists with any open `auto` popovers (the allergen
          // modal itself uses a custom portal + backdrop, not the Popover
          // API, so there's no stacking conflict). `auto` on the fallback
          // path gives free click-light-dismiss on touch.
          popover={supportsInterest ? "hint" : "auto"}
          role="tooltip"
          onMouseEnter={
            supportsInterest
              ? undefined
              : () => {
                  if (hideTimerRef.current !== null) {
                    window.clearTimeout(hideTimerRef.current);
                    hideTimerRef.current = null;
                  }
                }
          }
          onMouseLeave={supportsInterest ? undefined : fallbackHide}
          className="m-0 max-w-[16rem] rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-primary) px-3 py-2 text-xs font-medium text-(--bearhacks-on-primary) shadow-lg"
        >
          Allergens &amp; vegan info
        </div>
      ) : null}

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="allergen-modal-title"
              className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              {/*
                Mobile bottom-sheet: `max-h-[92dvh]` uses the dynamic viewport
                unit so the sheet shrinks correctly when iOS Safari's URL bar
                is visible (100vh famously overflows the visible area on iOS
                until the bar hides). Desktop stays capped at 85dvh.

                `pb-[env(safe-area-inset-bottom)]` pads the scroll region so
                content doesn't render under the iPhone home indicator.
              */}
              <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-(--bearhacks-radius-lg) border border-(--bearhacks-border) bg-(--bearhacks-surface) shadow-xl sm:max-h-[85dvh] sm:rounded-(--bearhacks-radius-lg)">
                <header className="flex items-start justify-between gap-4 border-b border-(--bearhacks-border) px-4 py-3 sm:px-5 sm:py-4">
                  <div>
                    <h2
                      id="allergen-modal-title"
                      className="text-lg font-semibold text-(--bearhacks-text-marketing)"
                    >
                      Allergens &amp; vegan info
                    </h2>
                    <p className="mt-1 text-xs text-(--bearhacks-muted)">
                      Curated from the Gong Cha vegan &amp; allergen sheet. If
                      you have severe allergies, please flag the food team in
                      person before pickup.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    aria-label="Close allergen info"
                  >
                    Close
                  </Button>
                </header>

                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
                  <Section title="Cross-contact warning">
                    <p className="text-sm text-(--bearhacks-fg)">
                      All drinks are prepared on shared equipment. Trace amounts
                      of dairy, soy, gluten, and tree nuts may be present even
                      if not listed below.
                    </p>
                  </Section>

                  <Section title="Common allergens to watch for">
                    <ul className="ml-5 list-disc text-sm text-(--bearhacks-fg)">
                      {COMMON_ALLERGENS.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </Section>

                  <Section title="Drinks">
                    <DrinkTable rows={DRINK_ROWS} />
                  </Section>

                  <Section title="Toppings">
                    <ToppingTable rows={TOPPING_ROWS} />
                  </Section>

                  <Section title="Momos">
                    <ul className="ml-5 list-disc text-sm text-(--bearhacks-fg)">
                      <li>
                        <strong>Chicken</strong> — contains wheat (gluten),
                        possible egg.
                      </li>
                      <li>
                        <strong>Vegetable (cabbage, carrot)</strong> — vegan.
                        Contains wheat (gluten).
                      </li>
                      <li>
                        <strong>Paneer (cottage cheese)</strong> — contains
                        dairy + wheat (gluten).
                      </li>
                      <li>
                        Sauces: <strong>garlic mayo</strong> contains egg;{" "}
                        <strong>tomato chutney</strong> + <strong>chilli paste</strong>{" "}
                        are vegan.
                      </li>
                    </ul>
                  </Section>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-(--bearhacks-title)">
        {title}
      </h3>
      {children}
    </section>
  );
}

function VeganBadge({ value }: { value: "yes" | "with-substitution" | "no" }) {
  const cls =
    value === "yes"
      ? "bg-(--bearhacks-success-bg) text-(--bearhacks-success-fg) border border-(--bearhacks-success-border)"
      : value === "with-substitution"
        ? "bg-(--bearhacks-warning-bg) text-(--bearhacks-warning-fg) border border-(--bearhacks-warning-border)"
        : "bg-(--bearhacks-danger-soft) text-(--bearhacks-danger) border border-(--bearhacks-danger-border)";
  const label =
    value === "yes" ? "Vegan" : value === "with-substitution" ? "Vegan w/ sub" : "Not vegan";
  // Fixed width + centered + nowrap so "Vegan", "Vegan w/ sub", and "Not vegan"
  // render as identically-sized pills across the Vegan column on both desktop
  // and mobile. The longest label "VEGAN W/ SUB" at text-[10px] uppercase
  // tracking-[0.06em] with px-2 needs ~6.5rem of room; 7rem gives breathing
  // space. The previous `w-25-0` was a typo (not a real Tailwind class), so
  // the utility was dropped silently and pills fell back to content width.
  return (
    <span
      className={`inline-flex w-28 items-center justify-center whitespace-nowrap rounded-(--bearhacks-radius-pill) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}
    >
      {label}
    </span>
  );
}

function DrinkTable({ rows }: { rows: DrinkRow[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-(--bearhacks-border) text-xs uppercase tracking-[0.06em] text-(--bearhacks-muted)">
              <th className="py-2 pr-2">Drink</th>
              <th className="py-2 pr-2 text-center">Vegan</th>
              <th className="py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-(--bearhacks-border)/60 last:border-b-0">
                <td className="py-2 pr-2 align-top font-medium text-(--bearhacks-fg)">
                  {row.label}
                </td>
                <td className="py-2 pr-2 text-center align-top">
                  <VeganBadge value={row.vegan} />
                </td>
                <td className="py-2 align-top text-(--bearhacks-fg)">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.label}
            className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-(--bearhacks-fg) wrap-break-word">
                {row.label}
              </span>
              <VeganBadge value={row.vegan} />
            </div>
            <p className="mt-1 text-xs text-(--bearhacks-fg) wrap-break-word">
              {row.notes}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function ToppingTable({ rows }: { rows: ToppingRow[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-(--bearhacks-border) text-xs uppercase tracking-[0.06em] text-(--bearhacks-muted)">
              <th className="py-2 pr-2">Topping</th>
              <th className="py-2 pr-2 text-center">Vegan</th>
              <th className="py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-(--bearhacks-border)/60 last:border-b-0">
                <td className="py-2 pr-2 align-top font-medium text-(--bearhacks-fg)">
                  {row.label}
                </td>
                <td className="py-2 pr-2 text-center align-top">
                  <VeganBadge value={row.vegan} />
                </td>
                <td className="py-2 align-top text-(--bearhacks-fg)">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.label}
            className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-(--bearhacks-fg) wrap-break-word">
                {row.label}
              </span>
              <VeganBadge value={row.vegan} />
            </div>
            <p className="mt-1 text-xs text-(--bearhacks-fg) wrap-break-word">
              {row.notes}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
