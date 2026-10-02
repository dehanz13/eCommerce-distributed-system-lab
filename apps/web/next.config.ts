import type { NextConfig } from 'next';
const ordering = process.env.LAB_ORDERING_URL ?? 'http://127.0.0.1:4311';
const fulfillment = process.env.LAB_FULFILLMENT_URL ?? 'http://127.0.0.1:4312';
const operator = process.env.LAB_OPERATOR_URL ?? 'http://127.0.0.1:4313';
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
