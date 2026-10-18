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
  async headers() {
    return [
      { source: '/scan', headers: [...PRIVATE, { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }] },
      { source: '/scan/:path*', headers: [...PRIVATE, { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }] },
      { source: '/api/wellness/:path*', headers: PRIVATE },
    ]
  },
}

module.exports = nextConfig
