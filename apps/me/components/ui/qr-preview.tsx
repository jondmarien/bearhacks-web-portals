"use client";

import { createLogger } from "@bearhacks/logger";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

const log = createLogger("me/qr-preview");

type QrPreviewProps = {
  qrId: string;
  /**
   * Visible label under the QR. Defaults to a generic instruction; pass a
   * tailored string when this preview belongs to a specific person.
   */
  label?: string;
  /**
   * Pixel width of the rendered image. Defaults to 256, which fits most cards.
   */
  size?: number;
};

export function QrPreview({ qrId, label, size = 256 }: QrPreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const claimUrl = useMemo(() => {
    if (!qrId || typeof window === "undefined") return null;
    return `${window.location.origin}/claim/${qrId}`;
  }, [qrId]);

  useEffect(() => {
    let active = true;
    if (!claimUrl) return;
    QRCode.toDataURL(claimUrl, {
      width: size * 2,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl: string) => {
        if (active) setImageUrl(dataUrl);
      })
      .catch((error: unknown) => {
        log.warn("Failed to generate QR preview", { qrId, error });
        if (active) setImageUrl(null);
      });
    return () => {
      active = false;
    };
  }, [claimUrl, qrId, size]);

  if (!claimUrl) return null;

  // Outer box grows with the decorative wooden frame; inner QR sits in the
  // transparent center at ``inset-[15%]`` (matches the frame art's inner
  // opening, leaving ~70% of width for the QR bitmap).
  const outerSize = Math.round(size * 1.42);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative"
        style={{ width: outerSize, height: outerSize }}
      >
        <Image
          src="/brand/wooden_frame.png"
          alt=""
          aria-hidden
          fill
          sizes={`${outerSize}px`}
          className="pointer-events-none select-none object-contain"
          unoptimized
        />
        <div className="absolute inset-[15%] flex items-center justify-center overflow-hidden rounded-sm bg-white p-2">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt="Networking QR code"
              width={size}
              height={size}
              className="h-full w-full object-contain"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-(--bearhacks-muted)">
              Rendering…
            </div>
          )}
        </div>
      </div>
      {label ? (
        <p className="text-center text-xs text-(--bearhacks-text-marketing)/70">
          {label}
        </p>
      ) : null}
    </div>
  );
}
