import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "pill";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "rounded-(--bearhacks-radius-md) px-4 bg-(--bearhacks-primary) text-(--bearhacks-on-primary) hover:bg-(--bearhacks-primary-hover) disabled:hover:bg-(--bearhacks-primary)",
  secondary:
    "rounded-(--bearhacks-radius-md) px-4 bg-(--bearhacks-accent) text-(--bearhacks-primary) hover:bg-(--bearhacks-accent-soft) disabled:hover:bg-(--bearhacks-accent)",
  ghost:
    "rounded-(--bearhacks-radius-md) px-4 bg-transparent text-(--bearhacks-primary) border border-(--bearhacks-border) hover:bg-(--bearhacks-surface-alt)",
  pill:
    "rounded-[var(--bearhacks-radius-pill)] px-6 py-3 bg-white text-black border border-black/50 shadow-[0_1px_4px_0_rgba(0,0,0,0.25)] hover:bg-(--bearhacks-cream) disabled:hover:bg-white",
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
