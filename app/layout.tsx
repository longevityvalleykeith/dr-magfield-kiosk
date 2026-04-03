import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  themeColor: '#F9F7F2',
}

export const metadata: Metadata = {
  title: 'DR MAGfield — KRPM Experience Lounge',
  description: 'Quantum Resonance Pendulum Method · Elite Golf Recovery',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
