/**
 * In-process brakes, not a quota. Each serverless instance keeps its own counts, so these slow a
 * misbehaving tablet down. The hard cap on spend is the FacePhys account balance (403 = refused).
 *
 * - New attempts: at most 30 per device per hour.
 * - Resubmissions of one attempt (same key, so replays rather than new charges): at most 4.
 * - Wrong enrolment codes: at most 10 per minute per instance.
 * - Charged checks per booking: at most 2 a day (a retry after a poor reading, never a third).
 *   Counted when the process request first goes out for an attempt.
 * - Booking lookups: at most 60 Calendesk reads a minute, and at most 10 refused lookups per client
 *   in 10 minutes. Both are checked before Calendesk is read, so LV's shared tenant is protected.
 *
 * The route handlers take a Brakes through Deps, so every test scenario starts with fresh counts.
 */
const HOUR = 3_600_000
const MINUTE = 60_000
export const CHECKS_PER_BOOKING_PER_DAY = 2
const LOOKUPS_PER_MINUTE = 60
const REFUSED_LOOKUPS_PER_CLIENT = 10
const REFUSED_WINDOW_MS = 10 * MINUTE

export class Brakes {
  newAttempts = new Map<string, number[]>()
  submissions = new Map<string, number>()
  enrollFailures: number[] = []
  dispatched = new Set<string>()
  probes: number[] = []
  bookingChecks = new Map<string, number>()
  lookups: number[] = []
  refusedLookups = new Map<string, number[]>()

  /** An attempt whose process request was sent. Unless same-key retry is on, it is never sent again (stop and reconcile). */
  markDispatched(attemptId: string, bookingDayKey: string): void {
    if (this.dispatched.has(attemptId)) return
    if (this.dispatched.size > 5000) this.dispatched.clear()
    this.dispatched.add(attemptId)
    if (this.bookingChecks.size > 5000) this.bookingChecks.clear()
    this.bookingChecks.set(bookingDayKey, (this.bookingChecks.get(bookingDayKey) ?? 0) + 1)
  }
  /** False once this booking has had its charged checks today (key = booking ID + outlet-local day). */
  bookingChecksLeft(bookingDayKey: string): boolean { return (this.bookingChecks.get(bookingDayKey) ?? 0) < CHECKS_PER_BOOKING_PER_DAY }
  wasDispatched(attemptId: string): boolean { return this.dispatched.has(attemptId) }

  allowSubmission(deviceId: string, attemptId: string, nowMs: number): boolean {
    const n = this.submissions.get(attemptId) ?? 0
    if (n >= 4) return false
    if (n === 0) {
      const recent = (this.newAttempts.get(deviceId) ?? []).filter((t) => nowMs - t < HOUR)
      if (recent.length >= 30) return false
      recent.push(nowMs)
      this.newAttempts.set(deviceId, recent)
    }
    if (this.submissions.size > 5000) this.submissions.clear()
    this.submissions.set(attemptId, n + 1)
    return true
  }

  enrollBudgetLeft(nowMs: number): boolean {
    this.enrollFailures = this.enrollFailures.filter((t) => nowMs - t < 60_000)
    return this.enrollFailures.length < 10
  }

  noteEnrollFailure(nowMs: number): void { this.enrollFailures.push(nowMs) }

  /** The free preflight is public in open mode: at most 10 per minute per instance. */
  probeBudgetLeft(nowMs: number): boolean {
    this.probes = this.probes.filter((t) => nowMs - t < 60_000)
    if (this.probes.length >= 10) return false
    this.probes.push(nowMs)
    return true
  }

  /** Before a Calendesk booking read: the instance-wide read rate, then this client's recent refusals. Records the read. */
  lookupBudgetLeft(client: string, nowMs: number): boolean {
    this.lookups = this.lookups.filter((t) => nowMs - t < MINUTE)
    if (this.lookups.length >= LOOKUPS_PER_MINUTE) return false
    const refused = (this.refusedLookups.get(client) ?? []).filter((t) => nowMs - t < REFUSED_WINDOW_MS)
    if (refused.length >= REFUSED_LOOKUPS_PER_CLIENT) return false
    this.lookups.push(nowMs)
    return true
  }

  noteRefusedLookup(client: string, nowMs: number): void {
    if (this.refusedLookups.size > 5000) this.refusedLookups.clear()
    this.refusedLookups.set(client, [...(this.refusedLookups.get(client) ?? []).filter((t) => nowMs - t < REFUSED_WINDOW_MS), nowMs])
  }
}

/** The one set of counts a production instance keeps. */
export const liveBrakes = new Brakes()
