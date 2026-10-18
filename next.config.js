/** @type {import('next').NextConfig} */

// The wellness check's pages and API never cache, never send a referrer, stay out of search
// engines, and are the only routes allowed the camera (T1 #164 CLOUD-12 / O2O-10).
const PRIVATE = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

const nextConfig = {
  reactStrictMode: true,
  // No page uses next/image. Turning the optimizer off closes /_next/image, which on 14.2.x carries
  // GHSA-2xp9-vwfh-vxw4 (critical RCE via sharp/libheif when AVIF is optimized; fixed only in next ≥ 15.5.24).
  images: { unoptimized: true },
  async headers() {
    return [
      { source: '/scan', headers: [...PRIVATE, { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }] },
      { source: '/scan/:path*', headers: [...PRIVATE, { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }] },
      { source: '/api/wellness/:path*', headers: PRIVATE },
    ]
  },
}

module.exports = nextConfig
