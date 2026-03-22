import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Admin</h1>
      <p className="text-sm text-(--bearhacks-muted)">Staff portal — QR (DEV-17), admin shell (DEV-21), profiles (DEV-22).</p>
      <ul className="flex flex-col gap-3 text-sm">
        <li>
          <Link className="inline-flex min-h-(--bearhacks-touch-min) items-center underline" href="/qr">
            QR tools (stub)
          </Link>
        </li>
        <li>
          <Link className="inline-flex min-h-(--bearhacks-touch-min) items-center underline" href="/profiles">
            Attendee profiles (super-admin)
          </Link>
        </li>
      </ul>
    </main>
  );
}
