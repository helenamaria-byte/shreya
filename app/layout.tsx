import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Dispatch — newsletter engine",
  description: "Weekly Indian startup & tech newsletter: collect, select with Gemini, approve in Telegram, send with Resend. Assignment prototype.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner">Assignment prototype — sample data is labelled.</div>
        {children}
      </body>
    </html>
  );
}
