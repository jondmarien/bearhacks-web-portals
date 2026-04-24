"use client";

import { ApiError } from "@bearhacks/api-client";
import { createLogger } from "@bearhacks/logger";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useMeAuth } from "@/app/providers";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";

const log = createLogger("me/qr-card");

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
  useDocumentTitle("My QR card");

  const claimUrl = useMemo(() => {
    if (!qrId || typeof window === "undefined") return null;
    return `${window.location.origin}/claim/${qrId}`;
  }, [qrId]);

  const profileQuery = useQuery({
    queryKey: ["qr-card-owner", viewerId],
    queryFn: () => client!.fetchJson<Profile>(`/profiles/${viewerId}`),
    enabled: Boolean(client && viewerId),
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
    profileQuery.data?.display_name ?? auth?.user?.email ?? "BearHacks attendee";
  const ownerRole = profileQuery.data?.role ?? null;
  const isOwnerError =
    profileQuery.isError &&
    !(profileQuery.error instanceof ApiError && profileQuery.error.status === 404);
  if (isOwnerError) {
    log.warn("Failed to load owner profile for QR card", {
      qrId,
      error: profileQuery.error,
    });
  }

  return (
    <main className="flex flex-1 flex-col items-center bg-(--bearhacks-cream) px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <PageHeader title="My QR card" showBack backHref="/" tone="marketing" />
        <Card className="flex flex-col items-center gap-4 bg-white text-center">
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
                  alt="Your networking QR code"
                  width={280}
                  height={280}
                  className="h-full w-full object-contain"
                  unoptimized
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-(--bearhacks-text-marketing)/70">
              Generating your QR code…
            </p>
          )}
          <CardHeader className="mb-0 items-center text-center">
            <CardDescription className="text-(--bearhacks-text-marketing)/80">
              Show this QR to other attendees to share your profile.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
