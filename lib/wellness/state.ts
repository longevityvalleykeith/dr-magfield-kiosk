/** Fixed durable protocol. All fields cross a validated SQL boundary; no row-access escape hatch. */
export interface ConsentIntent {
  schemaVersion: 'dmk-consent-v3'
  bookingRef: string
  tenantId: string
  calendeskAccountRef: string
  locationId: number
  serviceLocationId: number | null
  serviceId: number
  serviceTypeId: number | null
  careEmployeeId: number | null
  subjectBinding: 'booking-inbox-code-v1'
  purpose: 'optional-wellness-indicators-cloud-v3'
  noticeVersion: string
  processingDecision: 'agreed'
  emailResultsDecision: 'agreed'
  careCcDecision: 'declined' | 'unavailable'
  guestRecipientRef: string
  careRecipientRef: null
  sourceSurface: 'dmk-kiosk'
  verificationCheckedAt: string
  verificationPolicyVersion: 'dmk-entity-match-v1'
  retentionPolicyVersion: 'dmk-30-days-v1'
}
export type FinalOutcome = 'completed' | 'insufficient_quality' | 'failed' | 'unknown_outcome'
export type StateDelivery = 'sent' | 'failed' | 'not_attempted'
type OwnedCode = { challengeId: string; owner: string }
type OwnedCheck = { attemptId: string; dayRef: string; owner: string }
export type StateCommand =
  | { kind: 'take_code'; challengeId: string; dayRef: string; day: string }
  /** Read-only: may this booking-day still begin a check? Refuses an exhausted booking before consent and camera (K-29); at the cap a hold answers 'pending'. */
  | { kind: 'check_eligibility'; dayRef: string; day: string }
  | ({ kind: 'claim_code'; correct: boolean } & OwnedCode)
  | ({ kind: 'release_code' } & OwnedCode)
  | ({ kind: 'consume_code'; attemptId: string; dayRef: string; day: string } & OwnedCode)
  | ({ kind: 'begin_check'; intent: ConsentIntent } & OwnedCheck)
  | ({ kind: 'authorize_process' } & OwnedCheck)
  | ({ kind: 'release_check' } & OwnedCheck)
  | ({ kind: 'finish_check'; outcome: FinalOutcome; delivery: StateDelivery } & OwnedCheck)
export type StateKind = 'granted' | 'capped' | 'wrong' | 'locked' | 'stale' | 'pending' | 'released' | 'consumed' | 'authorized' | 'finished' | 'invalid' | 'unavailable'
export type StateReply = { kind: StateKind }
export interface StateStore { transition(command: StateCommand): Promise<StateReply> }
export interface StateConfig { url: string; publishableKey: string; jwt: string }
