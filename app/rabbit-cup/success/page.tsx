/**
 * EV-8 — the same gate on the post-Stripe receipt view.
 *
 * A success page that renders while the rail is fenced would be a receipt for
 * a payment this build cannot take, so it is gated on the same flag and by
 * the same lazy import. See app/rabbit-cup/page.tsx.
 */

'use client'

import dynamic from 'next/dynamic'
import NotAvailable from '../NotAvailable'
import { rabbitCupEnabled } from '@/lib/standee'

const RABBIT_CUP_ENABLED = rabbitCupEnabled({
  NEXT_PUBLIC_RABBIT_CUP_ENABLED: process.env.NEXT_PUBLIC_RABBIT_CUP_ENABLED,
})

const ReceiptView = dynamic(() => import('./ReceiptView'), {
  ssr: false,
  loading: () => null,
})

export default function RabbitCupSuccessPage() {
  if (!RABBIT_CUP_ENABLED) return <NotAvailable />
  return <ReceiptView />
}
