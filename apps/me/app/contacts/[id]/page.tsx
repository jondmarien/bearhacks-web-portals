import Link from "next/link";

type Props = { params: Promise<{ id: string }> };

export default async function ContactPage({ params }: Props) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="text-xl font-semibold">Contact</h1>
      <p className="mt-2 text-sm text-[var(--bearhacks-muted)]">
        Stub for <code className="rounded bg-neutral-100 px-1">{id}</code> — TODO DEV-18–20.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-blue-600 underline">
        Home
      </Link>
    </main>
  );
}
