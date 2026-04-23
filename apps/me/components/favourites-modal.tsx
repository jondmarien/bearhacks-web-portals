"use client";

import { ApiError } from "@bearhacks/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * A favourite attendee entry as surfaced in the modal list.
 *
 * The portal page's full ``FavouriteProfile`` type has additional fields
 * (bio, linkedin_url, github_url) that the list never shows — we keep
 * the prop contract here to just what the UI consumes so the modal can
 * be dropped into other surfaces later without refactoring the caller.
 */
export type FavouriteSummary = {
  id: string;
  display_name?: string | null;
  role?: string | null;
};

type Props = {
  favourites: ReadonlyArray<FavouriteSummary> | undefined;
  isLoading: boolean;
  /** Error from the favourites query, if any. ``ApiError`` gets its message surfaced verbatim. */
  error: unknown;
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
};

/**
 * Favourited-contacts list rendered as a modal instead of an inline card.
 *
 * Moves the favourites block off the primary portal scroll column so the
 * Order / Payment / Profile flow stays above the fold on mobile, and
 * keeps discovery obvious by putting a badge-count pill right in the
 * "My profile" header (where hackers naturally go when looking for
 * their own social bits).
 *
 * Follows the same modal shape as ``AllergenInfoModal``:
 *   - ``createPortal`` to ``document.body`` so the dialog sits above
 *     any stacking-context descendants of the card that triggered it.
 *   - Bottom-sheet on mobile (``items-end`` + ``rounded-t-*``), centered
 *     on ``sm+`` (``items-center`` + full radius).
 *   - Escape closes; backdrop click closes; body scroll is locked while
 *     open so iOS Safari doesn't let the underlying page pan.
 */
export function FavouritesModal({
  favourites,
  isLoading,
  error,
  triggerClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);

  const count = favourites?.length ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);

    // Lock page scroll behind the modal. Using the previous value (not a
    // hardcoded "") preserves any ambient lock from an outer modal that
    // might have set this already.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          // Subtle outlined pill — quieter than AllergenInfoModal's solid
          // accent trigger so it doesn't compete with the form's "Save
          // profile" primary CTA directly below it.
          `inline-flex w-fit min-h-(--bearhacks-touch-min) cursor-pointer items-center gap-2 rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface) px-4 text-sm font-semibold text-(--bearhacks-fg) touch-manipulation [-webkit-tap-highlight-color:transparent] hover:bg-(--bearhacks-surface-alt) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--bearhacks-focus-ring) ${triggerClassName}`
        }
      >
        <span aria-hidden="true" className="text-(--bearhacks-accent)">
          ♥
        </span>
        <span>Favourites</span>
        {count > 0 ? (
          <span
            aria-label={`${count} saved`}
            className="inline-flex min-w-6 items-center justify-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent-soft) px-1.5 text-xs font-semibold text-(--bearhacks-text-marketing)"
          >
            {count}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="favourites-modal-title"
              className="fixed inset-0 z-100 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              {/*
                Mobile bottom-sheet: `max-h-[92dvh]` + dynamic viewport unit
                so iOS Safari's URL bar doesn't cause overflow. Desktop caps
                at 85dvh. `pb-[env(safe-area-inset-bottom)]` guards the
                iPhone home indicator.
              */}
              <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-(--bearhacks-radius-lg) border border-(--bearhacks-border) bg-(--bearhacks-surface) shadow-xl sm:max-h-[85dvh] sm:rounded-(--bearhacks-radius-lg)">
                <header className="flex items-start justify-between gap-4 border-b border-(--bearhacks-border) px-4 py-3 sm:px-5 sm:py-4">
                  <div>
                    <h2
                      id="favourites-modal-title"
                      className="text-lg font-semibold text-(--bearhacks-text-marketing)"
                    >
                      Favourited{" "}
                      <span className="bg-(--bearhacks-cream) px-1 rounded-sm">
                        contacts
                      </span>
                    </h2>
                    <p className="mt-1 text-xs text-(--bearhacks-muted)">
                      Profiles you&apos;ve hearted. Tap one to revisit it.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    aria-label="Close favourites"
                  >
                    Close
                  </Button>
                </header>

                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
                  <FavouritesBody
                    favourites={favourites}
                    isLoading={isLoading}
                    error={error}
                    onNavigate={() => setOpen(false)}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function FavouritesBody({
  favourites,
  isLoading,
  error,
  onNavigate,
}: {
  favourites: ReadonlyArray<FavouriteSummary> | undefined;
  isLoading: boolean;
  error: unknown;
  onNavigate: () => void;
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-(--bearhacks-muted)">Loading favourites…</p>
    );
  }

  if (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "Failed to load favourites";
    return <p className="text-sm text-(--bearhacks-danger)">{message}</p>;
  }

  if (!favourites || favourites.length === 0) {
    return (
      <p className="text-sm text-(--bearhacks-muted)">
        No favourites yet — scan or open a profile and tap the heart to save
        it here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {favourites.map((fav) => (
        <li key={fav.id}>
          <Link
            href={`/contacts/${fav.id}`}
            onClick={onNavigate}
            className="flex min-h-(--bearhacks-touch-min) items-center justify-between gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-4 py-3 no-underline hover:bg-(--bearhacks-surface-raised)"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-(--bearhacks-title)">
                {fav.display_name?.trim() || "Unnamed attendee"}
              </span>
              {fav.role?.trim() ? (
                <span className="truncate text-xs text-(--bearhacks-on-surface-muted)">
                  {fav.role}
                </span>
              ) : null}
            </div>
            <span aria-hidden="true" className="text-(--bearhacks-fg)">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
