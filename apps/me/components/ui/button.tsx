import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-(--bearhacks-primary) text-(--bearhacks-on-primary) hover:bg-(--bearhacks-primary-hover) disabled:hover:bg-(--bearhacks-primary)",
  secondary:
    "bg-(--bearhacks-accent) text-(--bearhacks-primary) hover:bg-(--bearhacks-accent-soft) disabled:hover:bg-(--bearhacks-accent)",
  ghost:
    "bg-transparent text-(--bearhacks-primary) border border-(--bearhacks-border) hover:bg-(--bearhacks-surface-alt)",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex min-h-(--bearhacks-touch-min) cursor-pointer items-center justify-center rounded-(--bearhacks-radius-md) px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
});
