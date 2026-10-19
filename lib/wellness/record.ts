/**
 * The minimal consent record. Keith, 10-19: "Minimal consent record as per 2 : defer intent object
 * routing for now", clarified as "minimal consent evidence must include key Calendesk context,
 * explicitly location and CARE employee ID". The fields follow T1 #164 CALENDESK-CONSENT-FIELDS
 * (cc4e7f5e), plus the sent/failed codes from the option Keith chose.
 *
 * Never in the record: video, readings, names, email addresses (only keyed recipient bindings),
 * raw booking payloads, signed URLs or secrets.
 *
 * Subject assurance is stated honestly. The guest entered the code emailed to the booking's inbox
 * ("booking-inbox-code"). That proves control of that inbox, not that the scanned face is the
 * booking holder: nothing remote can prove who a person is.
 *
 * Routing into Foundry's receipts is deferred. The record is one runtime log line, plus an email to
 * CONSENT_RECORD_TO when that is set. Its retention rule stays "unset" until Keith sets
 * CONSENT_RETENTION_POLICY.
 */
import { hmacHex, newId } from './crypto.ts'
import type { BookingFacts } from './calendesk.ts'
import type { RosterEntry } from './roster.ts'

export type Outcome = 'completed' | 'insufficient_quality' | 'failed' | 'unknown_outcome' | 'not_submitted'
export type Delivery = 'sent' | 'failed' | 'not_attempted'
export type CcDecision = 'agreed' | 'declined' | 'unavailable'

export interface ConsentRecord {
  schemaVersion: 'dmk-consent-v2'
  consentRecordId: string
  attemptId: string
  tenantId: string
  calendeskAccountRef: string
  bookingId: number
  locationId: number | null
  serviceLocationId: number | null
  serviceId: number | null
  serviceTypeId: number | null
  careEmployeeId: number | null
  subjectBinding: 'booking-inbox-code-v1'
  purpose: 'optional-wellness-indicators-cloud-v3'
  noticeVersion: string
  processingDecision: 'agreed'
  careCcDecision: CcDecision
  guestRecipientRef: string
  careRecipientRef: string | null
  recordedAt: string
  sourceSurface: 'dmk-kiosk'
  verificationCheckedAt: string
  verificationPolicyVersion: 'dmk-entity-match-v1'
  retentionPolicyVersion: string
  deleteAfter: string | null
  outcome: Outcome
  delivery: Delivery
}

export interface RecordInput {
  attemptId: string
  tenantId: string
  calendeskAccountRef: string
  booking: BookingFacts
  noticeVersion: string
  careCcDecision: CcDecision
  guestEmail: string
  care: RosterEntry | null
  verifiedAt: Date
  recordedAt: Date
  retention: { policyVersion: string; days: number | null }
  outcome: Outcome
  delivery: Delivery
}

export function consentRecord(secret: string, f: RecordInput): ConsentRecord {
  return {
    schemaVersion: 'dmk-consent-v2',
    consentRecordId: newId(),
    attemptId: f.attemptId,
    tenantId: f.tenantId,
    calendeskAccountRef: f.calendeskAccountRef,
    bookingId: f.booking.id,
    locationId: f.booking.locationId,
    serviceLocationId: f.booking.serviceLocationId,
    serviceId: f.booking.serviceId,
    serviceTypeId: f.booking.serviceTypeId,
    // Booking context: kept even when the CC is declined. It is not a disclosure grant.
    careEmployeeId: f.booking.employeeId,
    subjectBinding: 'booking-inbox-code-v1',
    purpose: 'optional-wellness-indicators-cloud-v3',
    noticeVersion: f.noticeVersion,
    processingDecision: 'agreed',
    careCcDecision: f.careCcDecision,
    // Keyed bindings to the exact destinations shown, never plaintext or an unsalted hash.
    guestRecipientRef: hmacHex(secret, `dmk-recipient-v1.${f.guestEmail}`),
    careRecipientRef: f.care && f.careCcDecision === 'agreed' ? hmacHex(secret, `dmk-care-recipient-v1.${f.care.calendeskEmployeeId}.${f.care.email}`) : null,
    recordedAt: f.recordedAt.toISOString(),
    sourceSurface: 'dmk-kiosk',
    verificationCheckedAt: f.verifiedAt.toISOString(),
    verificationPolicyVersion: 'dmk-entity-match-v1',
    retentionPolicyVersion: f.retention.policyVersion,
    deleteAfter: f.retention.days ? new Date(f.recordedAt.getTime() + f.retention.days * 86_400_000).toISOString() : null,
    outcome: f.outcome,
    delivery: f.delivery,
  }
}
