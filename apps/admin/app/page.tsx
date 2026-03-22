import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="text-sm text-[var(--bearhacks-muted)]">Staff portal — QR and ops (DEV-17, DEV-21, DEV-22).</p>
      <Link className="text-sm text-blue-600 underline" href="/qr">
        QR tools (stub)
      </Link>
    </main>
  );
}
