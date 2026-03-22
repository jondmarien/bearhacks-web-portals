import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { AdminGateBanner } from "@/components/admin-gate-banner";
import { Providers } from "./providers";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: "BearHacks — Admin",
  description: "Staff / admin portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hanken.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-(--bearhacks-bg) text-(--bearhacks-fg) font-sans">
        <Providers>
          <AdminGateBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
