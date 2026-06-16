import "../styles/globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";

import { type FC, type PropsWithChildren, Suspense } from "react";
import { cn } from "@labjm/utilities/cn";
import { url } from "@labjm/utilities/url-composer";

import { Footer } from "@/ui/footer";

export const metadata: Metadata = {
  title: "lab.jakubmisilo.com",
  description:
    "Jakub Misilo's space to experiment & explore new tech and ideas.",
  authors: [{ name: "Jakub Misilo", url: "https://jakubmisilo.com" }],
  metadataBase: new URL(url.origin),
};

const interDisplay = localFont({
  src: [
    {
      path: "./_utils/fonts/inter-display/InterDisplay-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./_utils/fonts/inter-display/InterDisplay-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./_utils/fonts/inter-display/InterDisplay-Italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  display: "swap",
  variable: "--font-inter-display",
});

const RootLayout: FC<PropsWithChildren> = async ({ children }) => {
  return (
    <html
      lang="en"
      className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-black/30 scrollbar-track-rounded-full"
    >
      {process.env.NODE_ENV !== "production" && (
        <head>
          {/* eslint-disable-next-line */}
          <script
            crossOrigin="anonymous"
            src="//unpkg.com/react-scan/dist/auto.global.js"
          />
        </head>
      )}

      <body
        className={cn(
          interDisplay.className,
          interDisplay.variable,
          "bg-white min-h-screen flex flex-col",
          "text-zinc-500 selection:text-zinc-600 selection:bg-zinc-300/70",
          "[&_h1,h2,h3,h4,h5,h6]:text-zinc-950 [&_h1,h2,h3,h4,h5,h6]:font-medium [&_h1]:text-xl [&_h2]:text-lg [&_h3,h4,h5,h6]:text-base",
        )}
      >
        <div className="pt-8 sm:pt-16 relative flex-1 w-full">{children}</div>

        <div className="mx-auto px-5 max-w-120 sm:max-w-140 md:max-w-152 w-full pb-5 pt-12 sm:pt-16">
          <Suspense fallback={<Footer.Skeleton />}>
            <Footer />
          </Suspense>
        </div>
      </body>
    </html>
  );
};

export default RootLayout;
