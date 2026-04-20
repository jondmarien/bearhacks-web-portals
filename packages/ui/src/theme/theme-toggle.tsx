"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, type SVGProps } from "react";

type Mode = "light" | "system" | "dark";

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
];

type Props = {
  className?: string;
};

/**
 * Segmented Light / System / Dark switch.
 *
 * Pre-mount we render a fixed-size non-interactive placeholder so the
 * header does not reflow when next-themes resolves the user's choice.
 */
export function ThemeToggle({ className = "" }: Props) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active: Mode = ((): Mode => {
    if (!mounted) return "system";
    if (theme === "light" || theme === "dark") return theme;
    return "system";
  })();

  return (
    <div
      role="group"
      aria-label="Theme"
      className={`inline-flex items-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-on-primary)/30 bg-(--bearhacks-on-primary)/10 p-0.5 text-(--bearhacks-on-primary) ${className}`}
    >
      {MODES.map(({ id, label }) => {
        const isActive = mounted && active === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={`${label} theme`}
            aria-pressed={isActive}
            disabled={!mounted}
            onClick={() => setTheme(id)}
            className={[
              "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--bearhacks-focus-ring)",
              "disabled:cursor-not-allowed",
              isActive
                ? "bg-(--bearhacks-accent) text-(--bearhacks-primary)"
                : "text-(--bearhacks-on-primary) hover:bg-(--bearhacks-on-primary)/15",
            ].join(" ")}
          >
            <Icon mode={id} className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Icon({ mode, ...rest }: SVGProps<SVGSVGElement> & { mode: Mode }) {
  switch (mode) {
    case "light":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...rest}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      );
    case "dark":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...rest}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      );
    case "system":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...rest}
        >
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </svg>
      );
  }
}
