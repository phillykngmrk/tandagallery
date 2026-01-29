import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/layout/header';
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'T & A Gallery — Curated Motion',
    template: '%s | T & A Gallery',
  },
  description: 'Discover the best GIFs and short videos from across the web. A carefully curated collection updated continuously.',
  keywords: ['gifs', 'videos', 'motion', 'animation', 'curated', 'short videos', 'memes'],
  authors: [{ name: 'T & A Gallery' }],
  creator: 'T & A Gallery',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tandagallery.com'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'T & A Gallery',
    title: 'T & A Gallery — Curated Motion',
    description: 'Discover the best GIFs and short videos from across the web.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'T & A Gallery - Curated Motion',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'T & A Gallery — Curated Motion',
    description: 'Discover the best GIFs and short videos from across the web.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
