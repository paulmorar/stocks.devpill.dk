import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { ModeProvider } from "@/components/mode";
import { authMode } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Stock Scout",
  description: "Find and understand stocks: a long-term quality score and short-term trading setups, explained for experts and beginners.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1f2228", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ModeProvider>
          <Header authOn={authMode() === "on"} />
          <main>
            <div className="wrap">{children}</div>
          </main>
          <footer className="footer">
            <div className="wrap">
              Educational tool, not investment advice. Data from Yahoo Finance (unofficial) and, if configured, Financial Modeling Prep; may be delayed or wrong.
              Scoring inspired by The Traveling Trader&apos;s TTT Score methodology; thresholds are this app&apos;s own.
            </div>
          </footer>
        </ModeProvider>
      </body>
    </html>
  );
}
