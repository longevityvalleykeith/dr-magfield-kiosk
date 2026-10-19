import type { ConsentIntent, FinalOutcome, StateCommand, StateDelivery, StateReply, StateStore } from './state.ts'
import { parseStateCommand } from './state-validation.ts'

const MINUTE = 60_000
const DAY = 86_400_000
const OWNER_LIMIT = 64
type DayState = { day: string; codes: number; slots: number; active: string | null }
type Challenge = {
  dayRef: string; day: string; expiresAt: number; wrong: number; owners: Set<string>
  phase: { kind: 'available' } | { kind: 'claimed'; owner: string } | { kind: 'consumed' }
}
type StoredConsent = { intent: Readonly<ConsentIntent>; recordedAt: number; deleteAfter: number }
type Attempt = {
  dayRef: string; day: string; expiresAt: number; owners: Set<string>; consent: StoredConsent | null
  phase: { kind: 'ready' } | { kind: 'preparing' | 'processing'; owner: string }
    | { kind: 'finished' | 'unknown'; owner: string; outcome: FinalOutcome; delivery: StateDelivery }
}
const localDay = (time: number): string => new Date(time + 8 * 60 * MINUTE).toISOString().slice(0, 10)
const reply = (kind: StateReply['kind']): StateReply => ({ kind })

function sameIntent(first: Readonly<ConsentIntent>, next: ConsentIntent): boolean {
  return JSON.stringify({ ...first, verificationCheckedAt: null }) === JSON.stringify({ ...next, verificationCheckedAt: null })
}

/** Synthetic shared store only. Production must explicitly use the durable RPC adapter. */
export class MemoryStateStore implements StateStore {
  private readonly days = new Map<string, DayState>()
  private readonly challenges = new Map<string, Challenge>()
  private readonly attempts = new Map<string, Attempt>()

  private readonly now: () => Date

  constructor(now: () => Date = () => new Date()) { this.now = now }

  transition(command: StateCommand): Promise<StateReply> {
    const parsed = parseStateCommand(command)
    if (!parsed) return Promise.resolve(reply('invalid'))
    try {
      const time = this.now().getTime()
      if (!Number.isFinite(time)) return Promise.resolve(reply('unavailable'))
      // All writes complete synchronously before the returned promise can yield.
      return Promise.resolve(this.apply(parsed, time))
    } catch { return Promise.resolve(reply('unavailable')) }
  }

