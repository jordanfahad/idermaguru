import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Cosmetologist | AI Derma Guru",
  description:
    "A bilingual AI cosmetologist and OTC skincare product discovery platform with safety-first recommendations.",
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
