import { ThemeProvider } from "@bearhacks/ui/theme";
import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { AdminGateBanner } from "@/components/admin-gate-banner";
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
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001",
  ),
  title: {
    default: "BearHacks 2026 Admin",
    template: "%s · BearHacks Admin",
  },
  description:
    "Staff console for BearHacks 2026 — QR fulfillment and profile management.",
  icons: {
    icon: "/brand/icon_black.svg",
    shortcut: "/brand/icon_black.svg",
    apple: "/brand/icon_black.svg",
  },
  openGraph: {
    title: "BearHacks 2026 Admin",
    description:
      "Staff console for BearHacks 2026 — QR fulfillment and profile management.",
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
    <html
      lang="en"
      className={`${hanken.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-(--bearhacks-surface-alt) font-sans text-(--bearhacks-fg)">
        <ThemeProvider>
          <Providers>
            <SiteHeader />
            <AdminGateBanner />
            {children}
            <SiteFooter />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
