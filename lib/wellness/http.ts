/**
 * Request handlers for the source proposal. Durable state alone owns code issuance, code use,
 * check caps and process permission. In-process brakes only limit local traffic.
 * No raw booking ID, email, reading, video or signed URL is written to records or logs.
 */
import { readConfig, isReady } from './config.ts'
import type { Env, WellnessConfig } from './config.ts'
import { calendeskReachable, listDayBookings, readBooking } from './calendesk.ts'
import type { BookingFacts } from './calendesk.ts'
import { matchBooking, normalizeEmail, isEmail, localDay, bookingDay } from './match.ts'
import type { MatchReason } from './match.ts'
import { authTest, presignPreflight, submitVideo } from './facephys.ts'
import { keyPaths, normalizeResult } from './result.ts'
import { composeCodeEmail, composeResultEmail, sendEmail } from './email.ts'
import { consentIntent } from './record.ts'
import type { Delivery, Outcome } from './record.ts'
import { codeMatches, deviceIdFrom, emailHash, enrollCodeMatches, issueAttempt, issueChallenge, issueDevice, readAttempt, readChallenge } from './tokens.ts'
import { liveBrakes } from './limits.ts'
import type { Brakes } from './limits.ts'
import { hmacHex, newId, sha256Hex } from './crypto.ts'
import { CONSENT_VERSION } from './consent.ts'
import { makeRpcStateStore } from './state-rpc.ts'
import type { StateCommand, StateReply, StateStore } from './state.ts'

export interface Deps {
  env: Env
  fetch: typeof fetch
  now: () => Date
  log: (event: string, fields: Record<string, unknown>) => void
  /** Explicit shared synthetic store. Production resolves admitted RPC configuration, never memory. */
  state?: StateStore
  brakes?: Brakes
  wait?: (ms: number) => Promise<void>
}

const brakesOf = (deps: Deps): Brakes => deps.brakes ?? liveBrakes
const unavailableState: StateStore = { transition: async () => ({ kind: 'unavailable' }) }

/** A missing ACK or thrown transport error never supplies permission, including in synthetic stores. */
async function transition(state: StateStore, command: StateCommand): Promise<StateReply> {
  try { return await state.transition(command) } catch { return { kind: 'unavailable' } }
}

const MIN_VIDEO = 1024
const MAX_VIDEO = 4_200_000
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const refuse = (status: number, code: string): Response => json(status, { status: 'refused', code })
const unknownOutcome = (attemptId: string): Response =>
  json(202, { status: 'unknown_outcome', retryable: false, reference: attemptId.slice(0, 8) })

async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  let body: unknown
  try { body = await req.json() } catch { return null }
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

/** An ISO-BMFF file ("ftyp" at byte 4): the only container FacePhys accepts (video/mp4). */
export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
}

export function mask(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : '•••'
}

type Gate = { config: WellnessConfig; deviceId: string; secret: string; state: StateStore }

function gate(req: Request, deps: Deps): Gate | Response {
  const config = readConfig(deps.env, deps.now())
  if (!isReady(config, deps.state !== undefined) || !config.device) return refuse(503, 'CHECK_DISABLED')
  const secret = config.device.cookieSecret
  const state = deps.state ?? (config.state ? makeRpcStateStore(config.state, deps.fetch, deps.now) : unavailableState)
  if (config.device.enrollCode === null) return { config, deviceId: 'open', secret, state }
  const deviceId = deviceIdFrom(secret, req.headers.get('cookie'), deps.now().getTime())
  if (!deviceId) return refuse(401, 'DEVICE_NOT_ENROLLED')
  return { config, deviceId, secret, state }
}

