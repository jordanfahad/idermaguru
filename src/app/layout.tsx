import type { Metadata } from "next";
import { Fraunces, Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

// Quiet-luxe type system. Exposed as CSS variables consumed by the scoped
// homepage stylesheet (src/components/dg-home.css → --serif / --sans / --arabic).
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Skin Advisor | AI Derma Guru",
  description:
    "A bilingual AI skin advisor and OTC skincare product discovery platform with safety-first recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${plexArabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
