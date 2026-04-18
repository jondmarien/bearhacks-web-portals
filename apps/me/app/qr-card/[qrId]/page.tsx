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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8">
      <PageHeader title="My QR card" showBack backHref="/" />
      <Card className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/brand/icon_black.svg"
          alt=""
          width={48}
          height={48}
          priority
          style={{ width: "48px", height: "auto" }}
        />
        <div>
          <CardTitle>{ownerName}</CardTitle>
          {ownerRole ? (
            <CardDescription className="mt-1">{ownerRole}</CardDescription>
          ) : null}
        </div>
        {qrImageUrl ? (
          <div className="w-full max-w-[280px] overflow-hidden rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-white p-3">
            <Image
              src={qrImageUrl}
              alt="Your networking QR code"
              width={280}
              height={280}
              className="h-auto w-full"
              unoptimized
            />
          </div>
        ) : (
          <p className="text-sm text-(--bearhacks-muted)">
            Generating your QR code…
          </p>
        )}
        <CardHeader className="mb-0 items-center text-center">
          <CardDescription>
            Show this QR to other attendees to share your profile.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
