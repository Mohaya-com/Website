import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Single .env at the repository root is shared by the web app, scripts and tests.
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Pass links carry their token in the URL fragment; never leak URLs to other sites.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ['@vms/shared', '@vms/server', '@vms/db'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
