/**
 * The four wellness routes as plain Request → Response handlers with injected dependencies, so
 * features/kiosk-cloud-wellness.feature drives the real code against fake vendors.
 *
 * Order of refusals: switched on and configured → enrolled tablet → valid input → entity match →
 * recipient → video → entity match again at the point of charge → brakes → FacePhys → email.
 * Every response is `Cache-Control: no-store`. Logs carry codes, counts and key paths: never an
 * email address, a reading, a signed URL or a secret.
 */
import { readConfig, isReady } from './config.ts'
import type { Env, WellnessConfig } from './config.ts'
import { calendeskReachable, readBooking, readEmployee } from './calendesk.ts'
import type { BookingFacts } from './calendesk.ts'
import { matchBooking, normalizeEmail, isEmail } from './match.ts'
import type { MatchReason } from './match.ts'
import { careRecipientFor } from './roster.ts'
import type { RosterEntry } from './roster.ts'
import { authTest, presignPreflight, submitVideo } from './facephys.ts'
import { keyPaths, normalizeResult } from './result.ts'
import { composeResultEmail, sendEmail } from './email.ts'
import { consentRecord } from './record.ts'
import type { CcDecision, Delivery, Outcome, RecordInput } from './record.ts'
import { careEmailHash, deviceIdFrom, emailHash, enrollCodeMatches, issueAttempt, issueDevice, readAttempt } from './tokens.ts'
import { liveBrakes } from './limits.ts'
import type { Brakes } from './limits.ts'
import { sha256Hex } from './crypto.ts'
import { CONSENT_VERSION } from './consent.ts'

/**
 * Worst case per scan: Calendesk 4 s + presign 5 s + upload 13 s + process 25 s + email 4 s = 51 s, under maxDuration 60.
 * The optional consent-record email (4 s) is sent only if at most 48 s have elapsed (RECORD_MAIL_DEADLINE_MS).
 */
const RECORD_MAIL_DEADLINE_MS = 48_000
export interface Deps {
  env: Env
  fetch: typeof fetch
  now: () => Date
  log: (event: string, fields: Record<string, unknown>) => void
  /** The in-process brakes. Production shares one set per instance; each test scenario brings its own. */
  brakes?: Brakes
}

const brakesOf = (deps: Deps): Brakes => deps.brakes ?? liveBrakes

const MIN_VIDEO = 1024
const MAX_VIDEO = 4_200_000 // under the 4.5 MB serverless request limit

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const refuse = (status: number, code: string): Response => json(status, { status: 'refused', code })

/** An ISO-BMFF file ("ftyp" at byte 4): the only container FacePhys accepts (video/mp4). */
export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
}

export function mask(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? `${email[0]}•••${email.slice(at)}` : '•••'
}

type Gate = { config: WellnessConfig; deviceId: string; secret: string }

/**
 * The CC recipient: the booking's own employee, never a substitute.
 * - With CARE_ROSTER_JSON set, the roster entry must be active at this outlet.
 * - Otherwise Calendesk is authoritative: the booking's employee (nested, or GET /admin/employees/{id}) needs a valid
 *   email and must not be inactive.
 */
async function resolveCare(config: WellnessConfig, booking: BookingFacts, fetchImpl: typeof fetch): Promise<RosterEntry | null> {
  if (booking.employeeId === null) return null
  if (config.careSource === 'roster') return careRecipientFor(config.roster, booking.employeeId, config.outlet.slug)
  let emp = booking.employee && booking.employee.id === booking.employeeId && booking.employee.email ? booking.employee : null
  if (!emp) emp = await readEmployee(config.calendesk!, booking.employeeId, fetchImpl)
  if (!emp || emp.id !== booking.employeeId || !emp.email || !isEmail(emp.email)) return null
  if (emp.status !== null && emp.status !== 'active') return null
  return { calendeskEmployeeId: emp.id, name: emp.name ?? 'your CARE team member', email: emp.email, outlets: [config.outlet.slug], active: true }
}

