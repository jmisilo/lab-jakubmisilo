import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [new URL('https://landing-storage.knmstudio.com/portfolio/lab/**')],
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'imessage-sdk.dev',
          },
        ],
        destination: 'https://github.com/jmisilo/imessage-sdk',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.imessage-sdk.dev',
          },
        ],
        destination: 'https://github.com/jmisilo/imessage-sdk',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
