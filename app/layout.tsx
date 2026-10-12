import type { Metadata, Viewport } from "next";
import { Caveat, IBM_Plex_Mono, Libre_Caslon_Text, Playfair_Display } from "next/font/google";
import "./globals.css";

const display = Playfair_Display({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-display" });
const body = Libre_Caslon_Text({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });
const hand = Caveat({ subsets: ["latin"], weight: ["500"], variable: "--font-hand" });

export const metadata: Metadata = {
  title: "The Dispatch — newsletter intelligence engine",
  description: "Weekly Indian startup & tech newsletter: collect, select with Gemini, approve in Telegram, send with Resend. Assignment prototype.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#d9cfbd" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} ${hand.variable}`}>
      <body>
        <div className="banner">Assignment prototype — sample data is labelled</div>
        {children}
      </body>
    </html>
  );
}
