import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "SF Civic Tracker",
  description:
    "Plain-English summaries of San Francisco Planning Commission, Board of Supervisors, and public hearing agendas. Filter by neighborhood, district, or topic.",
};

const navLinks: { href: string; label: string }[] = [
  { href: "/ask", label: "Ask" },
  { href: "/meetings", label: "Meetings" },
  { href: "/topics", label: "Topics" },
  { href: "/neighborhoods", label: "Neighborhoods" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              SF Civic Tracker
            </Link>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {navLinks.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  {l.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
