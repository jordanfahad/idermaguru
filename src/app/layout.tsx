import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
