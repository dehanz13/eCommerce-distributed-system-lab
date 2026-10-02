import type { NextConfig } from 'next';
import { loadConfiguration } from '@lab/runtime/configuration';
const settings = loadConfiguration();
const ordering = settings.ORDERING_URL;
const fulfillment = settings.FULFILLMENT_URL;
const operator = settings.OPERATOR_URL;
const config: NextConfig = {
  transpilePackages: ['@lab/client', '@lab/contracts'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: ordering + '/api/:path*' },
      { source: '/ordering/:path*', destination: ordering + '/:path*' },
      { source: '/fulfillment/:path*', destination: fulfillment + '/:path*' },
      { source: '/operator/:path*', destination: operator + '/:path*' },
    ];
  },
};
export default config;
