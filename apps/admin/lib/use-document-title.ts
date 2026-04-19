"use client";

import { useEffect } from "react";

/**
 * Sets `document.title` for the current admin client page.
 *
 * Renders as ``"<title> · BearHacks Admin"`` because the root layout's
 * metadata title template (`%s · BearHacks Admin`) is applied client-side
 * via this effect by appending the suffix manually — Next.js only resolves
 * its template for server-side metadata, not for runtime `document.title`
 * updates from client components.
 *
 * Pass `null` / empty string to skip (useful when the title depends on
 * async data that has not loaded yet).
 */
const SUFFIX = " · BearHacks Admin";

export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!title || !title.trim()) return;
    const next = `${title.trim()}${SUFFIX}`;
    const previous = document.title;
    document.title = next;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
