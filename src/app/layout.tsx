import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { PRIVACY_INIT_SCRIPT } from "@/lib/privacy";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SimpleBudget", template: "%s · SimpleBudget" },
  description: "A self-hosted personal finance dashboard powered by SimpleFIN.",
  applicationName: "SimpleBudget",
  appleWebApp: { capable: true, title: "SimpleBudget", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0D12" },
    { media: "(prefers-color-scheme: light)", color: "#F7F8FA" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRIVACY_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
