"use client";

import { useEffect, useState } from "react";
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
};

export function AllergenInfoModal({ triggerClassName = "" }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-fit min-h-(--bearhacks-touch-min) cursor-pointer items-center gap-2 rounded-(--bearhacks-radius-pill) border border-(--bearhacks-accent) bg-(--bearhacks-accent-soft) px-4 text-sm font-semibold text-(--bearhacks-primary) hover:bg-(--bearhacks-accent) ${triggerClassName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden="true">ⓘ</span>
        Allergens & vegan info
      </button>

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
              <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-(--bearhacks-radius-lg) border border-(--bearhacks-border) bg-(--bearhacks-surface) shadow-xl sm:max-h-[85vh] sm:rounded-(--bearhacks-radius-lg)">
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

                <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
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
