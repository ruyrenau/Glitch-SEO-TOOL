import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Glitch SEO Ops Engine',
  description: 'Enterprise Technical SEO, Server Log Intelligence & Programmatic Automation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#EEF0F8] text-[#1E2132] antialiased">
        {children}
      </body>
    </html>
  );
}
