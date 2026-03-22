import Link from "next/link";

export default function QrStubPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold">QR</h1>
      <p className="mt-2 text-sm text-(--bearhacks-muted)">
        TODO(DEV-17): Wire to FastAPI <code className="rounded bg-(--bearhacks-border)/30 px-1">/qr</code> when QR admin APIs
        land (assignee: Yves).
      </p>
      <Link href="/" className="mt-6 inline-flex min-h-(--bearhacks-touch-min) items-center text-sm underline">
        Admin home
      </Link>
    </main>
  );
}
