import type { Metadata } from 'next'
import { readConfig, isReady } from '@/lib/wellness/config.ts'
import Kiosk from './Kiosk'

// Read at request time, so turning SCANS_ENABLED off takes effect without a rebuild.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'DR MAGfield — Wellness check',
  robots: { index: false, follow: false },
}

export default function ScanPage() {
  const config = readConfig(process.env)
  // Only these three non-secret values cross into the client bundle.
  return <Kiosk ready={isReady(config)} scanSeconds={config.scanSeconds} outletName={config.outlet.name} />
}