function gate(req: Request, deps: Deps): Gate | Response {
  const config = readConfig(deps.env)
  if (!isReady(config) || !config.device) return refuse(503, 'CHECK_DISABLED')
  const secret = config.device.cookieSecret
  // Open mode (no KIOSK_ENROLL_CODE): no tablet set-up. Every scan is still gated by today's booking match.
  if (config.device.enrollCode === null) return { config, deviceId: 'open', secret }
  const deviceId = deviceIdFrom(secret, req.headers.get('cookie'), deps.now().getTime())
  if (!deviceId) return refuse(401, 'DEVICE_NOT_ENROLLED')
  return { config, deviceId, secret }
}

export async function handleEnroll(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env)
  if (!config.device) return refuse(503, 'CHECK_DISABLED')
  if (config.device.enrollCode === null) return json(200, { status: 'enrolment_not_required' })
  const now = deps.now().getTime()
  if (!brakesOf(deps).enrollBudgetLeft(now)) return refuse(429, 'TOO_MANY_ATTEMPTS')
  let code: unknown = null
  try { code = ((await req.json()) as { code?: unknown }).code } catch { code = null }
  if (!enrollCodeMatches(config.device.enrollCode as string, code)) {
    brakesOf(deps).noteEnrollFailure(now)
    deps.log('enroll_refused', {})
    return refuse(401, 'ENROLL_CODE_WRONG')
  }
  deps.log('device_enrolled', {})
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': issueDevice(config.device.cookieSecret, now).header } })
}

function parseBookingId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v
  if (typeof v === 'string' && /^\d{1,12}$/.test(v.trim())) return Number(v.trim())
  return null
}

export async function handleBooking(req: Request, deps: Deps): Promise<Response> {
  const g = gate(req, deps)
  if (g instanceof Response) return g
  const { config, secret } = g
  let input: { bookingId?: unknown; email?: unknown }
  try { input = (await req.json()) as typeof input } catch { return refuse(400, 'BOOKING_INPUT_INVALID') }
  const bookingId = parseBookingId(input.bookingId)
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : ''
  if (bookingId === null || !isEmail(email)) return refuse(400, 'BOOKING_INPUT_INVALID')

  const read = await readBooking(config.calendesk!, bookingId, deps.fetch)
  if (!read.ok && read.reason === 'BOOKING_UNAVAILABLE') {
    deps.log('booking_unavailable', {})
    return refuse(503, 'BOOKING_UNAVAILABLE')
  }
  const now = deps.now()
  const reasons: MatchReason[] = []
  let care: RosterEntry | null = null
  if (!read.ok) reasons.push(read.reason)
  else {
    const m = matchBooking({ booking: read.booking, typedEmail: email, outlet: config.outlet, roster: config.roster, now })
    if (m.ok) care = await resolveCare(config, read.booking, deps.fetch)
    else reasons.push(...m.reasons)
  }
  // Not found and mismatched get the same answer, so the kiosk cannot be used to probe bookings.
  if (reasons.length > 0) {
    // Numeric booking metadata only, so a refusal is self-diagnosing; never an email, a name or the booking payload.
    const b = read.ok ? read.booking : null
    deps.log('booking_refused', { reasons, locationId: b?.locationId ?? null, serviceLocationId: b?.serviceLocationId ?? null, serviceId: b?.serviceId ?? null })
    return refuse(409, 'BOOKING_NOT_MATCHED')
  }
  const { token } = issueAttempt(secret, {
    bookingId, emailHash: emailHash(secret, email),
    careEmployeeId: care?.calendeskEmployeeId ?? null,
    // Binds the exact CC address shown: if the roster address changes, the CC is dropped, never re-pointed.
    careEmailHash: care ? careEmailHash(secret, care.email) : null,
  }, now.getTime())
  deps.log('booking_matched', { care: care ? 'offered' : 'none' })
  return json(200, {
    status: 'matched',
    attemptToken: token,
    maskedEmail: mask(email),
    // The exact CC destination is shown before consent (CLOUD-10), but only after a booking match.
    care: care ? { name: care.name, email: care.email, maskedEmail: mask(care.email) } : null,
    scanSeconds: config.scanSeconds,
  })
}

