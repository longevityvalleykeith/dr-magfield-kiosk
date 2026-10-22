import type { ConsentIntent, StateCommand, StateKind, StateReply } from './state.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HMAC = /^[0-9a-f]{64}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return typeof key === 'string' && descriptor !== undefined && 'value' in descriptor
    })
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && keys.includes(key) && descriptor !== undefined && 'value' in descriptor
  })
}

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const isRef = (value: unknown): value is string => typeof value === 'string' && HMAC.test(value)
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isNullableId = (value: unknown): value is number | null => value === null || isId(value)
const isTimestamp = (value: unknown): value is string => typeof value === 'string' && ISO.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && isTimestamp(`${value}T00:00:00.000Z`)

const INTENT_KEYS = [
  'schemaVersion', 'bookingRef', 'tenantId', 'calendeskAccountRef', 'locationId', 'serviceLocationId',
  'serviceId', 'serviceTypeId', 'careEmployeeId', 'subjectBinding', 'purpose', 'noticeVersion',
  'processingDecision', 'emailResultsDecision', 'careCcDecision', 'guestRecipientRef', 'careRecipientRef',
  'sourceSurface', 'verificationCheckedAt', 'verificationPolicyVersion', 'retentionPolicyVersion',
]

function parseIntent(value: unknown): ConsentIntent | null {
  if (!isRecord(value) || !exactKeys(value, INTENT_KEYS)
    || value.schemaVersion !== 'dmk-consent-v3' || !isRef(value.bookingRef)
    || typeof value.tenantId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.tenantId) || value.tenantId.length > 64
    || !isRef(value.calendeskAccountRef) || !isId(value.locationId) || !isNullableId(value.serviceLocationId)
    || !isId(value.serviceId) || !isNullableId(value.serviceTypeId) || !isNullableId(value.careEmployeeId)
    || value.subjectBinding !== 'booking-inbox-code-v1' || value.purpose !== 'optional-wellness-indicators-cloud-v3'
    || value.noticeVersion !== 'dmk-cloud-v3-2026-10-19' || value.processingDecision !== 'agreed'
    || value.emailResultsDecision !== 'agreed' || (value.careCcDecision !== 'declined' && value.careCcDecision !== 'unavailable')
    || !isRef(value.guestRecipientRef) || value.careRecipientRef !== null || value.sourceSurface !== 'dmk-kiosk'
    || !isTimestamp(value.verificationCheckedAt) || value.verificationPolicyVersion !== 'dmk-entity-match-v1'
    || value.retentionPolicyVersion !== 'dmk-30-days-v1') return null
  return {
    schemaVersion: value.schemaVersion, bookingRef: value.bookingRef, tenantId: value.tenantId,
    calendeskAccountRef: value.calendeskAccountRef, locationId: value.locationId,
    serviceLocationId: value.serviceLocationId, serviceId: value.serviceId, serviceTypeId: value.serviceTypeId,
    careEmployeeId: value.careEmployeeId, subjectBinding: value.subjectBinding, purpose: value.purpose,
    noticeVersion: value.noticeVersion, processingDecision: value.processingDecision,
    emailResultsDecision: value.emailResultsDecision, careCcDecision: value.careCcDecision,
    guestRecipientRef: value.guestRecipientRef, careRecipientRef: value.careRecipientRef,
    sourceSurface: value.sourceSurface, verificationCheckedAt: value.verificationCheckedAt,
    verificationPolicyVersion: value.verificationPolicyVersion, retentionPolicyVersion: value.retentionPolicyVersion,
  }
}

