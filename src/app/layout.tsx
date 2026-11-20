import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/env";
import "./globals.css";

const DESCRIPTION =
  "MERCYMAP helps churches receive requests for help, reserve what they can give, coordinate volunteers and see their impact. People asking for help never need an account.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "MERCYMAP · Church compassion, coordinated", template: "%s · MERCYMAP" },
  description: DESCRIPTION,
  applicationName: "MERCYMAP",
  openGraph: {
    type: "website",
    siteName: "MERCYMAP",
    title: "MERCYMAP · Church compassion, coordinated",
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: { card: "summary_large_image", title: "MERCYMAP · Church compassion, coordinated", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#174d3a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* First thing a keyboard user reaches: jumps past navigation. */}
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-forest px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
