import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "A talent directory with opt-in lookalike search.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="wordmark">
              {SITE_NAME}
            </Link>
            <nav className="site-nav">
              <Link href="/">Talents</Link>
              <Link href="/search">Find a lookalike</Link>
              <Link href="/join" className="cta">
                Join as talent
              </Link>
            </nav>
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="wrap">
            Every profile here was created by the talent themselves. Face search only includes
            talents who switched it on, and they can switch it off at any time.
          </div>
        </footer>
      </body>
    </html>
  );
}
