import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "pill";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "rounded-(--bearhacks-radius-md) px-4 bg-(--bearhacks-primary) text-(--bearhacks-on-primary) hover:bg-(--bearhacks-primary-hover) disabled:hover:bg-(--bearhacks-primary)",
  secondary:
    "rounded-(--bearhacks-radius-md) px-4 bg-(--bearhacks-accent) text-(--bearhacks-primary) hover:bg-(--bearhacks-accent-soft) disabled:hover:bg-(--bearhacks-accent)",
  ghost:
    "rounded-(--bearhacks-radius-md) px-4 bg-transparent text-(--bearhacks-primary) border border-(--bearhacks-border-strong) hover:bg-(--bearhacks-surface-alt)",
  pill:
    "rounded-[var(--bearhacks-radius-pill)] px-6 py-3 bg-(--bearhacks-surface-raised) text-(--bearhacks-fg) border border-(--bearhacks-border-strong) shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream) disabled:hover:bg-(--bearhacks-surface-raised)",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex min-h-(--bearhacks-touch-min) cursor-pointer items-center justify-center text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
});
