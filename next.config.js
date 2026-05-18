/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { domains: ['dineshtrade.vercel.app', 'dineshtrade.online'] },
  // Required in Next 14.x to enable instrumentation.ts (where we register node-cron).
  // Auto-enabled in Next 15+.
  experimental: { instrumentationHook: true },
}
module.exports = nextConfig
