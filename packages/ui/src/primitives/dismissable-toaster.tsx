"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Toaster, type ToasterProps } from "sonner";

/**
 * Sonner `<Toaster>` with two ergonomic dismissal affordances:
 *
 *  1. `closeButton` is enabled, so every toast renders an `x` in its corner.
 *  2. A delegated click listener lets the user dismiss a toast by clicking
 *     anywhere on its surface (excluding interactive children like links,
 *     buttons, inputs, and the action / cancel slots so we don't hijack
 *     intentional clicks). When such a click happens we forward it to the
 *     toast's built-in close button via `.click()` rather than reaching
 *     into Sonner's internal store.
 *
 * Theme syncing: consumers may pass an explicit `theme` prop, but by
 * default we read from `next-themes`' `resolvedTheme` so toasts match
 * the user's Light / Dark / System selection.
 */
export function DismissableToaster(
  props: Omit<ToasterProps, "closeButton" | "toastOptions">,
) {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    function handler(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const toast = target.closest<HTMLElement>("[data-sonner-toast]");
      if (!toast) return;
      if (
        target.closest(
          "a, button, [role='button'], input, textarea, select, [data-button], [data-cancel]",
        )
      ) {
        return;
      }
      const closeButton = toast.querySelector<HTMLButtonElement>("[data-close-button]");
      closeButton?.click();
    }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const toasterTheme: ToasterProps["theme"] =
    props.theme ?? (resolvedTheme === "dark" ? "dark" : "light");

  return (
    <Toaster
      closeButton
      toastOptions={{
        classNames: { toast: "cursor-pointer" },
      }}
      {...props}
      theme={toasterTheme}
    />
  );
}
