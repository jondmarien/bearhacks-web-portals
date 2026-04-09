"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useMutation, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMeAuth } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";

const log = createLogger("me/dashboard");

type MyProfile = {
  id: string;
  qr_id?: string | null;
  display_name?: string | null;
  bio?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  role?: string | null;
};

type ScannedRow = {
  scanned_at?: string | null;
  profiles?: {
    id?: string;
    display_name?: string | null;
    role?: string | null;
    linkedin_url?: string | null;
  } | null;
};

type FavouriteProfile = {
  id?: string;
  display_name?: string | null;
  role?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  bio?: string | null;
};

type ProfileDraft = {
  display_name: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
};

type GoogleWalletPassType = "generic" | "event";

type GoogleWalletSaveLinkResponse = {
  save_url: string;
  class_id: string;
  object_id: string;
};

type WalletCapabilities = {
  google: { configured: boolean };
  apple: { configured: boolean };
  fallback: { enabled: boolean };
};

function buildQrImageUrl(data: string, size = 512) {
  const params = new URLSearchParams({
    size: `${size}x${size}`,
    data,
    format: "png",
    margin: "24",
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

export default function DashboardPage() {
  const auth = useMeAuth();
  const router = useRouter();
  const client = useApiClient();
  const [scanId, setScanId] = useState("");
  const [favouriteId, setFavouriteId] = useState("");
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);

  const user = auth?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!auth?.isAuthReady || !user) return;
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) {
      router.replace(next);
    }
  }, [auth?.isAuthReady, user, router]);

  const profileQuery = useQuery({
    queryKey: ["me-profile", userId],
    queryFn: async () => {
      try {
        return await client!.fetchJson<MyProfile>(`/profiles/${userId}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // First-time Discord users might not have a `profiles` row yet; create one and retry read.
          await client!.fetchJson<MyProfile>("/profiles/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          return await client!.fetchJson<MyProfile>(`/profiles/${userId}`);
        }
        log.error("Failed to load profile", { userId, error });
        throw error;
      }
    },
    enabled: Boolean(client && userId),
  });

  const scannedQuery = useQuery({
    queryKey: ["me-scanned", userId],
    queryFn: () => client!.fetchJson<ScannedRow[]>("/social/scanned"),
    enabled: Boolean(client && userId),
  });

  const favouritesQuery = useQuery({
    queryKey: ["me-favourites", userId],
    queryFn: () => client!.fetchJson<FavouriteProfile[]>("/social/favourites"),
    enabled: Boolean(client && userId),
  });

  const walletCapabilitiesQuery = useQuery({
    queryKey: ["wallet-capabilities"],
    queryFn: () => client!.fetchJson<WalletCapabilities>("/wallet/capabilities"),
    enabled: Boolean(client),
  });

  const profileUpdatePayload = useMemo(() => {
    const current = profileQuery.data;
    if (!current) return null;
    const effectiveDraft: ProfileDraft = profileDraft ?? {
      display_name: current.display_name ?? "",
      bio: current.bio ?? "",
      linkedin_url: current.linkedin_url ?? "",
      github_url: current.github_url ?? "",
    };
    const body: Record<string, string> = {};
    if (effectiveDraft.display_name !== (current.display_name ?? "")) {
      body.display_name = effectiveDraft.display_name;
    }
    if (effectiveDraft.bio !== (current.bio ?? "")) body.bio = effectiveDraft.bio;
    if (effectiveDraft.linkedin_url !== (current.linkedin_url ?? "")) {
      body.linkedin_url = effectiveDraft.linkedin_url;
    }
    if (effectiveDraft.github_url !== (current.github_url ?? "")) {
      body.github_url = effectiveDraft.github_url;
    }
    return body;
  }, [profileQuery.data, profileDraft]);

  const saveProfileMutation = useMutation({
    mutationFn: () =>
      client!.fetchJson<MyProfile>("/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileUpdatePayload ?? {}),
      }),
    onSuccess: (data) => {
      void profileQuery.refetch();
      toast.success("Profile updated");
      setProfileDraft({
        display_name: data.display_name ?? "",
        bio: data.bio ?? "",
        linkedin_url: data.linkedin_url ?? "",
        github_url: data.github_url ?? "",
      });
    },
    onError: (error) => {
      log.error("Profile update failed", { userId, error });
      toast.error(error instanceof ApiError ? error.message : "Profile update failed");
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => client!.fetchJson<{ success: boolean }>(`/social/scan/${scanId}`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Contact auto-saved to scanned list");
      setScanId("");
      void scannedQuery.refetch();
    },
    onError: (error) => {
      log.warn("Scan save failed from dashboard", { scanId, error });
      toast.error(error instanceof ApiError ? error.message : "Scan save failed");
    },
  });

  const favouriteMutation = useMutation({
    mutationFn: () =>
      client!.fetchJson<{ favourited: boolean }>(`/social/favourite/${favouriteId}`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      toast.success(result.favourited ? "Favourite saved" : "Favourite removed");
      setFavouriteId("");
      void favouritesQuery.refetch();
    },
    onError: (error) => {
      log.warn("Favourite toggle failed from dashboard", { favouriteId, error });
      toast.error(error instanceof ApiError ? error.message : "Favourite update failed");
    },
  });

  const googleWalletMutation = useMutation({
    mutationFn: async (passType: GoogleWalletPassType) => {
      const params = new URLSearchParams({ type: passType });
      return client!.fetchJson<GoogleWalletSaveLinkResponse>(`/wallet/google/save-link?${params.toString()}`);
    },
    onSuccess: (result, passType) => {
      toast.success(
        passType === "generic"
          ? "Opening Google Wallet (Generic Pass)…"
          : "Opening Google Wallet (Event Ticket)…",
      );
      window.location.assign(result.save_url);
    },
    onError: (error, passType) => {
      log.error("Google Wallet save link generation failed", { passType, error });
      toast.error(error instanceof ApiError ? error.message : "Unable to create Google Wallet link");
    },
  });

  const appleWalletMutation = useMutation({
    mutationFn: async () => {
      const res = await client!.request("/wallet/apple/pass", { method: "GET" });
      if (!res.ok) {
        throw new ApiError(`HTTP ${res.status}`, res.status, await res.text());
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "bearhacks-attendee.pkpass";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    },
    onSuccess: () => {
      toast.success("Apple Wallet pass downloaded");
    },
    onError: (error) => {
      log.error("Apple Wallet pass download failed", { error });
      toast.error(error instanceof ApiError ? error.message : "Unable to download Apple Wallet pass");
    },
  });

  if (!auth?.isAuthReady) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Dashboard</h1>
        <p className="text-sm text-(--bearhacks-muted)">Checking session…</p>
      </main>
    );
  }

  if (!client) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Dashboard</h1>
        <p className="text-sm text-(--bearhacks-muted)">
          Missing public env config. Set `NEXT_PUBLIC_SUPABASE_*` and `NEXT_PUBLIC_API_URL`.
        </p>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Dashboard</h1>
        <p className="text-sm text-(--bearhacks-muted)">
          Sign in with Discord to load your profile, scanned contacts, and favourites.
        </p>
        <button
          type="button"
          onClick={() => {
            void auth
              .signInWithDiscord()
              .catch((error) => {
                log.error("Discord sign in failed", { error });
                if (error instanceof Error && error.message.toLowerCase().includes("provider is not enabled")) {
                  toast.error("Discord auth provider is disabled in Supabase for this project.");
                } else {
                  toast.error("Unable to start Discord login");
                }
              });
          }}
          className="min-h-(--bearhacks-touch-min) w-full cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) sm:w-auto"
        >
          Sign in with Discord
        </button>
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center text-sm underline">
          Home
        </Link>
      </main>
    );
  }

  const draft: ProfileDraft = profileDraft ?? {
    display_name: profileQuery.data?.display_name ?? "",
    bio: profileQuery.data?.bio ?? "",
    linkedin_url: profileQuery.data?.linkedin_url ?? "",
    github_url: profileQuery.data?.github_url ?? "",
  };
  const signedInLabel = user?.email ?? userId;
  const googleWalletConfigured = walletCapabilitiesQuery.data?.google.configured ?? false;
  const appleWalletConfigured = walletCapabilitiesQuery.data?.apple.configured ?? false;
  const showFallbackMode = walletCapabilitiesQuery.data
    ? walletCapabilitiesQuery.data.fallback.enabled
    : true;
  const qrId = profileQuery.data?.qr_id ?? null;
  const claimUrl =
    typeof window !== "undefined" && qrId ? `${window.location.origin}/claim/${qrId}` : null;
  const qrImageUrl = claimUrl ? buildQrImageUrl(claimUrl) : null;
  const qrCardHref = qrId ? `/qr-card/${qrId}` : null;
  const fallbackCardHref = qrCardHref ?? "/dashboard";

  const downloadFallbackPng = async () => {
    if (!qrImageUrl || !qrId) return;
    try {
      const res = await fetch(qrImageUrl);
      if (!res.ok) throw new Error(`QR image request failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `bearhacks-qr-${qrId}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("QR PNG downloaded");
    } catch (error) {
      log.error("QR PNG download failed", { qrId, error });
      toast.error("Unable to download QR PNG");
    }
  };

  const downloadFallbackPdf = () => {
    if (!qrCardHref) return;
    const printUrl = `${window.location.origin}${qrCardHref}?print=1`;
    window.open(printUrl, "_blank", "noopener,noreferrer");
    toast.success("Opened printable page. Choose 'Save as PDF' in print dialog.");
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">Dashboard</h1>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Signed in as <code className="rounded bg-(--bearhacks-border)/30 px-1">{signedInLabel}</code> via
          Discord.
        </p>
        <button
          type="button"
          onClick={() => {
            void auth.signOut().catch((error) => {
              log.error("Sign out failed", { error });
              toast.error("Unable to sign out");
            });
          }}
          className="mt-3 inline-flex min-h-(--bearhacks-touch-min) items-center underline"
        >
          Sign out
        </button>
      </header>

      <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <h2 className="text-base font-medium text-(--bearhacks-fg)">My profile</h2>
        {profileQuery.isLoading ? (
          <p className="mt-3 text-sm text-(--bearhacks-muted)">Loading profile…</p>
        ) : profileQuery.isError ? (
          <p className="mt-3 text-sm text-red-700">
            {profileQuery.error instanceof ApiError ? profileQuery.error.message : "Failed to load profile"}
          </p>
        ) : (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveProfileMutation.mutate();
            }}
          >
            <input
              value={draft.display_name}
              onChange={(event) =>
                setProfileDraft((prev) => ({
                  display_name: event.target.value,
                  bio: prev?.bio ?? draft.bio,
                  linkedin_url: prev?.linkedin_url ?? draft.linkedin_url,
                  github_url: prev?.github_url ?? draft.github_url,
                }))
              }
              className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
              placeholder="Display name"
            />
            <textarea
              value={draft.bio}
              onChange={(event) =>
                setProfileDraft((prev) => ({
                  display_name: prev?.display_name ?? draft.display_name,
                  bio: event.target.value,
                  linkedin_url: prev?.linkedin_url ?? draft.linkedin_url,
                  github_url: prev?.github_url ?? draft.github_url,
                }))
              }
              rows={4}
              className="rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 py-2 text-base"
              placeholder="Bio"
            />
            <input
              type="url"
              value={draft.linkedin_url}
              onChange={(event) =>
                setProfileDraft((prev) => ({
                  display_name: prev?.display_name ?? draft.display_name,
                  bio: prev?.bio ?? draft.bio,
                  linkedin_url: event.target.value,
                  github_url: prev?.github_url ?? draft.github_url,
                }))
              }
              className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
              placeholder="LinkedIn URL"
            />
            <input
              type="url"
              value={draft.github_url}
              onChange={(event) =>
                setProfileDraft((prev) => ({
                  display_name: prev?.display_name ?? draft.display_name,
                  bio: prev?.bio ?? draft.bio,
                  linkedin_url: prev?.linkedin_url ?? draft.linkedin_url,
                  github_url: event.target.value,
                }))
              }
              className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
              placeholder="GitHub URL"
            />
            <button
              type="submit"
              disabled={saveProfileMutation.isPending}
              className="min-h-(--bearhacks-touch-min) w-full cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saveProfileMutation.isPending ? "Saving…" : "Save profile"}
            </button>
          </form>
        )}
      </section>

      {(googleWalletConfigured || appleWalletConfigured) && (
        <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
          <h2 className="text-base font-medium text-(--bearhacks-fg)">Wallet passes</h2>
          <p className="mt-1 text-sm text-(--bearhacks-muted)">
            Add your attendee pass to Google Wallet or Apple Wallet after your QR has been claimed.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {googleWalletConfigured && (
              <>
                <button
                  type="button"
                  onClick={() => googleWalletMutation.mutate("generic")}
                  disabled={googleWalletMutation.isPending || appleWalletMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {googleWalletMutation.isPending ? "Preparing…" : "Add Generic Pass to Google Wallet"}
                </button>
                <button
                  type="button"
                  onClick={() => googleWalletMutation.mutate("event")}
                  disabled={googleWalletMutation.isPending || appleWalletMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {googleWalletMutation.isPending ? "Preparing…" : "Add Event Ticket to Google Wallet"}
                </button>
              </>
            )}
            {appleWalletConfigured && (
              <button
                type="button"
                onClick={() => appleWalletMutation.mutate()}
                disabled={appleWalletMutation.isPending || googleWalletMutation.isPending}
                className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {appleWalletMutation.isPending ? "Generating…" : "Add to Apple Wallet"}
              </button>
            )}
          </div>
        </section>
      )}

      {showFallbackMode && (
        <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <h2 className="text-base font-medium text-(--bearhacks-fg)">Wallet Export</h2>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Save your networking QR in portable formats.
        </p>
        {!qrId || !claimUrl || !qrImageUrl ? (
          <p className="mt-3 text-sm text-(--bearhacks-muted)">
            Claim your QR first to unlock Wallet Export options.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="w-full max-w-[220px] overflow-hidden rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border)">
              {/* QR image uses a lightweight public encoder endpoint for fallback mode only. */}
              <Image
                src={qrImageUrl}
                alt="Your networking QR code"
                width={220}
                height={220}
                className="h-auto w-full"
                unoptimized
              />
            </div>
            <p className="text-xs break-all text-(--bearhacks-muted)">
              QR target: <span className="font-medium">{claimUrl}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void downloadFallbackPng();
                }}
                className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium"
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={downloadFallbackPdf}
                className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium"
              >
                Download PDF
              </button>
              <Link
                href={fallbackCardHref}
                className="inline-flex min-h-(--bearhacks-touch-min) items-center rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium no-underline"
              >
                Open Add-to-Home-Screen page
              </Link>
            </div>
            <ul className="text-xs text-(--bearhacks-muted)">
              <li>Includes in-app QR display + PNG/PDF download + Add-to-Home-Screen QR page.</li>
              <li>Android fallback: upload the downloaded PNG/PDF in your pass app workflow to create a custom pass.</li>
              <li>Apple Wallet does not support photo/PDF custom pass import without proper PassKit issuance.</li>
            </ul>
          </div>
        )}
        </section>
      )}

      <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <h2 className="text-base font-medium text-(--bearhacks-fg)">Quick scan + favourite actions</h2>
        <p className="mt-1 text-sm text-(--bearhacks-muted)">
          Demo actions for persistence flows while QR scan hardware is out of browser scope.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!scanId.trim()) return;
              scanMutation.mutate();
            }}
          >
            <input
              value={scanId}
              onChange={(event) => setScanId(event.target.value)}
              className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
              placeholder="Profile id to auto-save scan"
            />
            <button
              type="submit"
              disabled={scanMutation.isPending}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanMutation.isPending ? "Saving…" : "Save scanned contact"}
            </button>
          </form>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!favouriteId.trim()) return;
              favouriteMutation.mutate();
            }}
          >
            <input
              value={favouriteId}
              onChange={(event) => setFavouriteId(event.target.value)}
              className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
              placeholder="Profile id to favourite"
            />
            <button
              type="submit"
              disabled={favouriteMutation.isPending}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {favouriteMutation.isPending ? "Updating…" : "Toggle favourite"}
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <h2 className="text-base font-medium text-(--bearhacks-fg)">Scanned contacts</h2>
        {scannedQuery.isLoading ? (
          <p className="mt-2 text-sm text-(--bearhacks-muted)">Loading scans…</p>
        ) : scannedQuery.data && scannedQuery.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {scannedQuery.data.map((row, index) => (
              <li
                key={`${row.profiles?.id ?? "unknown"}-${row.scanned_at ?? index}`}
                className="rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 py-2"
              >
                <div className="font-medium text-(--bearhacks-fg)">{row.profiles?.display_name ?? "Unknown attendee"}</div>
                <div className="text-(--bearhacks-muted)">
                  {row.scanned_at ? new Date(row.scanned_at).toLocaleString() : "Timestamp unavailable"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-(--bearhacks-muted)">No scanned contacts yet.</p>
        )}
      </section>

      <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <h2 className="text-base font-medium text-(--bearhacks-fg)">Favourites</h2>
        {favouritesQuery.isLoading ? (
          <p className="mt-2 text-sm text-(--bearhacks-muted)">Loading favourites…</p>
        ) : favouritesQuery.data && favouritesQuery.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {favouritesQuery.data.map((profile, index) => (
              <li
                key={`${profile.id ?? "unknown"}-${index}`}
                className="rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 py-2"
              >
                <div className="font-medium text-(--bearhacks-fg)">{profile.display_name ?? "Unknown attendee"}</div>
                <div className="text-(--bearhacks-muted)">{profile.role ?? "No role listed"}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-(--bearhacks-muted)">No favourites yet.</p>
        )}
      </section>

      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Home
        </Link>
      </nav>
    </main>
  );
}
