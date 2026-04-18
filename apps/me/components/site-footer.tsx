export function SiteFooter() {
  return (
    <footer className="mt-auto w-full border-t border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-(--bearhacks-muted) sm:flex-row">
        <span>© 2026 BearHacks. All rights reserved.</span>
        <a
          href="https://bearhacks.com"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-(--bearhacks-primary) hover:text-(--bearhacks-primary-hover)"
        >
          bearhacks.com
        </a>
      </div>
    </footer>
  );
}
