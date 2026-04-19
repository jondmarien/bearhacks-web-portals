"use client";

import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
} from "react";
import { useApiClient } from "@/lib/use-api-client";

/**
 * Hover-resolved profile-name tooltip rendered with the native HTML Popover
 * API + Interest Invokers when available.
 *
 * **Interest Invokers (`interestfor`)** is used in Chromium 142+
 * (shipped unflagged October 2025). The browser handles hover, focus, and
 * touch (long-press) interactions natively, applies the spec's recommended
 * 0.5s show / 0.2s hide delays, restores focus on dismiss, and dispatches
 * `interest` / `loseinterest` events on the target so we can lazy-fetch the
 * profile name on first hover/focus/long-press.
 * Refs:
 *   - https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using_interest_invokers
 *   - https://open-ui.org/components/interest-invokers.explainer/
 *
 * **Popover API fallback** is used everywhere else (Safari,
 * Firefox, older Chromium). We swap `popover="hint"` for `popover="auto"` so
 * the browser gives us free click-light-dismiss, and wire up `click` to
 * toggle plus `mouseenter`/`focus` to show. This keeps both desktop hover
 * and mobile tap-to-open working without JS managing the open state itself.
 * Refs:
 *   - https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using
 */

type ProfileLookup = {
  id: string;
  display_name?: string | null;
};

type Props = {
  profileId: string;
  /** Visible label for the trigger. Defaults to the (truncated) profileId. */
  triggerLabel?: string;
  /** Extra classes for the trigger `<button>`. */
  className?: string;
};

const HIDE_DELAY_MS = 120;

function getInterestSupportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof HTMLButtonElement === "undefined") return false;
  return "interestForElement" in HTMLButtonElement.prototype;
}

function subscribeNoop(): () => void {
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

export function ProfileNameTooltip({
  profileId,
  triggerLabel,
  className = "",
}: Props) {
  const client = useApiClient();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const reactId = useId();
  const tipId = `profile-tip-${reactId.replace(/:/g, "")}`;

  const supportsInterest = useSyncExternalStore(
    subscribeNoop,
    getInterestSupportSnapshot,
    getServerSnapshot,
  );

  const query = useQuery({
    queryKey: ["admin-profile-lookup", profileId],
    queryFn: () => client!.fetchJson<ProfileLookup>(`/profiles/${profileId}`),
    enabled: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const positionTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const rect = trigger.getBoundingClientRect();
    tip.style.position = "fixed";
    tip.style.margin = "0";
    tip.style.top = `${Math.round(rect.bottom + 6)}px`;
    tip.style.left = `${Math.round(rect.left)}px`;
  }, []);

  const fetchIfNeeded = useCallback(() => {
    if (client && !query.data && !query.isFetching && !query.isError) {
      void query.refetch();
    }
  }, [client, query]);

  // === Interest Invokers ===========================================
  // The browser opens/closes the popover; we just need to fetch + reposition
  // when the user shows interest.
  useEffect(() => {
    if (!supportsInterest) return;
    const tip = tooltipRef.current;
    if (!tip) return;
    const onInterest = () => {
      fetchIfNeeded();
      positionTooltip();
    };
    tip.addEventListener("interest", onInterest);
    return () => {
      tip.removeEventListener("interest", onInterest);
    };
  }, [supportsInterest, fetchIfNeeded, positionTooltip]);

  // === manual show/hide (fallback) =================================
  const fallbackShow = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    fetchIfNeeded();
    const tip = tooltipRef.current;
    if (!tip || typeof tip.showPopover !== "function") return;
    try {
      positionTooltip();
      tip.showPopover();
    } catch {
      // already open or unsupported
    }
  }, [fetchIfNeeded, positionTooltip]);

  const fallbackHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      const tip = tooltipRef.current;
      if (!tip || typeof tip.hidePopover !== "function") return;
      try {
        tip.hidePopover();
      } catch {
        /* not open */
      }
    }, HIDE_DELAY_MS);
  }, []);

  const fallbackToggle = useCallback(() => {
    const tip = tooltipRef.current;
    if (!tip || typeof tip.togglePopover !== "function") return;
    fetchIfNeeded();
    positionTooltip();
    try {
      tip.togglePopover();
    } catch {
      /* unsupported */
    }
  }, [fetchIfNeeded, positionTooltip]);

  const display = query.data?.display_name?.trim();
  const tooltipText = query.isFetching
    ? "Loading…"
    : query.isError
      ? "Lookup failed"
      : display || "Unnamed profile";

  // `interestfor` is a brand-new HTML global attribute and isn't in React's
  // HTMLButtonElement attribute types yet — cast through unknown to attach it
  // declaratively only when the browser supports the API.
  const triggerProps: ButtonHTMLAttributes<HTMLButtonElement> = supportsInterest
    ? ({ interestfor: tipId } as unknown as ButtonHTMLAttributes<HTMLButtonElement>)
    : {
        onClick: fallbackToggle,
        onMouseEnter: fallbackShow,
        onFocus: fallbackShow,
        onMouseLeave: fallbackHide,
        onBlur: fallbackHide,
      };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-describedby={tipId}
        className={`cursor-help bg-transparent p-0 text-left font-[inherit] text-[length:inherit] break-all text-(--bearhacks-muted) underline decoration-dotted underline-offset-2 hover:text-(--bearhacks-fg) ${className}`}
        {...triggerProps}
      >
        {triggerLabel ?? profileId}
      </button>
      <div
        ref={tooltipRef}
        id={tipId}
        // `hint` coexists with any open `auto` popovers (e.g. the QR details
        // modal); `auto` gives us free click-light-dismiss on touch when we
        // can't rely on the browser-managed Interest Invokers behavior.
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
        className="m-0 max-w-[18rem] rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-primary) px-3 py-2 text-xs text-(--bearhacks-on-primary) shadow-lg"
      >
        {tooltipText}
      </div>
    </>
  );
}
