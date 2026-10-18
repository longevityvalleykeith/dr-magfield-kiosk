/**
 * In-process brakes, not a quota. Each serverless instance keeps its own counts, so these slow a
 * misbehaving tablet down. The hard cap on spend is the FacePhys account balance (403 = refused).
 *
 * - New attempts: at most 30 per device per hour.
 * - Resubmissions of one attempt (same key, so replays rather than new charges): at most 4.
 * - Wrong enrolment codes: at most 10 per minute per instance.
 *
 * The route handlers take a Brakes through Deps, so every test scenario starts with fresh counts.
 */
const HOUR = 3_600_000

export class Brakes {
  newAttempts = new Map<string, number[]>()
  submissions = new Map<string, number>()
  enrollFailures: number[] = []
  dispatched = new Set<string>()
  probes: number[] = []

  /** An attempt whose process request was sent. Unless same-key retry is on, it is never sent again (stop and reconcile). */
  markDispatched(attemptId: string): void { if (this.dispatched.size > 5000) this.dispatched.clear(); this.dispatched.add(attemptId) }
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
}

/** The one set of counts a production instance keeps. */
export const liveBrakes = new Brakes()
