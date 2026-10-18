/**
 * The minimal consent record (Keith, 10-19: "Minimal consent record as per 2 : defer intent object
 * routing for now"). It holds:
 *   - the consent version;
 *   - the time;
 *   - an opaque attempt ID;
 *   - a keyed hash of the booking ID;
 *   - the outlet;
 *   - whether the guest asked for a CC;
 *   - outcome codes.
 * It never holds video, readings, names or email addresses.
 *
 * Routing into Foundry's existing receipts (Main's lane) is deferred. Until then the record is
 * written in two places:
 *   (1) one structured runtime log line, kept only as long as the host retains logs;
 *   (2) if CONSENT_RECORD_TO is set, a small email of the same fields to that LV mailbox.
 */
import { hmacHex } from './crypto.ts'

export type Outcome = 'completed' | 'insufficient_quality' | 'failed' | 'unknown_outcome' | 'not_submitted'
export type Delivery = 'sent' | 'failed' | 'not_attempted'

export interface ConsentRecord {
  v: 1
  consentVersion: string
  acceptedAt: string
  attemptId: string
  bookingRef: string
  outlet: string
  shared: boolean
  outcome: Outcome
  delivery: Delivery
}

export function consentRecord(secret: string, f: { consentVersion: string; at: Date; attemptId: string; bookingId: number; outlet: string; shared: boolean; outcome: Outcome; delivery: Delivery }): ConsentRecord {
  return {
    v: 1,
    consentVersion: f.consentVersion,
    acceptedAt: f.at.toISOString(),
    attemptId: f.attemptId,
    bookingRef: hmacHex(secret, `dmk-booking-v1.${f.bookingId}`),
    outlet: f.outlet,
    shared: f.shared,
    outcome: f.outcome,
    delivery: f.delivery,
  }
}