  private apply(command: StateCommand, time: number): StateReply {
    const today = localDay(time)
    for (const attempt of Array.from(this.attempts.values())) {
      if (attempt.consent && attempt.consent.deleteAfter <= time) attempt.consent = null
    }
    switch (command.kind) {
      case 'take_code': {
        if (command.day !== today) return reply('invalid')
        const existing = this.challenges.get(command.challengeId)
        if (existing) return reply(existing.dayRef === command.dayRef && existing.day === command.day ? 'capped' : 'invalid')
        const day = this.days.get(command.dayRef) ?? { day: command.day, codes: 0, slots: 0, active: null }
        if (day.day !== command.day) return reply('invalid')
        if (day.codes >= 3) return reply('capped')
        this.challenges.set(command.challengeId, { dayRef: command.dayRef, day: command.day, expiresAt: time + 10 * MINUTE, wrong: 0, owners: new Set(), phase: { kind: 'available' } })
        day.codes += 1
        this.days.set(command.dayRef, day)
        return reply('granted')
      }
      case 'claim_code': {
        const challenge = this.challenges.get(command.challengeId)
        if (!challenge || challenge.day !== today || challenge.expiresAt <= time || challenge.wrong >= 5 || challenge.phase.kind !== 'available'
          || challenge.owners.has(command.owner) || challenge.owners.size >= OWNER_LIMIT) return reply('locked')
        if (!command.correct) {
          challenge.wrong += 1
          return reply(challenge.wrong >= 5 ? 'locked' : 'wrong')
        }
        challenge.owners.add(command.owner)
        challenge.phase = { kind: 'claimed', owner: command.owner }
        return reply('granted')
      }
      case 'release_code': {
        const challenge = this.challenges.get(command.challengeId)
        if (!challenge || challenge.phase.kind !== 'claimed' || challenge.phase.owner !== command.owner) return reply('stale')
        challenge.phase = { kind: 'available' }
        return reply('released')
      }
      case 'consume_code': {
        const challenge = this.challenges.get(command.challengeId)
        if (!challenge || challenge.expiresAt <= time || challenge.wrong >= 5 || challenge.phase.kind === 'consumed') return reply('locked')
        if (challenge.phase.kind !== 'claimed' || challenge.phase.owner !== command.owner
          || challenge.dayRef !== command.dayRef || challenge.day !== command.day || command.day !== today) return reply('stale')
        if (this.attempts.has(command.attemptId)) return reply('locked')
        this.attempts.set(command.attemptId, { dayRef: challenge.dayRef, day: challenge.day, expiresAt: time + 15 * MINUTE, owners: new Set(), consent: null, phase: { kind: 'ready' } })
        challenge.phase = { kind: 'consumed' }
        return reply('consumed')
      }
      case 'begin_check': {
        const attempt = this.attempts.get(command.attemptId)
        const day = this.days.get(command.dayRef)
        if (!attempt || !day || attempt.dayRef !== command.dayRef || attempt.day !== today || attempt.expiresAt <= time) return reply('stale')
        if (day.active !== null) return reply('pending')
        if (attempt.phase.kind !== 'ready' || attempt.owners.has(command.owner) || attempt.owners.size >= OWNER_LIMIT) return reply('stale')
        if (attempt.consent && !sameIntent(attempt.consent.intent, command.intent)) return reply('invalid')
        if (day.slots >= 2) return reply('capped')
        const consent = attempt.consent ?? { intent: Object.freeze({ ...command.intent }), recordedAt: time, deleteAfter: time + 30 * DAY }
        attempt.consent = consent
        attempt.owners.add(command.owner)
        attempt.phase = { kind: 'preparing', owner: command.owner }
        day.slots += 1
        day.active = command.attemptId
        return reply('granted')
      }
      case 'authorize_process': {
        const attempt = this.attempts.get(command.attemptId)
        const day = this.days.get(command.dayRef)
        if (!attempt || !day || attempt.dayRef !== command.dayRef || day.active !== command.attemptId
          || attempt.day !== today || attempt.expiresAt <= time || attempt.phase.kind !== 'preparing' || attempt.phase.owner !== command.owner) return reply('stale')
        attempt.phase = { kind: 'processing', owner: command.owner }
        return reply('authorized')
      }
      case 'release_check': {
        const attempt = this.attempts.get(command.attemptId)
        const day = this.days.get(command.dayRef)
        if (!attempt || !day || attempt.dayRef !== command.dayRef || day.active !== command.attemptId
          || attempt.phase.kind !== 'preparing' || attempt.phase.owner !== command.owner) return reply('stale')
        attempt.phase = { kind: 'ready' }
        day.active = null
        day.slots -= 1
        return reply('released')
      }
      case 'finish_check': {
        const attempt = this.attempts.get(command.attemptId)
        const day = this.days.get(command.dayRef)
        if (!attempt || !day || attempt.dayRef !== command.dayRef || attempt.phase.kind === 'ready' || attempt.phase.kind === 'preparing'
          || attempt.phase.owner !== command.owner) return reply('stale')
        if (attempt.phase.kind === 'finished' || attempt.phase.kind === 'unknown') {
          return reply(attempt.phase.outcome === command.outcome && attempt.phase.delivery === command.delivery ? 'finished' : 'stale')
        }
        if (day.active !== command.attemptId) return reply('stale')
        attempt.phase = { kind: command.outcome === 'unknown_outcome' ? 'unknown' : 'finished', owner: command.owner, outcome: command.outcome, delivery: command.delivery }
        if (command.outcome !== 'unknown_outcome') day.active = null
        return reply('finished')
      }
      default: {
        const exhaustive: never = command
        return exhaustive
      }
    }
  }
}
