import Image from "next/image";

export function SiteFooter() {
  return (
    <footer className="mt-auto w-full border-t border-(--bearhacks-border) bg-(--bearhacks-cream)">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-(--bearhacks-text-marketing) sm:flex-row">
        <div className="flex items-center gap-2">
          <Image
            src="/brand/bear_footer.webp"
            alt=""
            aria-hidden="true"
            width={56}
            height={56}
            className="w-10 sm:w-12"
            style={{ height: "auto" }}
          />
          <span className="font-semibold uppercase tracking-[0.1rem]">
            © 2026 BearHacks. All rights reserved.
          </span>
        </div>
        <a
          href="https://bearhacks.com"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-(--bearhacks-text-marketing) underline-offset-4 hover:underline"
        >
          bearhacks.com
        </a>
      </div>
    </footer>
  );
}
