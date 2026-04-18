import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-6 px-4 py-12 text-center">
      <Image
        src="/brand/icon_black.svg"
        alt=""
        width={56}
        height={56}
        priority
        style={{ width: "56px", height: "auto" }}
      />
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-(--bearhacks-primary)">
          This page no longer exists.
        </h1>
        <p className="mt-3 text-base text-(--bearhacks-muted)">
          Please click below to be redirected to home.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-md) bg-(--bearhacks-primary) px-5 text-sm font-semibold text-(--bearhacks-on-primary) no-underline hover:bg-(--bearhacks-primary-hover)"
      >
        Go home
      </Link>
    </main>
  );
}
