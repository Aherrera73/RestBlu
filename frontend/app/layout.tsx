import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'RestBlu | Arriendos y accesos inteligentes',
  description: 'RestBlu: plataforma de reservas, accesos inteligentes y operación autónoma asistida por IA.',
  openGraph: {
    title: 'RestBlu | Arriendos y accesos inteligentes',
    description: 'Reservas, accesos inteligentes y operación autónoma asistida por IA.',
    images: ['https://restblu.web.app/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RestBlu | Arriendos y accesos inteligentes',
    description: 'Reservas, accesos inteligentes y operación autónoma asistida por IA.',
    images: ['https://restblu.web.app/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
