import type { Metadata } from 'next'
import { readConfig, isReady } from '@/lib/wellness/config.ts'
import { arrivalSource } from '@/lib/wellness/arrival.ts'
import Kiosk from './Kiosk'

// Read at request time, so turning SCANS_ENABLED off takes effect without a rebuild.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'DR MAGfield — Wellness check',
  robots: { index: false, follow: false },
}

export default function ScanPage({ searchParams }: { searchParams?: { src?: string } }) {
  const config = readConfig(process.env)
  // Both QRs are counted (the standee's ?src=qr and LV's old printed QR, redirected with ?src=lvqr). A count only:
  // no address, device or person. When lvqr reaches zero, LV's redirect can retire (Main 10-19 §7.4).
  const arrival = arrivalSource(searchParams?.src)
  if (arrival) console.info(JSON.stringify({ scope: 'wellness', event: 'qr_open', src: arrival }))
  // Only these non-secret values cross into the client bundle.
  return <Kiosk ready={isReady(config)} scanSeconds={config.scanSeconds} outletName={config.outlet.name} bookingUrl={config.bookingUrl} />
}