export async function handleScan(req: Request, deps: Deps): Promise<Response> {
  const g = gate(req, deps)
  if (g instanceof Response) return g
  const { config, deviceId, secret } = g
  let form: FormData
  try { form = await req.formData() } catch { return refuse(400, 'BAD_REQUEST') }
  const field = (k: string): string => { const v = form.get(k); return typeof v === 'string' ? v : '' }
  const now = deps.now()
  const started = now.getTime()

  const attempt = readAttempt(secret, field('attemptToken'), now.getTime())
  const email = normalizeEmail(field('email'))
  if (!attempt || !isEmail(email) || emailHash(secret, email) !== attempt.emailHash) return refuse(400, 'ATTEMPT_INVALID')
  if (field('consentVersion') !== CONSENT_VERSION || field('processing') !== 'true' || field('emailResults') !== 'true') return refuse(400, 'CONSENT_REQUIRED')
  const share = field('share') === 'true'

  const file = form.get('video')
  if (!file || typeof file === 'string' || file.size < MIN_VIDEO || file.size > MAX_VIDEO) return refuse(422, 'VIDEO_UNSUPPORTED')
  const video = await file.arrayBuffer()
  const bytes = new Uint8Array(video)
  if (!isMp4(bytes)) return refuse(422, 'VIDEO_UNSUPPORTED')

  // Entity guardrails again at the point of charge: the booking may have changed since the match.
  const read = await readBooking(config.calendesk!, attempt.bookingId, deps.fetch)
  if (!read.ok) return read.reason === 'BOOKING_NOT_FOUND' ? refuse(409, 'BOOKING_CHANGED') : refuse(503, 'BOOKING_UNAVAILABLE')
  const m = matchBooking({ booking: read.booking, typedEmail: email, outlet: config.outlet, roster: config.roster, now })
  if (!m.ok) {
    deps.log('booking_changed', { reasons: m.reasons })
    return refuse(409, 'BOOKING_CHANGED')
  }
  // The recipient is re-resolved before delivery (CLOUD-08): still the booking's own employee, still active here.
  // If not, the CC is dropped (never replaced) and the guest's own check still runs (v1.7 O2O-04).
  const resolved = share && attempt.careEmployeeId !== null ? await resolveCare(config, read.booking, deps.fetch) : null
  const care = resolved && resolved.calendeskEmployeeId === read.booking.employeeId && resolved.calendeskEmployeeId === attempt.careEmployeeId
    && attempt.careEmailHash !== null
    && careEmailHash(secret, resolved.email) === attempt.careEmailHash ? resolved : null
  const ccDecision: CcDecision = !share ? 'declined' : care ? 'agreed' : 'unavailable'
  // Stop and reconcile (T1 #164 review): once this attempt's process request has gone out, it is not sent again
  // unless same-key retry is switched on. A retry after a failed presign or upload is safe, because nothing was charged.
  if (!config.sameKeyRetry && brakesOf(deps).wasDispatched(attempt.attemptId)) return refuse(409, 'ATTEMPT_ALREADY_SUBMITTED')
  if (!brakesOf(deps).allowSubmission(deviceId, attempt.attemptId, now.getTime())) return refuse(429, 'TOO_MANY_SCANS')

  const booking = read.booking
  const record = (outcome: Outcome, delivery: Delivery): Promise<void> => writeRecord(deps, config, secret, deps.now().getTime() - started <= RECORD_MAIL_DEADLINE_MS, {
    attemptId: attempt.attemptId, tenantId: config.tenantId, calendeskAccountRef: config.calendesk!.tenant, booking,
    noticeVersion: CONSENT_VERSION, careCcDecision: ccDecision, guestEmail: email, care,
    verifiedAt: now, recordedAt: deps.now(), retention: config.retention, outcome, delivery,
  })

  const submission = await submitVideo(config.facephys!, { video, videoSha256: sha256Hex(bytes), idempotencyKey: `dmk-${attempt.attemptId}` }, deps.fetch, () => deps.now().getTime(), (host) => deps.log('vendor_upload_host', { host }))
  if (submission.kind !== 'not_submitted') brakesOf(deps).markDispatched(attempt.attemptId)
  if (submission.kind === 'not_submitted') {
    await record('not_submitted', 'not_attempted')
    return json(502, { status: 'failed', code: submission.code, retryable: true })
  }
  if (submission.kind === 'refused') {
    deps.log('vendor_refused', { code: submission.code, httpStatus: submission.httpStatus })
    await record('failed', 'not_attempted')
    return json(502, { status: 'failed', code: submission.code, retryable: false })
  }
  if (submission.kind === 'unknown_outcome') {
    await record('unknown_outcome', 'not_attempted')
    // The reference locates the consent record (attemptId) for staff reconciliation, including after a reload.
    return json(202, { status: 'unknown_outcome', retryable: config.sameKeyRetry, reference: attempt.attemptId.slice(0, 8) })
  }

  deps.log('vendor_result_shape', { keys: keyPaths(submission.body) })
  const reading = normalizeResult(submission.body, config.minQuality, config.allowMissingQuality)
  if (reading.kind === 'insufficient_quality') {
    await record('insufficient_quality', 'not_attempted')
    return json(200, { status: 'insufficient_quality' })
  }
  const message = composeResultEmail({
    ccName: care?.name ?? null, outletName: config.outlet.name, when: now, timeZone: config.outlet.timeZone,
    indicators: reading.indicators, consentVersion: CONSENT_VERSION, reference: attempt.attemptId.slice(0, 8),
  })
  const delivery = await sendEmail(config.mail!, { to: email, cc: care?.email ?? null, ...message }, `dmk-${attempt.attemptId}`, deps.fetch)
  await record('completed', delivery)
  // 'sent' means the mail service took the message, not that both mailboxes received it, and never CARE acceptance.
  return json(200, { status: 'completed', indicators: reading.indicators, delivery, to: mask(email), cc: care ? care.name : null, ccStatus: care ? delivery : ccDecision, retryable: delivery === 'failed' && config.sameKeyRetry })
}

