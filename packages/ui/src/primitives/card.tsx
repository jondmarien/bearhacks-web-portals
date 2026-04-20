import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
};

export function Card({ as = "section", className = "", ...rest }: Props) {
  const Tag = as;
  return (
    <Tag
      className={`rounded-(--bearhacks-radius-lg) border border-(--bearhacks-border) bg-(--bearhacks-surface) p-5 shadow-(--bearhacks-shadow-card) ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`mb-3 flex flex-col gap-1 ${className}`} {...rest} />;
}

export function CardTitle({ className = "", ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={`text-lg font-semibold tracking-tight text-(--bearhacks-title) ${className}`}
      {...rest}
    />
  );
}

export function CardDescription({ className = "", ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`text-sm text-(--bearhacks-on-surface-muted) ${className}`} {...rest} />;
}
