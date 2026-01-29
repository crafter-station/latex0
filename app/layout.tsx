import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeTransitionOverlay } from "@/components/theme-switcher-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://latex0.crafter.run"),
  title: "LATEX0 - The Future of Typesetting",
  description: "An AI-powered LaTeX editor for the modern era. Researchers deserve open source tools.",
  keywords: ["LaTeX", "editor", "AI", "typesetting", "research", "academic", "open source"],
  authors: [{ name: "Crafter Station" }],
  openGraph: {
    title: "LATEX0",
    description: "An AI-powered LaTeX editor for the modern era. Write. Compile. Ship.",
    url: "https://latex0.crafter.run",
    siteName: "LATEX0",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "LATEX0 - The Future of Typesetting",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LATEX0 - The Future of Typesetting",
    description: "An AI-powered LaTeX editor for the modern era. Write. Compile. Ship.",
    images: ["/og-twitter.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-svh overflow-hidden" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-svh overflow-hidden`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <ThemeTransitionOverlay />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
