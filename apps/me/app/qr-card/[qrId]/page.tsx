"use client";

import { createLogger } from "@bearhacks/logger";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useMeAuth } from "@/app/providers";
import { DashboardOAuthButtons } from "@/components/dashboard-oauth-buttons";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";

const log = createLogger("me/qr-card");

type ClaimStatus = {
  id: string;
  claimed: boolean;
  claimed_by?: string | null;
};

type Profile = {
  id: string;
  display_name?: string | null;
  role?: string | null;
};

export default function QrCardPage() {
  const params = useParams<{ qrId?: string }>();
  const auth = useMeAuth();
  const client = useApiClient();
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const qrId = typeof params?.qrId === "string" ? params.qrId : "";
  const viewerId = auth?.user?.id ?? null;
  useDocumentTitle("QR card");

  const claimUrl = useMemo(() => {
    if (!qrId || typeof window === "undefined") return null;
    return `${window.location.origin}/claim/${qrId}`;
  }, [qrId]);

  const claimStatusQuery = useQuery({
    queryKey: ["qr-card-claim-status", qrId],
    queryFn: () => client!.fetchJson<ClaimStatus>(`/claim/${qrId}`),
    enabled: Boolean(client && qrId),
  });

  const ownerId = claimStatusQuery.data?.claimed_by ?? null;
  const isClaimed = claimStatusQuery.data?.claimed === true;

  const profileQuery = useQuery({
    queryKey: ["qr-card-owner-profile", ownerId],
    queryFn: () => client!.fetchJson<Profile>(`/profiles/${ownerId}`),
    enabled: Boolean(client && ownerId),
  });

  useEffect(() => {
    let active = true;
    if (!claimUrl) {
      return () => {
        active = false;
      };
    }
    QRCode.toDataURL(claimUrl, {
      width: 768,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl: string) => {
        if (active) setQrImageUrl(dataUrl);
      })
      .catch((error: unknown) => {
        log.error("Failed to generate local QR image", { qrId, error });
        if (active) setQrImageUrl(null);
      });
    return () => {
      active = false;
    };
  }, [claimUrl, qrId]);

  if (!qrId || !claimUrl) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
        <PageHeader title="QR card" showBack backHref="/" />
        <Card>
          <CardDescription>Invalid QR id.</CardDescription>
        </Card>
      </main>
    );
  }

  const ownerName =
    profileQuery.data?.display_name ?? "BearHacks attendee";
  const ownerRole = profileQuery.data?.role ?? null;
  const isOwner = Boolean(viewerId && viewerId === ownerId);

  if (claimStatusQuery.isError) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
        <PageHeader title="QR card" showBack backHref="/" />
        <Card>
          <CardDescription>
            That QR code doesn&apos;t exist. Double-check the link and try again.
          </CardDescription>
        </Card>
      </main>
    );
  }

  if (!isClaimed) {
    return (
      <main className="flex flex-1 flex-col items-center bg-(--bearhacks-cream) px-4 py-8">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <PageHeader title="Unclaimed QR" showBack backHref="/" tone="marketing" />
          <Card
            className="flex flex-col items-center gap-4 bg-white text-center"
            style={{
              "--bearhacks-text-marketing": "#512b10",
              "--bearhacks-fg": "#1a1a1a",
              "--bearhacks-muted": "#525252",
              "--bearhacks-accent": "#f0a422",
              "--bearhacks-accent-soft": "#ffdc56",
              "--bearhacks-primary": "#1d3264",
              "--bearhacks-link": "#1d3264",
              "--bearhacks-link-hover": "#3766d4",
            } as React.CSSProperties}
          >
            <Image
              src="/brand/icon_color.svg"
              alt=""
              width={48}
              height={48}
              priority
              style={{ width: "48px", height: "auto" }}
            />
            <CardHeader className="items-center text-center">
              <CardTitle className="text-xl font-extrabold text-(--bearhacks-text-marketing)">
                This QR hasn&apos;t been claimed yet
              </CardTitle>
              <CardDescription className="text-(--bearhacks-text-marketing)/80">
                {auth?.user
                  ? "Claim it to link it to your attendee profile."
                  : "Sign in to claim this QR and link it to your profile."}
              </CardDescription>
            </CardHeader>

            {auth?.user ? (
              <Link
                href={`/claim/${qrId}`}
                className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) bg-(--bearhacks-accent) px-6 text-sm font-semibold text-(--bearhacks-primary) no-underline hover:bg-(--bearhacks-accent-soft)"
              >
                Claim this QR →
              </Link>
            ) : (
              <div className="w-full">
                <DashboardOAuthButtons />
              </div>
            )}
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center bg-(--bearhacks-cream) px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <PageHeader
          title={isOwner ? "My QR card" : "QR card"}
          showBack
          backHref={isOwner ? "/" : undefined}
          tone="marketing"
        />
        <Card
          className="flex flex-col items-center gap-4 bg-white text-center"
          style={{
            "--bearhacks-text-marketing": "#512b10",
            "--bearhacks-fg": "#1a1a1a",
            "--bearhacks-muted": "#525252",
            "--bearhacks-border": "#e5e5e5",
            "--bearhacks-border-strong": "#8a94a8",
            "--bearhacks-surface": "#ffffff",
            "--bearhacks-cream": "#fff4cf",
            "--bearhacks-link": "#1d3264",
            "--bearhacks-link-hover": "#3766d4",
            "--bearhacks-shadow-card":
              "0 1px 2px rgba(29,50,100,0.06), 0 8px 24px rgba(29,50,100,0.08)",
          } as React.CSSProperties}
        >
          <Image
            src="/brand/icon_color.svg"
            alt=""
            width={48}
            height={48}
            priority
            style={{ width: "48px", height: "auto" }}
          />
          <div>
            <CardTitle className="text-2xl font-extrabold text-(--bearhacks-text-marketing) sm:text-3xl">
              {ownerName}
            </CardTitle>
            {ownerRole ? (
              <CardDescription className="mt-1 uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                {ownerRole}
              </CardDescription>
            ) : null}
          </div>
          {qrImageUrl ? (
            <div
              className="relative w-full max-w-[320px]"
              style={{ aspectRatio: "1 / 1" }}
            >
              <Image
                src="/brand/wooden_frame.png"
                alt=""
                aria-hidden
                fill
                sizes="320px"
                className="pointer-events-none select-none object-contain"
                priority
              />
              <div className="absolute inset-[15%] flex items-center justify-center overflow-hidden rounded-md bg-white p-2">
                <Image
                  src={qrImageUrl}
                  alt="Networking QR code"
                  width={280}
                  height={280}
                  className="h-full w-full object-contain"
                  unoptimized
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-(--bearhacks-text-marketing)/70">
              Generating QR code…
            </p>
          )}
          <CardHeader className="mb-0 items-center text-center">
            <CardDescription className="text-(--bearhacks-text-marketing)/80">
              {isOwner
                ? "Show this QR to other attendees to share your profile."
                : "Scan this QR to view this attendee's profile."}
            </CardDescription>
          </CardHeader>
          {ownerId ? (
            <Link
              href={`/contacts/${ownerId}`}
              className="inline-flex min-h-(--bearhacks-touch-min) w-fit items-center rounded-(--bearhacks-radius-pill) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-6 py-3 text-sm font-semibold text-(--bearhacks-fg) no-underline shadow-(--bearhacks-shadow-card) hover:bg-(--bearhacks-cream)"
            >
              View profile →
            </Link>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