/** Parse and copy only the fixed protocol. Getters, symbols and additional keys are refused. */
export function parseStateCommand(value: unknown): StateCommand | null {
  try {
    if (!isRecord(value)) return null
    switch (value.kind) {
      case 'take_code':
        return exactKeys(value, ['kind', 'challengeId', 'dayRef', 'day']) && isUuid(value.challengeId) && isRef(value.dayRef) && isDay(value.day)
          ? { kind: value.kind, challengeId: value.challengeId, dayRef: value.dayRef, day: value.day } : null
      case 'check_eligibility':
        return exactKeys(value, ['kind', 'dayRef', 'day']) && isRef(value.dayRef) && isDay(value.day)
          ? { kind: value.kind, dayRef: value.dayRef, day: value.day } : null
      case 'claim_code':
        return exactKeys(value, ['kind', 'challengeId', 'owner', 'correct']) && isUuid(value.challengeId) && isUuid(value.owner) && typeof value.correct === 'boolean'
          ? { kind: value.kind, challengeId: value.challengeId, owner: value.owner, correct: value.correct } : null
      case 'release_code':
        return exactKeys(value, ['kind', 'challengeId', 'owner']) && isUuid(value.challengeId) && isUuid(value.owner)
          ? { kind: value.kind, challengeId: value.challengeId, owner: value.owner } : null
      case 'consume_code':
        return exactKeys(value, ['kind', 'challengeId', 'owner', 'attemptId', 'dayRef', 'day'])
          && isUuid(value.challengeId) && isUuid(value.owner) && isUuid(value.attemptId) && isRef(value.dayRef) && isDay(value.day)
          ? { kind: value.kind, challengeId: value.challengeId, owner: value.owner, attemptId: value.attemptId, dayRef: value.dayRef, day: value.day } : null
      case 'begin_check': {
        const intent = parseIntent(value.intent)
        return exactKeys(value, ['kind', 'attemptId', 'dayRef', 'owner', 'intent']) && isUuid(value.attemptId) && isRef(value.dayRef) && isUuid(value.owner) && intent
          ? { kind: value.kind, attemptId: value.attemptId, dayRef: value.dayRef, owner: value.owner, intent } : null
      }
      case 'authorize_process':
      case 'release_check':
        return exactKeys(value, ['kind', 'attemptId', 'dayRef', 'owner']) && isUuid(value.attemptId) && isRef(value.dayRef) && isUuid(value.owner)
          ? { kind: value.kind, attemptId: value.attemptId, dayRef: value.dayRef, owner: value.owner } : null
      case 'finish_check':
        return exactKeys(value, ['kind', 'attemptId', 'dayRef', 'owner', 'outcome', 'delivery'])
          && isUuid(value.attemptId) && isRef(value.dayRef) && isUuid(value.owner)
          && (value.outcome === 'completed' || value.outcome === 'insufficient_quality' || value.outcome === 'failed' || value.outcome === 'unknown_outcome')
          && (value.delivery === 'sent' || value.delivery === 'failed' || value.delivery === 'not_attempted')
          ? { kind: value.kind, attemptId: value.attemptId, dayRef: value.dayRef, owner: value.owner, outcome: value.outcome, delivery: value.delivery } : null
      default: return null
    }
  } catch { return null }
}

const REPLIES: Record<StateCommand['kind'], readonly StateKind[]> = {
  take_code: ['granted', 'capped'], check_eligibility: ['granted', 'capped'], claim_code: ['granted', 'wrong', 'locked'],
  release_code: ['released', 'stale'], consume_code: ['consumed', 'locked', 'stale'],
  begin_check: ['granted', 'capped', 'pending', 'stale'], authorize_process: ['authorized', 'stale'],
  release_check: ['released', 'stale'], finish_check: ['finished', 'stale'],
}

function isStateKind(value: unknown): value is StateKind {
  return typeof value === 'string' && (value === 'invalid' || value === 'unavailable'
    || Object.values(REPLIES).some((kinds) => kinds.some((kind) => kind === value)))
}

export function parseStateReply(command: StateCommand['kind'], value: unknown): StateReply | null {
  try {
    if (!isRecord(value) || !exactKeys(value, ['kind']) || !isStateKind(value.kind)) return null
    return value.kind === 'invalid' || value.kind === 'unavailable' || REPLIES[command].includes(value.kind)
      ? { kind: value.kind } : null
  } catch { return null }
}
