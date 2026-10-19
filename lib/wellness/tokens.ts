/**
 * Three signed capabilities, all HMAC'd with KIOSK_COOKIE_SECRET:
 *
 * - **Device cookie** (`__Host-dmk-device`: HttpOnly, Secure, SameSite=Strict). Staff set it once
 *   per tablet at /scan/enroll. Without it, no booking is read and no scan is sent. It is never a
 *   NEXT_PUBLIC token: W-4b withdrew the LV kiosk because its device token was inlined into the page.
 * - **Attempt token** (15 minutes). It binds one booking match to one guest email (a keyed hash,
 *   never the address) and to the booking's CARE employee ID. The scan cannot swap any of them.
 *   Its attempt ID is the FacePhys idempotency key.
 * - **Code challenge** (10 minutes). It carries a keyed hash of the 6-digit code emailed to the booking's inbox, never the
 *   code itself, so the page cannot read the code back. Shared durable state stores the opaque challenge ID,
 *   keyed booking-day reference and claim/count metadata. A real and decoy challenge carry the same fields,
 *   and no booking ID. The ready attempt UUID is durably consumed before its signed token is exposed.
 */
import { hmacHex, newCode, newId, sameSecret, seal, unseal } from './crypto.ts'

export const DEVICE_COOKIE = '__Host-dmk-device'
const DEVICE_PURPOSE = 'dmk-device-v1'
const ATTEMPT_PURPOSE = 'dmk-attempt-v1'
const DEVICE_LIFETIME_MS = 30 * 24 * 3600 * 1000
const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000
const CHALLENGE_PURPOSE = 'dmk-challenge-v1'
export const CHALLENGE_LIFETIME_MS = 10 * 60 * 1000

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
export const careEmailHash = (secret: string, normalizedEmail: string): string => hmacHex(secret, `dmk-care-email-v1.${normalizedEmail}`)

export interface Attempt { attemptId: string; bookingId: number; emailHash: string; careEmployeeId: number | null; careEmailHash: string | null }

export function issueAttempt(secret: string, a: Omit<Attempt, 'attemptId'>, nowMs: number): { token: string; attemptId: string } {
  const attemptId = newId()
  return { attemptId, token: seal(secret, ATTEMPT_PURPOSE, { a: attemptId, b: a.bookingId, e: a.emailHash, c: a.careEmployeeId, ch: a.careEmailHash, exp: nowMs + ATTEMPT_LIFETIME_MS }) }
}

export function readAttempt(secret: string, token: string | null, nowMs: number): Attempt | null {
  const p = unseal(secret, ATTEMPT_PURPOSE, token, nowMs)
  if (!p) return null
  const { a, b, e, c, ch } = p
  if (typeof a !== 'string' || typeof b !== 'number' || !Number.isSafeInteger(b) || typeof e !== 'string') return null
  if (c !== null && (typeof c !== 'number' || !Number.isSafeInteger(c))) return null
  if (ch !== null && typeof ch !== 'string') return null
  return { attemptId: a, bookingId: b, emailHash: e, careEmployeeId: c as number | null, careEmailHash: ch as string | null }
}

export interface Challenge { challengeId: string; emailHash: string; codeHash: string; expired: boolean }

const codeHash = (secret: string, challengeId: string, code: string): string => hmacHex(secret, `dmk-code-v1.${challengeId}.${code}`)

/**
 * A challenge, real or decoy, with exactly the same readable fields: its ID, a keyed hash of the email, a keyed hash of
 * the code and its expiry. No booking ID or match flag (T1 #164 RT01). Verify finds the booking again from the email.
 * A decoy hashes a code nobody is told, so it can never verify.
 */
export function issueChallenge(secret: string, matched: boolean, emailHashValue: string, nowMs: number): { token: string; code: string; challengeId: string } {
  const challengeId = newId()
  const code = newCode()
  const h = codeHash(secret, challengeId, matched ? code : `decoy.${newId()}`)
  return { challengeId, code, token: seal(secret, CHALLENGE_PURPOSE, { c: challengeId, e: emailHashValue, h, exp: nowMs + CHALLENGE_LIFETIME_MS }) }
}

/** The signed challenge, with `expired` set rather than refused, so the guest is told it expired and not that it is wrong. */
export function readChallenge(secret: string, token: string | null, nowMs: number): Challenge | null {
  const p = unseal(secret, CHALLENGE_PURPOSE, token, 0)
  if (!p) return null
  const { c, e, h, exp } = p
  if (typeof c !== 'string' || typeof e !== 'string' || typeof h !== 'string' || typeof exp !== 'number') return null
  return { challengeId: c, emailHash: e, codeHash: h, expired: exp <= nowMs }
}

export function codeMatches(secret: string, ch: Challenge, supplied: unknown): boolean {
  return typeof supplied === 'string' && /^\d{6}$/.test(supplied) && sameSecret(codeHash(secret, ch.challengeId, supplied), ch.codeHash)
}
