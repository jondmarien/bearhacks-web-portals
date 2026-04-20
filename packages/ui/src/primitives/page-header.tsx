"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

type Tone = "default" | "marketing";

type Props = {
  title: string;
  subtitle?: ReactNode;
  backHref?: string;
  showBack?: boolean;
  actions?: ReactNode;
  tone?: Tone;
};

export function PageHeader({
  title,
  subtitle,
  backHref,
  showBack = false,
  actions,
  tone = "default",
}: Props) {
  const titleClass =
    tone === "marketing"
      ? "text-2xl font-extrabold uppercase tracking-[0.15rem] text-(--bearhacks-text-marketing) sm:text-3xl"
      : "text-3xl font-bold tracking-tight text-(--bearhacks-title)";
  const subtitleClass =
    tone === "marketing"
      ? "mt-1 text-sm text-(--bearhacks-text-marketing)/70"
      : "mt-1 text-sm text-(--bearhacks-muted)";
  const router = useRouter();
  return (
    <header className="flex flex-col gap-3">
      {showBack ? (
        backHref ? (
          <Link
            href={backHref}
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-(--bearhacks-link) hover:text-(--bearhacks-link-hover)"
          >
            <span aria-hidden>←</span> Back
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/");
              }
            }}
            className="inline-flex w-fit cursor-pointer items-center gap-1 text-sm font-medium text-(--bearhacks-link) hover:text-(--bearhacks-link-hover)"
          >
            <span aria-hidden>←</span> Back
          </button>
        )
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={titleClass}>{title}</h1>
          {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
