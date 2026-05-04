import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader, JetBrains_Mono } from "next/font/google";
import { Masthead, Footer } from "@/components/Masthead";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SF Civic Tracker",
  description:
    "Plain-English summaries of San Francisco Planning Commission, Board of Supervisors, and public hearing agendas. Filter by neighborhood, district, or topic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Masthead />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
