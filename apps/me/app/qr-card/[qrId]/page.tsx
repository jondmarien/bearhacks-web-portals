"use client";

import { createLogger } from "@bearhacks/logger";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

const log = createLogger("me/qr-card");

export default function QrCardPage() {
  const params = useParams<{ qrId?: string }>();
  const searchParams = useSearchParams();
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const qrId = typeof params?.qrId === "string" ? params.qrId : "";
  const printMode = searchParams.get("print") === "1";

  const claimUrl = useMemo(() => {
    if (!qrId || typeof window === "undefined") return null;
    return `${window.location.origin}/claim/${qrId}`;
  }, [qrId]);

  useEffect(() => {
    let active = true;
    if (!claimUrl) return () => {
      active = false;
    };
    QRCode.toDataURL(claimUrl, {
      width: 768,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
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

  useEffect(() => {
    if (!printMode) return;
    const timer = window.setTimeout(() => {
      try {
        window.print();
      } catch (error) {
        log.error("Failed to trigger print dialog", { error });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [printMode]);

  if (!qrId || !claimUrl || !qrImageUrl) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">QR card</h1>
        <p className="text-sm text-(--bearhacks-muted)">Invalid QR id.</p>
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Back to portal
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">BearHacks QR card</h1>
      <p className="text-sm text-(--bearhacks-muted)">
        Save this page to your home screen for quick access to your networking QR.
      </p>
      <div className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
        <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border)">
          <Image
            src={qrImageUrl}
            alt="Networking QR code"
            width={280}
            height={280}
            className="h-auto w-full"
            unoptimized
          />
        </div>
        <p className="mt-3 text-xs break-all text-(--bearhacks-muted)">
          Target: <span className="font-medium">{claimUrl}</span>
        </p>
      </div>
      <section className="text-sm text-(--bearhacks-muted)">
        <p>iOS Safari: Share -&gt; Add to Home Screen.</p>
        <p>Android Chrome: Menu -&gt; Add to Home screen.</p>
        <p>Android wallet fallback: use portal PNG/PDF download, then upload in your custom-pass workflow.</p>
      </section>
      <div className="flex gap-3 text-sm">
        <Link href="/" className="inline-flex min-h-(--bearhacks-touch-min) items-center underline">
          Back to portal
        </Link>
      </div>
    </main>
  );
}
