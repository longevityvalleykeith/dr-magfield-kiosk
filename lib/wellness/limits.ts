/**
 * In-process brakes, not a quota. Each serverless instance keeps its own counts, so these slow a
 * misbehaving tablet down. The hard cap on spend is the FacePhys account balance (403 = refused).
 *
 * - New attempts: at most 30 per device per hour.
 * - Resubmissions of one attempt (same key, so replays rather than new charges): at most 4.
 * - Wrong enrolment codes: at most 10 per minute per instance.
 */
const HOUR = 3_600_000
const newAttempts = new Map<string, number[]>()
const submissions = new Map<string, number>()
let enrollFailures: number[] = []
const dispatched = new Set<string>()

/** An attempt whose process request was sent. Unless same-key retry is on, it is never sent again (stop and reconcile). */
export function markDispatched(attemptId: string): void { if (dispatched.size > 5000) dispatched.clear(); dispatched.add(attemptId) }
export function wasDispatched(attemptId: string): boolean { return dispatched.has(attemptId) }

export function allowSubmission(deviceId: string, attemptId: string, nowMs: number): boolean {
  const n = submissions.get(attemptId) ?? 0
  if (n >= 4) return false
  if (n === 0) {
    const recent = (newAttempts.get(deviceId) ?? []).filter((t) => nowMs - t < HOUR)
    if (recent.length >= 30) return false
    recent.push(nowMs)
    newAttempts.set(deviceId, recent)
  }
  if (submissions.size > 5000) submissions.clear()
  submissions.set(attemptId, n + 1)
  return true
}

export function enrollBudgetLeft(nowMs: number): boolean {
  enrollFailures = enrollFailures.filter((t) => nowMs - t < 60_000)
  return enrollFailures.length < 10
}

export function noteEnrollFailure(nowMs: number): void { enrollFailures.push(nowMs) }

let probes: number[] = []
/** The free preflight is public in open mode: at most 10 per minute per instance. */
export function probeBudgetLeft(nowMs: number): boolean {
  probes = probes.filter((t) => nowMs - t < 60_000)
  if (probes.length >= 10) return false
  probes.push(nowMs)
  return true
}
