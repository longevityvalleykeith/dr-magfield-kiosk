import type { Metadata, Viewport } from 'next'
import { buildIdentity, buildStampText } from '@/lib/build-identity'
import './globals.css'

// The served page must be able to say which build it is, so a walk can tell
// "the fix is deployed" from "the fix is merged".
const BUILD = buildIdentity(process.env)

export const metadata: Metadata = {
  title: 'DR MAGfield — Experience Lounge',
  description: 'Malaysia\'s First Golf Club Bio-Energetic Therapy Lounge. Turn Pain into Pure Performance.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'DR MAGfield' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1A1A1A',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Manrope:wght@300;400;500;700&family=Montserrat:wght@400;800&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <small
          data-build={buildStampText(BUILD)}
          data-build-sha12={BUILD.BUILD_SHA12}
          style={{
            position: 'fixed',
            right: 8,
            bottom: 6,
            zIndex: 50,
            fontFamily: "'Manrope', -apple-system, sans-serif",
            fontSize: 10,
            letterSpacing: '0.04em',
            color: 'rgba(113, 128, 150, 0.75)',
            pointerEvents: 'none',
          }}
        >
          {buildStampText(BUILD)}
        </small>
      </body>
    </html>
  )
}
