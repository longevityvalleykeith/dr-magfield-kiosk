/**
 * Two signed capabilities, both HMAC'd with KIOSK_COOKIE_SECRET:
 *
 * - **Device cookie** (`__Host-dmk-device`: HttpOnly, Secure, SameSite=Strict). Staff set it once
 *   per tablet at /scan/enroll. Without it, no booking is read and no scan is sent. It is never a
 *   NEXT_PUBLIC token: W-4b withdrew the LV kiosk because its device token was inlined into the page.
 * - **Attempt token** (15 minutes). It binds one booking match to one guest email (a keyed hash,
 *   never the address) and to the booking's CARE employee ID. The scan cannot swap any of them.
 *   Its attempt ID is the FacePhys idempotency key.
 */
import { hmacHex, newId, sameSecret, seal, unseal } from './crypto.ts'

export const DEVICE_COOKIE = '__Host-dmk-device'
const DEVICE_PURPOSE = 'dmk-device-v1'
const ATTEMPT_PURPOSE = 'dmk-attempt-v1'
const DEVICE_LIFETIME_MS = 30 * 24 * 3600 * 1000
const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000

export function issueDevice(secret: string, nowMs: number): { value: string; header: string } {
  const value = seal(secret, DEVICE_PURPOSE, { d: newId(), exp: nowMs + DEVICE_LIFETIME_MS })
  return { value, header: `${DEVICE_COOKIE}=${value}; Path=/; Max-Age=${DEVICE_LIFETIME_MS / 1000}; HttpOnly; Secure; SameSite=Strict` }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export function deviceIdFrom(secret: string, cookieHeader: string | null, nowMs: number): string | null {
  const p = unseal(secret, DEVICE_PURPOSE, readCookie(cookieHeader, DEVICE_COOKIE), nowMs)
  return p && typeof p.d === 'string' ? p.d : null
}

export function enrollCodeMatches(expected: string, supplied: unknown): boolean {
  return typeof supplied === 'string' && supplied.length > 0 && supplied.length <= 256 && sameSecret(expected, supplied)
}

export const emailHash = (secret: string, normalizedEmail: string): string => hmacHex(secret, `dmk-email-v1.${normalizedEmail}`)

export interface Attempt { attemptId: string; bookingId: number; emailHash: string; careEmployeeId: number | null }

export function issueAttempt(secret: string, a: Omit<Attempt, 'attemptId'>, nowMs: number): { token: string; attemptId: string } {
  const attemptId = newId()
  return { attemptId, token: seal(secret, ATTEMPT_PURPOSE, { a: attemptId, b: a.bookingId, e: a.emailHash, c: a.careEmployeeId, exp: nowMs + ATTEMPT_LIFETIME_MS }) }
}

export function readAttempt(secret: string, token: string | null, nowMs: number): Attempt | null {
  const p = unseal(secret, ATTEMPT_PURPOSE, token, nowMs)
  if (!p) return null
  const { a, b, e, c } = p
  if (typeof a !== 'string' || typeof b !== 'number' || !Number.isSafeInteger(b) || typeof e !== 'string') return null
  if (c !== null && (typeof c !== 'number' || !Number.isSafeInteger(c))) return null
  return { attemptId: a, bookingId: b, emailHash: e, careEmployeeId: c as number | null }
}
