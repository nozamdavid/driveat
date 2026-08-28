import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const bodyFont = Geist({ subsets: ["latin"], variable: "--font-geist" });
const displayFont = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const monoFont = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const siteTitle = "AT Storage — Your files. Your account.";
const siteDescription =
  "AT Storage keeps exact media originals in an owner-only permissioned Space, organizes them into albums. Other file types will be added soon™";
const siteOrigin = "https://atgallery.noz.am";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: siteTitle,
  description: siteDescription,
  applicationName: "AT Storage",
  openGraph: {
    title: "Your files. Your account.",
    description: siteDescription,
    siteName: "AT Storage",
    url: siteOrigin,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your files. Your account.",
    description: siteDescription,
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