export async function handleEnroll(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env, deps.now())
  if (!config.device) return refuse(503, 'CHECK_DISABLED')
  if (config.device.enrollCode === null) return json(200, { status: 'enrolment_not_required' })
  const now = deps.now().getTime()
  if (!brakesOf(deps).enrollBudgetLeft(now)) return refuse(429, 'TOO_MANY_ATTEMPTS')
  const input = await readObject(req)
  if (!enrollCodeMatches(config.device.enrollCode, input?.code)) {
    brakesOf(deps).noteEnrollFailure(now)
    deps.log('enroll_refused', {})
    return refuse(401, 'ENROLL_CODE_WRONG')
  }
  deps.log('device_enrolled', {})
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': issueDevice(config.device.cookieSecret, now).header } })
}

/** The client address Vercel's edge sets (x-real-ip), else the first x-forwarded-for hop. Used only as a brake key, never logged. */
function clientOf(req: Request): string {
  return req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/** Opaque booking-day authority: one signing key must be shared by every worker for the entire day. */
const bookingDayRef = (secret: string, config: WellnessConfig, bookingId: number, day: string): string =>
  hmacHex(secret, `dmk-day-v1.${JSON.stringify([config.tenantId, config.outlet.slug, bookingId, day])}`)


/** Every lookup answers after the same time, matched or not, so its timing says nothing about who is booked. */
export const LOOKUP_REPLY_MS = 2_500
export const VERIFY_WRONG_REPLY_MS = 2_500
/**
 * Verification's spare time above its serial worst case (claim, the list pages, the parallel detail reads,
 * eligibility, then consume or release), for overhead and the reply. The route's maxDuration covers both (K12-03).
 */
export const VERIFY_HEADROOM_MS = 5_000
const DAY_LIST_TTL_MS = 30_000

/**
 * The typed email's booking today at this outlet. Earliest start wins.
 * - Today's list (day filters only, as Foundry's production reader calls it) is kept 30 s per instance.
 * - Active rows with the typed email are candidates only. Each distinct ID is read in full, at most 25, in parallel.
 *   Only the fresh detail can authorize an email. A list location cannot authorize or reject a candidate.
 * - The refusal keeps the reasons of the typed email's own rows, so a miss is self-diagnosing.
 */
async function findBooking(config: WellnessConfig, email: string, now: Date, deps: Deps): Promise<{ kind: 'match'; booking: BookingFacts } | { kind: 'none'; reasons: MatchReason[]; booking: BookingFacts | null } | { kind: 'unavailable' }> {
  const check = (b: BookingFacts) => matchBooking({ booking: b, typedEmail: email, outlet: config.outlet, roster: config.roster, now })
  const day = localDay(now, config.outlet.timeZone)
  const brakes = brakesOf(deps)
  const fresh = (): Promise<BookingFacts[] | null> => listDayBookings(config.calendesk!, day, deps.fetch, (n, keys) => deps.log('booking_list_shape', { rows: n, keys }))
  const cached = brakes.dayList && brakes.dayList.day === day && now.getTime() - brakes.dayList.at < DAY_LIST_TTL_MS ? (brakes.dayList.rows as BookingFacts[]) : null
  // A cached list that can't place this email may predate the booking (made seconds ago), so it is read again.
  const usable = cached && cached.some((b) => b.customerEmail === email) ? cached : null
  const rows = usable ?? await fresh()
  if (rows === null) return { kind: 'unavailable' }
  if (!usable) brakes.dayList = { day, at: now.getTime(), rows }
  const byStart = [...rows].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
  const mine = byStart.filter((b) => b.customerEmail === email)
  const candidates = new Map<number, BookingFacts>()
  for (const row of mine) {
    if ((row.status === 'approved' || row.status === 'done') && !candidates.has(row.id)) candidates.set(row.id, row)
  }
  if (candidates.size > 25) return { kind: 'unavailable' }
  const reads = await Promise.all(Array.from(candidates.keys()).map((id) => readBooking(config.calendesk!, id, deps.fetch)))
  if (reads.some((r) => !r.ok && r.reason === 'BOOKING_UNAVAILABLE')) return { kind: 'unavailable' }
  const full = reads.flatMap((r) => (r.ok ? [r.booking] : []))
  for (const b of full) if (check(b).ok) return { kind: 'match', booking: b }
  const seen = [...full, ...mine.filter((b) => b.status !== 'approved' && b.status !== 'done')]
  if (seen.length === 0) return { kind: 'none', reasons: ['BOOKING_NOT_FOUND'], booking: null }
  const first = check(seen[0])
  return { kind: 'none', reasons: first.ok ? ['BOOKING_NOT_FOUND'] : first.reasons, booking: seen[0] }
}

/** Matched and decoy lookups keep the same public shape and fixed reply time. */
export async function handleBooking(req: Request, deps: Deps): Promise<Response> {
  const g = gate(req, deps)
  if (g instanceof Response) return g
  const { config, secret, state } = g
  const input = await readObject(req)
  const email = typeof input?.email === 'string' ? normalizeEmail(input.email) : ''
  if (!isEmail(email)) return refuse(400, 'BOOKING_INPUT_INVALID')

  const client = clientOf(req)
  if (!brakesOf(deps).lookupBudgetLeft(client, deps.now().getTime())) {
    deps.log('booking_lookup_braked', {})
    return refuse(429, 'TOO_MANY_LOOKUPS')
  }
  const now = deps.now()
  const started = now.getTime()
  const found = await findBooking(config, email, now, deps)
  if (found.kind === 'unavailable') {
    deps.log('booking_unavailable', {})
    return refuse(503, 'BOOKING_UNAVAILABLE')
  }
  let challenge = issueChallenge(secret, false, emailHash(secret, email), now.getTime())
  if (found.kind === 'none') {
    const b = found.booking
    deps.log('booking_refused', { reasons: found.reasons, locationId: b?.locationId ?? null, serviceLocationId: b?.serviceLocationId ?? null, serviceId: b?.serviceId ?? null })
    brakesOf(deps).noteRefusedLookup(client, now.getTime())
  } else {
    const day = bookingDay(found.booking, config.outlet.timeZone)
    if (day !== null) {
      const candidate = issueChallenge(secret, true, emailHash(secret, email), now.getTime())
      const taken = await transition(state, { kind: 'take_code', challengeId: candidate.challengeId, dayRef: bookingDayRef(secret, config, found.booking.id, day), day })
      if (taken.kind === 'granted') {
        challenge = candidate
        const delivery = await sendEmail(config.mail!, { to: found.booking.customerEmail!, cc: null, ...composeCodeEmail(challenge.code, config.outlet.name) }, `code-${challenge.challengeId}`, deps.fetch)
        deps.log(delivery === 'sent' ? 'code_sent' : 'code_mail_failed', {})
      } else {
        // No registered challenge or mail after a missing grant. The decoy response still hides the match.
        deps.log(taken.kind === 'capped' ? 'code_capped' : 'code_state_unavailable', {})
      }
    }
  }
  await (deps.wait ?? sleep)(Math.max(0, LOOKUP_REPLY_MS - (deps.now().getTime() - started)))
  return json(200, { status: 'code_sent', challengeToken: challenge.token, maskedEmail: mask(email) })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Claim before the fresh booking read; consume the UUID before exposing an attempt token. */
export async function handleVerify(req: Request, deps: Deps): Promise<Response> {
  const g = gate(req, deps)
  if (g instanceof Response) return g
  const { config, secret, state } = g
  const input = await readObject(req)
  if (!input) return refuse(400, 'CODE_WRONG')
  const now = deps.now()
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : ''
  const ch = readChallenge(secret, typeof input.challengeToken === 'string' ? input.challengeToken : null, now.getTime())
  if (!ch || !isEmail(email) || emailHash(secret, email) !== ch.emailHash) return refuse(400, 'ATTEMPT_INVALID')
  if (ch.expired) return refuse(400, 'CODE_EXPIRED')
  const owner = newId()
  const correct = codeMatches(secret, ch, input.code)
  const claimed = await transition(state, { kind: 'claim_code', challengeId: ch.challengeId, owner, correct })
  if (!correct) {
    // Registered, decoy, consumed and locked challenges have one public wrong-code response.
    // The shared store still counts/locks guesses; possessing a signed decoy must not reveal a booking.
    await (deps.wait ?? sleep)(Math.max(0, VERIFY_WRONG_REPLY_MS - (deps.now().getTime() - now.getTime())))
    return refuse(400, 'CODE_WRONG')
  }
  if (claimed.kind !== 'granted') {
    if (claimed.kind === 'locked' || claimed.kind === 'stale') return refuse(429, 'CODE_LOCKED')
    return refuse(503, 'STATE_UNAVAILABLE')
  }
  const found = await findBooking(config, email, now, deps)
  if (found.kind === 'unavailable') {
    const released = await transition(state, { kind: 'release_code', challengeId: ch.challengeId, owner })
    return refuse(503, released.kind === 'released' ? 'BOOKING_UNAVAILABLE' : 'STATE_UNAVAILABLE')
  }
  if (found.kind === 'none') {
    deps.log('booking_changed', { reasons: found.reasons })
    return refuse(409, 'BOOKING_CHANGED')
  }
  const day = bookingDay(found.booking, config.outlet.timeZone)
  if (day === null) return refuse(409, 'BOOKING_CHANGED')
  const dayRef = bookingDayRef(secret, config, found.booking.id, day)
  // K-29: an exhausted booking is refused here, before consent and camera, by a read-only check. The code goes back
  // to its owner untouched. begin_check's atomic cap stays the race barrier (K-30).
  // Verification intentionally does not refuse an active day hold (RT04); begin_check alone owns that admission.
  const eligible = await transition(state, { kind: 'check_eligibility', dayRef, day })
  if (eligible.kind !== 'granted') {
    await transition(state, { kind: 'release_code', challengeId: ch.challengeId, owner })
    if (eligible.kind === 'capped') return refuse(409, 'BOOKING_ALREADY_CHECKED')
    return refuse(503, 'STATE_UNAVAILABLE')
  }
  const issued = issueAttempt(secret, {
    bookingId: found.booking.id, emailHash: emailHash(secret, email), careEmployeeId: null, careEmailHash: null,
  }, now.getTime())
  const consumed = await transition(state, {
    kind: 'consume_code', challengeId: ch.challengeId, owner, attemptId: issued.attemptId, dayRef, day,
  })
  if (consumed.kind !== 'consumed') {
    return refuse(consumed.kind === 'stale' || consumed.kind === 'locked' ? 429 : 503,
      consumed.kind === 'stale' || consumed.kind === 'locked' ? 'CODE_LOCKED' : 'STATE_UNAVAILABLE')
  }
  deps.log('booking_matched', { care: 'none' })
  return json(200, { status: 'matched', attemptToken: issued.token, maskedEmail: mask(email), care: null, scanSeconds: config.scanSeconds })
}

export async function handleScan(req: Request, deps: Deps): Promise<Response> {
  const g = gate(req, deps)
  if (g instanceof Response) return g
  const { config, deviceId, secret, state } = g
  let form: FormData
  try { form = await req.formData() } catch { return refuse(400, 'BAD_REQUEST') }
  const field = (k: string): string => { const v = form.get(k); return typeof v === 'string' ? v : '' }
  const now = deps.now()
  const attempt = readAttempt(secret, field('attemptToken'), now.getTime())
  const email = normalizeEmail(field('email'))
  if (!attempt || !isEmail(email) || emailHash(secret, email) !== attempt.emailHash) return refuse(400, 'ATTEMPT_INVALID')
  if (field('consentVersion') !== CONSENT_VERSION || field('processing') !== 'true' || field('emailResults') !== 'true') return refuse(400, 'CONSENT_REQUIRED')
  const file = form.get('video')
  if (!file || typeof file === 'string' || file.size < MIN_VIDEO || file.size > MAX_VIDEO) return refuse(422, 'VIDEO_UNSUPPORTED')
  const video = await file.arrayBuffer()
  const bytes = new Uint8Array(video)
  if (!isMp4(bytes)) return refuse(422, 'VIDEO_UNSUPPORTED')

  const read = await readBooking(config.calendesk!, attempt.bookingId, deps.fetch)
  if (!read.ok) return read.reason === 'BOOKING_NOT_FOUND' ? refuse(409, 'BOOKING_CHANGED') : refuse(503, 'BOOKING_UNAVAILABLE')
  const m = matchBooking({ booking: read.booking, typedEmail: email, outlet: config.outlet, roster: config.roster, now })
  if (!m.ok) {
    deps.log('booking_changed', { reasons: m.reasons })
    return refuse(409, 'BOOKING_CHANGED')
  }
  const day = bookingDay(read.booking, config.outlet.timeZone)
  if (day === null) return refuse(409, 'BOOKING_CHANGED')
  const dayRef = bookingDayRef(secret, config, read.booking.id, day)
  const bucket = deviceId === 'open' ? `open:${dayRef}` : deviceId
  if (!brakesOf(deps).allowSubmission(bucket, attempt.attemptId, now.getTime())) return refuse(429, 'TOO_MANY_SCANS')

  // Staff copying is disabled by readiness; a forged/stale share request cannot enable it.
  const ccDecision = field('share') === 'true' ? 'unavailable' : 'declined'
  const intent = consentIntent(secret, {
    tenantId: config.tenantId, calendeskAccountRef: config.calendesk!.tenant, outletSlug: config.outlet.slug,
    booking: read.booking, noticeVersion: CONSENT_VERSION, careCcDecision: ccDecision, guestEmail: email, verifiedAt: now,
  })
  if (!intent) return refuse(503, 'CONSENT_UNAVAILABLE')
  const owned = { attemptId: attempt.attemptId, dayRef, owner: newId() }
  const begun = await transition(state, { kind: 'begin_check', ...owned, intent })
  if (begun.kind !== 'granted') {
    if (begun.kind === 'pending') return refuse(409, 'CHECK_PENDING')
    if (begun.kind === 'capped') return refuse(409, 'BOOKING_ALREADY_CHECKED')
    if (begun.kind === 'stale') return refuse(409, 'ATTEMPT_ALREADY_SUBMITTED')
    return refuse(503, 'STATE_UNAVAILABLE')
  }

  const finish = async (outcome: Outcome, delivery: Delivery): Promise<boolean> =>
    (await transition(state, { kind: 'finish_check', ...owned, outcome, delivery })).kind === 'finished'
  const submission = await submitVideo(config.facephys!, {
    video, videoSha256: sha256Hex(bytes), idempotencyKey: `dmk-${attempt.attemptId}`,
    authorizeProcess: async () => {
      const grant = (await transition(state, { kind: 'authorize_process', ...owned })).kind
      return grant === 'authorized' ? 'authorized' : grant === 'stale' ? 'denied' : 'unavailable'
    },
  }, deps.fetch, () => deps.now().getTime(), (host) => deps.log('vendor_upload_host', { host }))
  if (submission.kind === 'authorization_denied') {
    // A definite refusal (the ready window or the outlet day passed): nothing was processed, so the owner- and
    // phase-guarded release frees the slot. If that release isn't acknowledged, the booking stays held.
    deps.log('process_authorization_denied', {})
    const released = await transition(state, { kind: 'release_check', ...owned })
    if (released.kind !== 'released') return unknownOutcome(attempt.attemptId)
    return json(409, { status: 'refused', code: 'ATTEMPT_INVALID', retryable: false })
  }
  if (submission.kind === 'authorization_unavailable') {
    deps.log('process_authorization_unavailable', {})
    // It may have committed before the ACK was lost. Never process, release, or acquire a replacement owner.
    return unknownOutcome(attempt.attemptId)
  }
  if (submission.kind === 'not_submitted') {
    const released = await transition(state, { kind: 'release_check', ...owned })
    if (released.kind !== 'released') return unknownOutcome(attempt.attemptId)
    return json(502, { status: 'failed', code: submission.code, retryable: submission.code !== 'VENDOR_AUTH' })
  }
  if (submission.kind === 'refused') {
    deps.log('vendor_refused', { code: submission.code, httpStatus: submission.httpStatus })
    if (!await finish('failed', 'not_attempted')) return unknownOutcome(attempt.attemptId)
    return json(502, { status: 'failed', code: submission.code, retryable: false })
  }
  if (submission.kind === 'unknown_outcome') {
    await finish('unknown_outcome', 'not_attempted')
    return unknownOutcome(attempt.attemptId)
  }
  deps.log('vendor_result_shape', { keys: keyPaths(submission.body) })
  const reading = normalizeResult(submission.body, config.minQuality, config.allowMissingQuality)
  if (reading.kind === 'insufficient_quality') {
    if (!await finish('insufficient_quality', 'not_attempted')) return unknownOutcome(attempt.attemptId)
    return json(200, { status: 'insufficient_quality' })
  }
  const message = composeResultEmail({
    ccName: null, outletName: config.outlet.name, when: now, timeZone: config.outlet.timeZone,
    indicators: reading.indicators, consentVersion: CONSENT_VERSION, reference: attempt.attemptId.slice(0, 8),
  })
  const delivery = await sendEmail(config.mail!, { to: email, cc: null, ...message }, `dmk-${attempt.attemptId}`, deps.fetch)
  if (!await finish('completed', delivery)) return unknownOutcome(attempt.attemptId)
  // 'sent' records mail-service acceptance only; it is never an inbox receipt.
  return json(200, { status: 'completed', indicators: reading.indicators, delivery, to: mask(email), cc: null, ccStatus: ccDecision, retryable: false })
}

export async function handleHealth(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env, deps.now())
  const nowMs = deps.now().getTime()
  const enrolmentRequired = config.device !== null && config.device.enrollCode !== null
  const deviceEnrolled = config.device ? deviceIdFrom(config.device.cookieSecret, req.headers.get('cookie'), nowMs) !== null : false
  const allowedToProbe = config.device !== null && (enrolmentRequired ? deviceEnrolled : true)
  const probe = new URL(req.url).searchParams.get('probe') === 'facephys' && allowedToProbe && config.facephys !== null && brakesOf(deps).probeBudgetLeft(nowMs)
  const clock = () => deps.now().getTime()
  const facephysAuth = probe ? ((await authTest(config.facephys!, deps.fetch, clock)) ? 'ok' : 'failed') : 'not_probed'
  const preflight = probe && facephysAuth === 'ok' ? await presignPreflight(config.facephys!, deps.fetch, clock) : null
  const calendeskAuth = probe && config.calendesk ? ((await calendeskReachable(config.calendesk, deps.fetch)) ? 'ok' : 'failed') : 'not_probed'
  return json(200, {
    ready: isReady(config, deps.state !== undefined),
    configured: {
      switchedOn: config.switchedOn, facephys: config.facephys !== null, calendesk: config.calendesk !== null,
      mail: config.mail !== null, device: config.device !== null, rosterEntries: config.roster.length,
      state: config.state !== null || deps.state !== undefined, staffCopiesOff: config.staffCopiesOff,
      retention30Days: config.retention.days === 30 && config.retention.policyVersion === 'dmk-30-days-v1',
    },
    stateSchema: 'not_verified',
    enrolmentRequired, deviceEnrolled, careSource: config.careSource, facephysAuth, calendeskAuth,
    uploadPolicy: config.facephys?.uploadPolicy ?? null, uploadHost: preflight?.host ?? null,
    uploadHostAllowed: preflight?.allowed ?? false,
  })
}
