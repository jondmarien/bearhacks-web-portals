import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-(--bearhacks-cream) px-4 py-12 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Image
          src="/brand/bear_redirect.webp"
          alt=""
          width={240}
          height={240}
          priority
          className="w-44 sm:w-56"
          style={{ height: "auto" }}
        />
        <div>
          <h1 className="text-3xl font-extrabold uppercase tracking-[0.15rem] text-(--bearhacks-text-marketing) sm:text-4xl">
            This page no longer exists.
          </h1>
          <p className="mt-3 text-base text-(--bearhacks-text-marketing)/80">
            Please click below to be redirected to home.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-pill) border border-black/50 bg-white px-6 py-3 text-sm font-semibold text-black no-underline shadow-[0_1px_4px_0_rgba(0,0,0,0.25)] hover:bg-(--bearhacks-cream)"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
