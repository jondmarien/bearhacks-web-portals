import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: "BearHacks — Me",
  description: "Participant portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hanken.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[var(--bearhacks-bg)] text-[var(--bearhacks-fg)] font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
