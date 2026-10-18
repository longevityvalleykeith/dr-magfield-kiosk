/**
 * Entity matching: Keith's guardrails, 10-19, checked before the camera opens and again at the
 * point of charge. A booking qualifies only if it is
 *   - at this outlet (KRPM = Calendesk location 6),
 *   - for a wellness service (13 or 14),
 *   - for today in Kuala Lumpur,
 *   - active ("approved" or "done"), and
 *   - booked under the same email the guest typed.
 * The results go only to that email, and the CARE recipient is the booking's own employee.
 */
import type { BookingFacts } from './calendesk.ts'
import type { WellnessConfig } from './config.ts'
import type { RosterEntry } from './roster.ts'

export type MatchReason =
  | 'BOOKING_NOT_FOUND' | 'BOOKING_UNAVAILABLE'
  | 'WRONG_OUTLET' | 'WRONG_SERVICE' | 'NOT_TODAY' | 'BOOKING_NOT_ACTIVE' | 'EMAIL_MISMATCH'

const ACTIVE = new Set(['approved', 'done'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = (s: string): string => s.trim().toLowerCase()
export const isEmail = (s: string): boolean => s.length <= 254 && EMAIL.test(s)

/** YYYY-MM-DD in the outlet's time zone. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** The booking's day, from start_date, or from a local starts_at, or from an offset-bearing starts_at. */
export function bookingDay(b: Pick<BookingFacts, 'startDate' | 'startsAt'>, timeZone: string): string | null {
  if (b.startDate && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) return b.startDate
  if (b.startsAt) {
    const local = /^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}(:\d{2})?$/.exec(b.startsAt)
    if (local) return local[1]
    const t = Date.parse(b.startsAt)
    if (Number.isFinite(t)) return localDay(new Date(t), timeZone)
  }
  return null
}

export interface MatchInput {
  booking: BookingFacts
  typedEmail: string
  outlet: WellnessConfig['outlet']
  roster: RosterEntry[]
  now: Date
}

export type MatchResult = { ok: true } | { ok: false; reasons: MatchReason[] }

export function matchBooking(i: MatchInput): MatchResult {
  const reasons: MatchReason[] = []
  if (i.booking.locationId !== i.outlet.locationId) reasons.push('WRONG_OUTLET')
  if (i.booking.serviceId === null || !i.outlet.serviceIds.includes(i.booking.serviceId)) reasons.push('WRONG_SERVICE')
  if (bookingDay(i.booking, i.outlet.timeZone) !== localDay(i.now, i.outlet.timeZone)) reasons.push('NOT_TODAY')
  if (!ACTIVE.has(i.booking.status)) reasons.push('BOOKING_NOT_ACTIVE')
  if (!i.booking.customerEmail || i.booking.customerEmail !== normalizeEmail(i.typedEmail)) reasons.push('EMAIL_MISMATCH')
  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true }
}
