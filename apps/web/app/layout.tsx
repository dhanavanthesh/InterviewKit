import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { PropsWithChildren } from "react";
import { SiteHeader } from "../components/site-header";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "InterviewKit",
  description: "Interview preparation kits built from a job description",
  icons: { icon: "/interviewkit-mark.png" },
};

export const viewport: Viewport = {
  themeColor: "#f4f6fb",
  colorScheme: "light",
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="page-shell">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