async function writeRecord(deps: Deps, config: WellnessConfig, secret: string, mayMail: boolean, f: RecordInput): Promise<void> {
  const rec = consentRecord(secret, f)
  deps.log('consent_record', { ...rec })
  const to = config.mail?.consentRecordTo
  if (!to || !config.mail) return
  if (!mayMail) { deps.log('consent_record_email_skipped', { attemptId: rec.attemptId, reason: 'deadline' }); return }
  const text = JSON.stringify(rec, null, 2)
  await sendEmail(config.mail, { to, cc: null, subject: `Consent record ${rec.attemptId.slice(0, 8)} (${rec.outcome})`, text, html: `<pre>${text}</pre>` }, `rec-${rec.attemptId}-${rec.outcome}-${rec.delivery}`, deps.fetch)
}

export async function handleHealth(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env)
  const nowMs = deps.now().getTime()
  const enrolmentRequired = config.device !== null && config.device.enrollCode !== null
  const deviceEnrolled = config.device ? deviceIdFrom(config.device.cookieSecret, req.headers.get('cookie'), nowMs) !== null : false
  const allowedToProbe = config.device !== null && (enrolmentRequired ? deviceEnrolled : true)
  const probe = new URL(req.url).searchParams.get('probe') === 'facephys' && allowedToProbe && config.facephys !== null && brakesOf(deps).probeBudgetLeft(nowMs)
  const clock = () => deps.now().getTime()
  const facephysAuth = probe ? ((await authTest(config.facephys!, deps.fetch, clock)) ? 'ok' : 'failed') : 'not_probed'
  // Free preflight: which host would receive video, and is it pinned? Hostname only, never the signed URL.
  const preflight = probe && facephysAuth === 'ok' ? await presignPreflight(config.facephys!, deps.fetch, clock) : null
  const calendeskAuth = probe && config.calendesk ? ((await calendeskReachable(config.calendesk, deps.fetch)) ? 'ok' : 'failed') : 'not_probed'
  return json(200, {
    ready: isReady(config),
    configured: {
      switchedOn: config.switchedOn, facephys: config.facephys !== null, calendesk: config.calendesk !== null,
      mail: config.mail !== null, device: config.device !== null, rosterEntries: config.roster.length,
    },
    enrolmentRequired,
    deviceEnrolled,
    careSource: config.careSource,
    facephysAuth,
    calendeskAuth,
    uploadPolicy: config.facephys?.uploadPolicy ?? null,
    uploadHost: preflight?.host ?? null,
    uploadHostAllowed: preflight?.allowed ?? false,
  })
}
