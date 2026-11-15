import type { Metadata, Viewport } from "next";
import { Bungee, Anton, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const poster = Anton({ weight: "400", subsets: ["latin"], variable: "--font-poster" });
const body = Space_Grotesk({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "HeadlineOdds Arena · web edition (demo)",
  description: "15-minute BTC UP/DOWN rounds with friends. Demo build: chips and mock USDC only.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffc800" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${poster.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
