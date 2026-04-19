import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "./providers";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "BearHacks 2026 Networking",
    template: "%s · BearHacks 2026",
  },
  description: "Create your networking profile and claim your event QR.",
  icons: {
    icon: "/brand/icon_black.svg",
    shortcut: "/brand/icon_black.svg",
    apple: "/brand/icon_black.svg",
  },
  openGraph: {
    title: "BearHacks 2026 Networking",
    description: "Create your networking profile and claim your event QR.",
    siteName: "BearHacks 2026",
    type: "website",
    images: ["/brand/icon_white.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hanken.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-(--bearhacks-surface-alt) font-sans text-(--bearhacks-fg)">
        <Providers>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
