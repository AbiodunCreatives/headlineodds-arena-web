import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font" });

export const metadata: Metadata = {
  title: "HeadlineOdds Arena · web edition (demo)",
  description: "trade the news. 15-minute btc up/down rounds with friends. demo build: chips and mock usdc only.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#080A09" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
