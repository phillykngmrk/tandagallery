import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/layout/header';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tandagallery.com';

export const metadata: Metadata = {
  title: {
    default: 'T & A Gallery — Curated GIFs & Short Videos',
    template: '%s | T & A Gallery',
  },
  description: 'Discover the best curated GIFs and short videos from across the web. Browse trending content, explore tags, and enjoy a continuously updated collection of motion media.',
  keywords: ['gifs', 'short videos', 'curated gifs', 'trending videos', 'animated gifs', 'video clips', 'motion media', 'viral gifs', 'best gifs'],
  authors: [{ name: 'T & A Gallery' }],
  creator: 'T & A Gallery',
  publisher: 'T & A Gallery',
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'T & A Gallery',
    title: 'T & A Gallery — Curated GIFs & Short Videos',
    description: 'Discover the best curated GIFs and short videos from across the web.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'T & A Gallery - Curated GIFs and Short Videos',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'T & A Gallery — Curated GIFs & Short Videos',
    description: 'Discover the best curated GIFs and short videos from across the web.',
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
    icon: '/icon.svg',
    apple: '/apple-icon',
  },
  verification: {
    // Add your Google Search Console verification code here
    // google: 'your-verification-code',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'T & A Gallery',
    url: siteUrl,
    description: 'Discover the best curated GIFs and short videos from across the web.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/tags/{search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="en" className={inter.variable}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>
          <Header />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
