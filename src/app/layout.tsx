import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "Finance Tracker",
  description:
    "Personal finance tracking with smart categorization and budgeting",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FinTrack",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#1d6ec1",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
        <Script id="sw-register" strategy="afterInteractive" nonce={nonce}>
          {`if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }`}
        </Script>
      </body>
    </html>
  );
}
