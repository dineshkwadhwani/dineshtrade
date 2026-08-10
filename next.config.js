/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['dineshtrade.vercel.app', 'dineshtrade.online'],
    unoptimized: true,
  },
  // Set client-side router cache to 0 for dynamic pages — without this,
  // Next.js serves stale HTML from memory on navigation even with force-dynamic.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
}
module.exports = nextConfig
