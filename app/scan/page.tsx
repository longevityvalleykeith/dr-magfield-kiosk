import type { Metadata } from 'next'
import { readConfig, isReady } from '@/lib/wellness/config.ts'
import Kiosk from './Kiosk'

// Read at request time, so turning SCANS_ENABLED off takes effect without a rebuild.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'DR MAGfield — Wellness check',
  robots: { index: false, follow: false },
}

export default function ScanPage({ searchParams }: { searchParams?: { src?: string } }) {
  const config = readConfig(process.env)
  // The standee QR carries ?src=qr. A count only: no address, device or person (it replaces EV-1's receipt for this QR).
  if (searchParams?.src === 'qr') console.info(JSON.stringify({ scope: 'wellness', event: 'qr_open' }))
  // Only these three non-secret values cross into the client bundle.
  return <Kiosk ready={isReady(config)} scanSeconds={config.scanSeconds} outletName={config.outlet.name} />
}
