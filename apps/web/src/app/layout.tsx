import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'G.SEO',
  description: 'Enterprise Technical SEO, Server Log Intelligence & Programmatic Automation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
