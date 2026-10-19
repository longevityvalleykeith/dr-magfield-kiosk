/**
 * Minimal durable consent intent, committed with begin_check before the first FacePhys call.
 * The database owns recorded/deletion timestamps and the fixed 30-day retention period.
 * No raw booking ID, email, reading, video, provider payload or signed URL enters this object.
 * Inbox-code control does not identify the face. Provider/mail acknowledgement does not prove delivery.
 */
import { hmacHex } from './crypto.ts'
import type { BookingFacts } from './calendesk.ts'
import type { ConsentIntent, FinalOutcome, StateDelivery } from './state.ts'

export type Outcome = FinalOutcome
export type Delivery = StateDelivery
export type CcDecision = ConsentIntent['careCcDecision']

export interface RecordInput {
  tenantId: string
  calendeskAccountRef: string
  outletSlug: string
  booking: BookingFacts
  noticeVersion: string
  careCcDecision: CcDecision
  guestEmail: string
  verifiedAt: Date
}

const positive = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n > 0

/** Missing mandatory Calendesk context prevents admission rather than inventing an ID. */
export function consentIntent(secret: string, f: RecordInput): ConsentIntent | null {
  if (!positive(f.booking.locationId) || !positive(f.booking.serviceId)) return null
  for (const n of [f.booking.serviceLocationId, f.booking.serviceTypeId, f.booking.employeeId]) {
    if (n !== null && !positive(n)) return null
  }
  return {
    schemaVersion: 'dmk-consent-v3',
    bookingRef: hmacHex(secret, `dmk-booking-v1.${JSON.stringify([f.tenantId, f.outletSlug, f.booking.id])}`),
    tenantId: f.tenantId,
    calendeskAccountRef: hmacHex(secret, `dmk-account-v1.${f.calendeskAccountRef}`),
    locationId: f.booking.locationId,
    serviceLocationId: f.booking.serviceLocationId,
    serviceId: f.booking.serviceId,
    serviceTypeId: f.booking.serviceTypeId,
    careEmployeeId: f.booking.employeeId,
    subjectBinding: 'booking-inbox-code-v1',
    purpose: 'optional-wellness-indicators-cloud-v3',
    noticeVersion: f.noticeVersion,
    processingDecision: 'agreed',
    emailResultsDecision: 'agreed',
    careCcDecision: f.careCcDecision,
    guestRecipientRef: hmacHex(secret, `dmk-recipient-v1.${f.guestEmail}`),
    careRecipientRef: null,
    sourceSurface: 'dmk-kiosk',
    verificationCheckedAt: f.verifiedAt.toISOString(),
    verificationPolicyVersion: 'dmk-entity-match-v1',
    retentionPolicyVersion: 'dmk-30-days-v1',
  }
}
