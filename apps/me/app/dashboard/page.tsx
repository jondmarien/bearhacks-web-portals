import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-[var(--bearhacks-muted)]">TODO: DEV-18–20 profiles / activity.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-blue-600 underline">
        Home
      </Link>
    </main>
  );
}
