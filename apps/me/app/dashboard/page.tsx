import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

/** Legacy `/dashboard` URLs redirect to the portal home at `/`. */
export default async function DashboardLegacyRedirect({ searchParams }: PageProps) {
  const sp = await searchParams;
  const raw = sp.next;
  const next = Array.isArray(raw) ? raw[0] : raw;
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
    redirect(`/?next=${encodeURIComponent(next)}`);
  }
  redirect("/");
}
