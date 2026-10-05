import type { NextConfig } from 'next';
import { loadWebConfiguration } from '@lab/runtime/configuration';
const settings = loadWebConfiguration();
const ordering = settings.ORDERING_URL;
const fulfillment = settings.FULFILLMENT_URL;
const operator = settings.OPERATOR_URL;
const config: NextConfig = {
  transpilePackages: ['@lab/client', '@lab/contracts'],
  /** Map browser-origin paths to configured backend HTTP origins.
   * Input: no arguments; uses its current owner state, from public origins read from .env.web or .env.
   * Communicates with Next.js proxy routing to ordering, fulfillment and operator HTTP.
   */
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
