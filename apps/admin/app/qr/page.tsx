import Link from "next/link";

export default function QrStubPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold">QR</h1>
      <p className="mt-2 text-sm text-[var(--bearhacks-muted)]">TODO: wire to FastAPI `/qr` (DEV-17).</p>
      <Link href="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Admin home
      </Link>
    </main>
  );
}
