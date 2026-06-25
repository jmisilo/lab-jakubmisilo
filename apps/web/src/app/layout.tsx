import type { Metadata } from 'next';
import type { FC, PropsWithChildren } from 'react';

import { Analytics } from '@vercel/analytics/next';
import localFont from 'next/font/local';
import { Suspense } from 'react';

import { cn } from '@labjm/utilities/cn';
import { url } from '@labjm/utilities/url-composer';

import { Footer } from '@/ui/footer';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'lab.jakubmisilo.com',
  description: "Jakub Misilo's space to experiment & explore new tech and ideas.",
  authors: [{ name: 'Jakub Misilo', url: 'https://jakubmisilo.com' }],
  metadataBase: new URL(url.origin),
};

const interDisplay = localFont({
  src: [
    {
      path: './_utils/fonts/inter-display/InterDisplay-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './_utils/fonts/inter-display/InterDisplay-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './_utils/fonts/inter-display/InterDisplay-Italic.woff2',
      weight: '400',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-inter-display',
});

const RootLayout: FC<PropsWithChildren> = async ({ children }) => {
  return (
    <html
      lang="en"
      className="scrollbar-track-rounded-full scrollbar-thin scrollbar-thumb-black/30 scrollbar-track-transparent"
    >
      {process.env.NODE_ENV !== 'production' && (
        <head>
          {/* eslint-disable-next-line */}
          <script crossOrigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" />
        </head>
      )}

      <body
        className={cn(
          interDisplay.className,
          interDisplay.variable,
          'flex min-h-screen flex-col bg-white',
          'text-zinc-500 selection:bg-zinc-300/70 selection:text-zinc-600',
          '[&_h1]:text-xl [&_h1,h2,h3,h4,h5,h6]:font-medium [&_h1,h2,h3,h4,h5,h6]:text-zinc-950 [&_h2]:text-lg [&_h3,h4,h5,h6]:text-base',
        )}
      >
        <div className="relative w-full flex-1 pt-8 sm:pt-16">{children}</div>

        <div className="mx-auto w-full max-w-120 px-5 pt-12 pb-5 sm:max-w-140 sm:pt-16 md:max-w-152">
          <Suspense fallback={<Footer.Skeleton />}>
            <Footer />
          </Suspense>
        </div>
      </body>

      <Analytics />
    </html>
  );
};

export default RootLayout;
