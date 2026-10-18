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
import { readBooking } from './calendesk.ts'
import { matchBooking, normalizeEmail, isEmail } from './match.ts'
import type { MatchReason } from './match.ts'
import { careRecipientFor } from './roster.ts'
import type { RosterEntry } from './roster.ts'
import { authTest, submitVideo } from './facephys.ts'
import { keyPaths, normalizeResult } from './result.ts'
import { composeResultEmail, sendEmail } from './email.ts'
import { consentRecord } from './record.ts'
import type { CcDecision, Delivery, Outcome, RecordInput } from './record.ts'
import { deviceIdFrom, emailHash, enrollCodeMatches, issueAttempt, issueDevice, readAttempt } from './tokens.ts'
import { allowSubmission, enrollBudgetLeft, noteEnrollFailure } from './limits.ts'
import { sha256Hex } from './crypto.ts'
import { CONSENT_VERSION } from './consent.ts'

/** Worst case per scan: Calendesk 5 s + presign 6 s + upload 15 s + process 26 s + email 5 s = 57 s, under maxDuration 60. */
export interface Deps {
  env: Env
  fetch: typeof fetch
  now: () => Date
  log: (event: string, fields: Record<string, unknown>) => void
}

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

function gate(req: Request, deps: Deps): Gate | Response {
  const config = readConfig(deps.env)
  if (!isReady(config) || !config.device) return refuse(503, 'CHECK_DISABLED')
  const secret = config.device.cookieSecret
  const deviceId = deviceIdFrom(secret, req.headers.get('cookie'), deps.now().getTime())
  if (!deviceId) return refuse(401, 'DEVICE_NOT_ENROLLED')
  return { config, deviceId, secret }
}

export async function handleEnroll(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env)
  if (!config.device) return refuse(503, 'CHECK_DISABLED')
  const now = deps.now().getTime()
  if (!enrollBudgetLeft(now)) return refuse(429, 'TOO_MANY_ATTEMPTS')
  let code: unknown = null
  try { code = ((await req.json()) as { code?: unknown }).code } catch { code = null }
  if (!enrollCodeMatches(config.device.enrollCode, code)) {
    noteEnrollFailure(now)
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
    if (m.ok) care = m.care
    else reasons.push(...m.reasons)
  }
  // Not found and mismatched get the same answer, so the kiosk cannot be used to probe bookings.
  if (reasons.length > 0) {
    deps.log('booking_refused', { reasons })
    return refuse(409, 'BOOKING_NOT_MATCHED')
  }
  const { token } = issueAttempt(secret, { bookingId, emailHash: emailHash(secret, email), careEmployeeId: care?.calendeskEmployeeId ?? null }, now.getTime())
  deps.log('booking_matched', { care: care ? 'offered' : 'none' })
  return json(200, {
    status: 'matched',
    attemptToken: token,
    maskedEmail: mask(email),
    care: care ? { name: care.name, maskedEmail: mask(care.email) } : null,
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
  const resolved = share ? careRecipientFor(config.roster, attempt.careEmployeeId, config.outlet.slug) : null
  const care = resolved && resolved.calendeskEmployeeId === read.booking.employeeId ? resolved : null
  const ccDecision: CcDecision = !share ? 'declined' : care ? 'agreed' : 'unavailable'
  if (!allowSubmission(deviceId, attempt.attemptId, now.getTime())) return refuse(429, 'TOO_MANY_SCANS')

  const booking = read.booking
  const record = (outcome: Outcome, delivery: Delivery): Promise<void> => writeRecord(deps, config, secret, {
    attemptId: attempt.attemptId, tenantId: config.tenantId, calendeskAccountRef: config.calendesk!.tenant, booking,
    noticeVersion: CONSENT_VERSION, careCcDecision: ccDecision, guestEmail: email, care,
    verifiedAt: now, recordedAt: deps.now(), retention: config.retention, outcome, delivery,
  })

  const submission = await submitVideo(config.facephys!, { video, videoSha256: sha256Hex(bytes), idempotencyKey: `dmk-${attempt.attemptId}` }, deps.fetch, () => deps.now().getTime(), (host) => deps.log('vendor_upload_host', { host }))
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
    return json(202, { status: 'unknown_outcome', retryable: true })
  }

  deps.log('vendor_result_shape', { keys: keyPaths(submission.body) })
  const reading = normalizeResult(submission.body, config.minQuality)
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
  return json(200, { status: 'completed', indicators: reading.indicators, delivery, to: mask(email), cc: care ? care.name : null, ccStatus: care ? delivery : ccDecision, retryable: delivery === 'failed' })
}

async function writeRecord(deps: Deps, config: WellnessConfig, secret: string, f: RecordInput): Promise<void> {
  const rec = consentRecord(secret, f)
  deps.log('consent_record', { ...rec })
  const to = config.mail?.consentRecordTo
  if (!to || !config.mail) return
  const text = JSON.stringify(rec, null, 2)
  await sendEmail(config.mail, { to, cc: null, subject: `Consent record ${rec.attemptId.slice(0, 8)} (${rec.outcome})`, text, html: `<pre>${text}</pre>` }, `rec-${rec.attemptId}-${rec.outcome}-${rec.delivery}`, deps.fetch)
}

export async function handleHealth(req: Request, deps: Deps): Promise<Response> {
  const config = readConfig(deps.env)
  const nowMs = deps.now().getTime()
  const deviceEnrolled = config.device ? deviceIdFrom(config.device.cookieSecret, req.headers.get('cookie'), nowMs) !== null : false
  const probe = new URL(req.url).searchParams.get('probe') === 'facephys' && deviceEnrolled && config.facephys !== null
  const facephysAuth = probe ? ((await authTest(config.facephys!, deps.fetch, () => deps.now().getTime())) ? 'ok' : 'failed') : 'not_probed'
  return json(200, {
    ready: isReady(config),
    configured: {
      switchedOn: config.switchedOn, facephys: config.facephys !== null, calendesk: config.calendesk !== null,
      mail: config.mail !== null, device: config.device !== null, rosterEntries: config.roster.length,
    },
    deviceEnrolled,
    facephysAuth,
  })
}
