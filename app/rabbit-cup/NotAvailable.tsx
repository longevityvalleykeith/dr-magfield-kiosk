/**
 * EV-8 — what `/rabbit-cup` serves while the flag is unset.
 *
 * The rail behind this route registers a guest and opens a Stripe checkout.
 * It predates the K-1 money fence, so it is off unless the deployment sets
 * NEXT_PUBLIC_RABBIT_CUP_ENABLED to exactly `true`.
 *
 * A fenced page still owes the guest a way through, so it carries the one
 * human line. It promises nothing about payment, because nothing was taken.
 */

import { ARIE_WHATSAPP_DISPLAY, whatsappUrl } from '@/lib/standee'

const WHATSAPP_HREF = whatsappUrl(
  'Hi Arie, I would like to ask about DR MAGfield sessions at KRPM.',
)

export default function NotAvailable() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '48px 24px',
        textAlign: 'center',
        background: 'var(--cream)',
        color: 'var(--text)',
      }}
    >
      <h1
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontWeight: 600,
          fontSize: 'clamp(28px, 6vw, 44px)',
          lineHeight: 1.1,
          color: 'var(--navy)',
          maxWidth: '18ch',
        }}
      >
        Online sign-up is not available
      </h1>
      <p
        style={{
          fontSize: 'clamp(14px, 3.4vw, 17px)',
          lineHeight: 1.6,
          color: 'var(--text-body)',
          maxWidth: '40ch',
        }}
      >
        Sessions at the DR MAGfield lounge are arranged with our Experience
        Coordinator. Message Arie and he will take it from there.
      </p>
      <a
        href={WHATSAPP_HREF}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 56,
          padding: '15px 26px',
          borderRadius: 12,
          background: 'var(--whatsapp)',
          color: 'var(--white)',
          fontSize: 'clamp(14px, 3.2vw, 17px)',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        WhatsApp Arie Ong · {ARIE_WHATSAPP_DISPLAY}
      </a>
    </main>
  )
}
