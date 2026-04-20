import { ThemeToggle } from "@bearhacks/ui/theme";
import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-(--bearhacks-primary-hover)/30 bg-(--bearhacks-primary) text-(--bearhacks-on-primary)">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-(--bearhacks-on-primary) no-underline"
          aria-label="BearHacks 2026 admin home"
        >
          <Image
            src="/brand/icon_white.svg"
            alt=""
            width={28}
            height={28}
            priority
            style={{ width: "28px", height: "auto" }}
          />
          <span className="text-base font-semibold tracking-wide">
            BearHacks 2026
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-(--bearhacks-accent-soft)">
            Admin
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
