/**
 * DR MAGfield standee — the configuration, as pure functions.
 *
 * Nothing here renders, fetches or touches React, so `node --test` can hold
 * every law without a browser and a failure names the law, not a component.
 *
 * The governing findings (T1 2026-09-02 audit, EV-1 · EV-8 · EV-17):
 *   - the widget's served bundle embedded `http://localhost:3100`, so every
 *     real device read "Demo Mode" forever;
 *   - its QR opened `t.me/DrMAGfield_Bot?start=krpm`, not the scan landing,
 *     so no scan ever reached `qr_scan_receipts`;
 *   - `/rabbit-cup` reached Stripe on a rail older than the K-1 money fence.
 *
 * The cure in all three cases is the same shape: a default that is safe in
 * production, and an override that must earn its way past a check.
 */

export type Env = Record<string, string | undefined>

// ── EV-1 · the one doorway ───────────────────────────────────────────
/**
 * The governed scan landing for KRPM. Every DR MAGfield QR — standee,
 * widget, film — decodes to this, so the scan lands on the record.
 */
export const DOORWAY_URL_CANON = 'https://app.longevityvalley.ai/scan/dr-magfield/krpm'

/**
 * The hosts a standee may point a phone at.
 *
 * This is an ALLOWLIST, not a loopback denylist, and the EV-17 census is why.
 * A denylist has to spell out the hosts it refuses, which puts the literal
 * `localhost` into the shipped bundle — where the census reads it as exactly
 * the defect it is guarding against. The guard would mint its own RED. An
 * allowlist states the law positively, ships no forbidden string, and also
 * refuses hosts nobody thought to deny.
 *
 * Loopback in every costume (localhost, *.localhost, 127.0.0.0/8, 0.0.0.0,
 * [::1]) fails this by construction, because none of them are ours.
 */
const ALLOWED_HOST = /(^|\.)longevityvalley\.ai$|(^|\.)vercel\.app$/

export function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOST.test(hostname.toLowerCase())
}

/** An absolute https URL on an allowed host, or nothing. */
function acceptUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!isAllowedHost(url.hostname)) return null
  return value
}

/**
 * The QR destination. `NEXT_PUBLIC_DOORWAY_URL` may point a preview at a
 * staging landing, but only if it is absolute https on an allowed host —
 * anything else falls back to the canon, so no build can ship a doorway
 * that a phone at the lounge cannot open.
 */
export function resolveDoorwayUrl(env: Env = {}): string {
  return acceptUrl(env.NEXT_PUBLIC_DOORWAY_URL) ?? DOORWAY_URL_CANON
}

// ── EV-17 · the status line is measured or it says so ────────────────
/**
 * The optional venue-status endpoint. There is deliberately NO default:
 * an unconfigured standee reads Unmeasured, which is true, instead of
 * probing a developer's laptop and reading "Demo Mode", which was not.
 */
export function resolveStatusEndpoint(env: Env = {}): string | null {
  return acceptUrl(env.NEXT_PUBLIC_STANDEE_STATUS_URL)
}

// ── EV-8 · the money rail is fenced ──────────────────────────────────
/**
 * The pre-K-1 rabbit-cup → Stripe path. Off unless the deployment sets the
 * exact string `true`; nothing is coerced, so a stray `1` or `yes` leaves
 * the fence up. Retire vs quarantine is Keith's door S-C — the code stays.
 */
export function rabbitCupEnabled(env: Env = {}): boolean {
  return env.NEXT_PUBLIC_RABBIT_CUP_ENABLED === 'true'
}

// ── the canon ladder ─────────────────────────────────────────────────
export type LadderRow = { sku: string; price: string; label: string }

/**
 * Price and SKU only. T1's ambiguity register (AMB-1) still holds RM325 at
 * 5 sessions (engine fixtures, served landing) against 6 (partnership canon
 * "5+1"), and RM1500 at 7 against 7+1. A standee cannot resolve that, so it
 * prints neither count and sends the question to the coordinator.
 */
export const LADDER: readonly LadderRow[] = [
  { sku: 'DRM-SINGLE-60', price: 'RM65', label: 'Single session · 60 min' },
  { sku: 'DRM-PKG5', price: 'RM325', label: 'Package' },
  { sku: 'DRM-PKG7', price: 'RM1500', label: 'Package' },
]

// ── the one human line ───────────────────────────────────────────────
/** Arie Ong, Experience Coordinator — the lounge's published business line. */
export const ARIE_WHATSAPP = '60126595319'
export const ARIE_WHATSAPP_DISPLAY = '+6012-659 5319'

export function whatsappUrl(message: string): string {
  return `https://wa.me/${ARIE_WHATSAPP}?text=${encodeURIComponent(message)}`
}
