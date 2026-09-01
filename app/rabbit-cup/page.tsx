/**
 * EV-8 — the gate in front of the rabbit-cup rail.
 *
 * The rail underneath registers a guest against the Foundry and opens a
 * Stripe checkout; it is older than the K-1 money fence (T1 08-23 N5). It is
 * therefore OFF unless the deployment sets NEXT_PUBLIC_RABBIT_CUP_ENABLED to
 * exactly `true`.
 *
 * The form is reached through a lazy import, not a static one, so with the
 * flag unset its code sits in a chunk this page never requests — the phone
 * does not download the register endpoint at all. The module is kept, not
 * deleted: retire vs quarantine is Keith's door S-C.
 */

'use client'

import dynamic from 'next/dynamic'
import NotAvailable from './NotAvailable'
import { rabbitCupEnabled } from '@/lib/standee'

const RABBIT_CUP_ENABLED = rabbitCupEnabled({
  NEXT_PUBLIC_RABBIT_CUP_ENABLED: process.env.NEXT_PUBLIC_RABBIT_CUP_ENABLED,
})

const RegisterForm = dynamic(() => import('./RegisterForm'), {
  ssr: false,
  loading: () => null,
})

export default function RabbitCupPage() {
  if (!RABBIT_CUP_ENABLED) return <NotAvailable />
  return <RegisterForm />
}
