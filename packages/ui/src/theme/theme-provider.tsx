"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

/**
 * Site-wide theme provider for both `apps/me` and `apps/admin`.
 *
 * - `attribute="class"` + Tailwind v4 `@custom-variant dark` in globals.
 * - `defaultTheme="system"` with OS preference detection + listener.
 * - `disableTransitionOnChange` prevents janky cross-fade when toggling.
 * - Shared `storageKey` so both portals agree on the user's choice when
 *   they share a domain.
 */
export function ThemeProvider({ children }: Props) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="bearhacks-theme"
    >
      {children}
    </NextThemeProvider>
  );
}
