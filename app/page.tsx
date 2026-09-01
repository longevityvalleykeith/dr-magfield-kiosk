/**
 * DR MAGfield — the KRPM standee.
 *
 * This screen used to be a chat panel that asked a walk-in for their name and
 * talked to `http://localhost:3100`, which no device at the lounge can reach,
 * so it said "Demo Mode" for every one of its production days. Its QR opened a
 * Telegram bot, so no scan ever reached the record.
 *
 * It is now a standee: one QR to the governed scan landing, the canon ladder,
 * and the coordinator's line. It captures nothing, plays nothing, and claims
 * nothing it has not read. (T1 2026-09-02 audit — EV-17 · EV-1 · EV-8.)
 */

'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import styles from './standee.module.css'
import {
  LADDER,
  ARIE_WHATSAPP_DISPLAY,
  resolveDoorwayUrl,
  resolveStatusEndpoint,
  whatsappUrl,
} from '@/lib/standee'

// Resolved at build time from env — the fallbacks live in lib/standee.ts and
// are production-safe by construction (no loopback can survive the check).
const DOORWAY_URL = resolveDoorwayUrl({
  NEXT_PUBLIC_DOORWAY_URL: process.env.NEXT_PUBLIC_DOORWAY_URL,
})
const STATUS_ENDPOINT = resolveStatusEndpoint({
  NEXT_PUBLIC_STANDEE_STATUS_URL: process.env.NEXT_PUBLIC_STANDEE_STATUS_URL,
})

const WHATSAPP_HREF = whatsappUrl(
  'Hi Arie, I am at the DR MAGfield lounge at KRPM and would like to know more.',
)

/** Unmeasured until a reader answers. There is no fourth state that means "probably". */
type VenueStatus = 'unmeasured' | 'unreachable' | 'open'

const STATUS_WORD: Record<VenueStatus, string> = {
  unmeasured: 'Unmeasured',
  unreachable: 'Unreachable',
  open: 'Open',
}

/** DESIGN.md: spiral vortex — three rings and a centre dot. Never an emoji. */
function VortexMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="24" cy="24" r="21" opacity="0.35" />
        <circle cx="24" cy="24" r="14" opacity="0.6" />
        <circle cx="24" cy="24" r="7" />
      </g>
      <circle cx="24" cy="24" r="2.5" fill="currentColor" />
    </svg>
  )
}

export default function StandeePage() {
  const [qr, setQr] = useState<string | null>(null)
  const [status, setStatus] = useState<VenueStatus>('unmeasured')

  // ── the one QR ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(DOORWAY_URL, {
      width: 720,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#2D3748', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {
        // The URL is printed under the frame either way — the doorway survives
        // a QR render failure.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── the status line, only if an endpoint was configured ──────────
  useEffect(() => {
    if (!STATUS_ENDPOINT) return // stays Unmeasured, which is the truth
    let cancelled = false
    fetch(STATUS_ENDPOINT, { signal: AbortSignal.timeout(5000) })
      .then((res) => {
        if (cancelled) return
        setStatus(res.ok ? 'open' : 'unreachable')
      })
      .catch(() => {
        if (!cancelled) setStatus('unreachable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className={styles.standee}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>
            <VortexMark size={52} />
          </span>
          <span className={styles.wordmark}>
            <b>DR</b> MAGfield
          </span>
        </div>
        <p className={styles.venue}>Experience Lounge · Kelab Rahman Putra Malaysia</p>
      </header>

      <div className={styles.main}>
        <section className={styles.say}>
          <h1 className={styles.headline}>Turn pain into pure performance.</h1>
          <p className={styles.subhead}>
            Malaysia&rsquo;s first golf club bio-energetic therapy lounge. Rotational magnetic
            therapy, heat and acoustic vibration — you stay fully clothed.
          </p>

          <div className={styles.ladder}>
            {LADDER.map((row) => (
              <div key={row.sku} className={styles.ladderRow}>
                <span className={styles.price}>{row.price}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>{row.label}</span>
                  <span className={styles.sku}>{row.sku}</span>
                </span>
              </div>
            ))}
          </div>
          <p className={styles.ladderNote}>
            What each package includes is confirmed at the lounge, not on this screen.
          </p>

          <a className={styles.whatsapp} href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
            <span className={styles.whatsappDot} aria-hidden="true" />
            WhatsApp Arie Ong · {ARIE_WHATSAPP_DISPLAY}
          </a>
        </section>

        <section className={styles.doorway} aria-labelledby="doorway-heading">
          <h2 className={styles.doorwayHeading} id="doorway-heading">
            Scan to open the lounge page
          </h2>
          <div className={styles.qrFrame}>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.qr} src={qr} alt={`QR code for ${DOORWAY_URL}`} width={720} height={720} />
            ) : (
              <div className={styles.qrPlaceholder} aria-hidden="true" />
            )}
          </div>
          <p className={styles.doorwayUrl}>{DOORWAY_URL}</p>
          <p className={styles.doorwayNote}>
            This screen collects nothing. Scanning opens the lounge&rsquo;s own page on your phone.
          </p>
        </section>
      </div>

      <footer className={styles.footer}>
        <span className={styles.status} data-status={status}>
          <span className={styles.statusDot} aria-hidden="true" />
          Lounge status · {STATUS_WORD[status]}
        </span>
        <span className={styles.hours}>Sessions by appointment</span>
      </footer>
    </main>
  )
}
