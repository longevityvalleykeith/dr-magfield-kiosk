/**
 * BDD: features/kiosk-cloud-wellness.feature, executed in-process (T1 #164 CLOUD-18: fake provider and mail first).
 *
 * The kiosk controller drives the real HTTP handlers. The handlers call fake FacePhys, OSS,
 * Calendesk and mail hosts through an injected fetch, and the fakes check the HMAC signature and API keys.
 * No network, camera, charge or email happens here.
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry, runFeature } from './bdd/gherkin.mjs'
import { handleEnroll, handleBooking, handleScan } from '../lib/wellness/http.ts'
import { KioskController, MESSAGES } from '../lib/wellness/controller.ts'
import { CONSENT_VERSION } from '../lib/wellness/consent.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRETS = { facephys: 'fp-secret-NEVER-LEAK-7f3a', calendesk: 'cd-key-NEVER-LEAK-91bc', mail: 'rs-key-NEVER-LEAK-2d4e' }
const HOSTS = { facephys: 'facephys.test', oss: 'oss.facephys-oss.test', calendesk: 'calendesk.test', mail: 'mail.test' }

// A minimal ISO-BMFF file start (size, "ftyp", brand "isom"), then deterministic filler.
const FAKE_MP4 = (() => {
  const b = new Uint8Array(4096)
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0)
  for (let i = 12; i < b.length; i++) b[i] = (i * 31) & 0xff
  return b
})()
const FAKE_SHA = createHash('sha256').update(FAKE_MP4).digest('hex')

// The vendor's 200 body is unspecified (OpenAPI 0.1.0), so the fake carries extra
// inferences on purpose: none of them may reach the screen, the email or a log.
const vendorResult = (hr, rmssd, sdnn, br, sqi) => ({
  ok: true,
  result: { heartRate: hr, hrv: { rmssd, sdnn }, breathingRate: br, sqi, spo2: 97, stressLevel: 'low', age: 44, gender: 'm', emotion: 'neutral' },
})

class FakeMedia {
  constructor() { this.openCount = 0; this.on = false; this.recordings = 0 }
  supported() { return true }
  async open() { this.openCount++; this.on = true }
  async record() {
    if (!this.on) throw new Error('camera closed')
    this.recordings++
    return new Blob([FAKE_MP4], { type: 'video/mp4' })
  }
  close() { this.on = false }
  isOpen() { return this.on }
}

class World {
  constructor() {
    this.env = {}
    this.roster = []
    this.calls = []
    this.bookings = new Map()
    this.process = []
    this.processIndex = 0
    this.held = null
    this.logs = []
    this.responses = []
    this.lastReply = null
    this.lastScanInput = null
    this.cookie = null
    this.now = new Date('2026-10-20T02:00:00Z')
    this.objects = 0
    this.media = new FakeMedia()
    this.controller = new KioskController({ api: this.api(), media: this.media, scanSeconds: 20 })
  }

  deps() {
    return {
      env: { ...this.env, CARE_ROSTER_JSON: JSON.stringify(this.roster) },
      fetch: (url, init) => this.fetch(url, init),
      now: () => this.now,
      log: (event, fields) => { this.logs.push(JSON.stringify({ event, ...fields })) },
    }
  }

  headers(extra = {}) { return { ...(this.cookie ? { cookie: this.cookie } : {}), ...extra } }

  async capture(res) {
    const text = await res.text()
    const entry = { status: res.status, headers: Object.fromEntries(res.headers), text, body: text ? JSON.parse(text) : null }
    this.responses.push(entry)
    this.lastReply = entry
    return entry
  }

  api() {
    return {
      booking: async ({ bookingId, email }) => {
        const req = new Request('https://kiosk.test/api/wellness/booking', {
          method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ bookingId, email }),
        })
        const r = await this.capture(await handleBooking(req, this.deps()))
        return { status: r.status, body: r.body }
      },
      scan: async (input) => {
        this.lastScanInput = input
        const fd = new FormData()
        for (const k of ['attemptToken', 'email', 'consentVersion']) fd.set(k, input[k])
        for (const k of ['processing', 'emailResults', 'share']) fd.set(k, String(input[k]))
        fd.set('video', input.video, 'scan.mp4')
        const req = new Request('https://kiosk.test/api/wellness/scan', { method: 'POST', headers: this.headers(), body: fd })
        const r = await this.capture(await handleScan(req, this.deps()))
        return { status: r.status, body: r.body }
      },
    }
  }

  async fetch(url, init = {}) {
    const u = new URL(url)
    const method = (init.method || 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(init.headers || {}))
    let body = init.body
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      const bytes = new Uint8Array(body)
      body = { bytes: bytes.length, sha: createHash('sha256').update(bytes).digest('hex') }
    } else if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* keep text */ } }
    this.calls.push({ host: u.host, method, path: u.pathname, search: u.search, headers, body })
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

    if (u.host === HOSTS.facephys) {
      const expected = createHmac('sha256', SECRETS.facephys).update(headers['x-timestamp'] || '').digest('base64')
      if (headers['x-key-id'] !== 'kid-test' || headers['x-signature'] !== expected) return json(401, { error: 'invalid signature' })
      if (u.pathname === '/api/v2/video/upload/presign' && method === 'POST') {
        this.objects++
        return json(200, { uploadUrl: `https://${HOSTS.oss}/kiosk%2Fobj-${this.objects}.mp4?Signature=ab%2Fcd&Expires=1`, objectKey: `kiosk/obj-${this.objects}.mp4` })
      }
      if (u.pathname === '/api/v3/video/process' && method === 'POST') {
        const next = this.process[Math.min(this.processIndex, this.process.length - 1)]
        this.processIndex++
        if (!next) return json(500, { error: 'no scripted reply' })
        if (next.type === 'lost') throw new TypeError('fetch failed')
        if (next.type === 'status') return json(next.status, { error: 'refused' })
        if (next.type === 'held') return new Promise((resolve) => { this.held = (b) => resolve(json(200, b)) })
        return json(200, next.body)
      }
      return json(404, { error: 'not found' })
    }
    // The vendor SDK's note: OSS refuses a path whose "/" arrived encoded as %2F.
    if (u.host === HOSTS.oss) return new Response(null, { status: u.pathname.includes('%2F') ? 403 : 200 })
    if (u.host === HOSTS.calendesk) {
      if (headers['x-api-key'] !== SECRETS.calendesk || headers['x-tenant'] !== 'tenant-test') return json(401, { message: 'Unauthenticated.' })
      const m = /^\/api\/admin\/bookings\/(\d+)$/.exec(u.pathname)
      if (m && method === 'GET') {
        const b = this.bookings.get(Number(m[1]))
        return b ? json(200, { data: b }) : json(404, { message: 'Not found' })
      }
      return json(404, {})
    }
    if (u.host === HOSTS.mail) {
      if (headers.authorization !== `Bearer ${SECRETS.mail}`) return json(401, {})
      return json(200, { id: `em_${this.calls.length}` })
    }
    throw new Error(`unexpected host ${u.host}`)
  }

  callsTo(...hosts) { return this.calls.filter((c) => hosts.includes(c.host)) }
  processCalls() { return this.calls.filter((c) => c.host === HOSTS.facephys && c.path === '/api/v3/video/process') }
  mails() { return this.callsTo(HOSTS.mail) }
  /** The mail provider dedupes on Idempotency-Key, so a replayed attempt is one email. */
  distinctMails() {
    const seen = new Map()
    for (const m of this.mails()) if (!seen.has(m.headers['idempotency-key'])) seen.set(m.headers['idempotency-key'], m)
    return [...seen.values()]
  }
  records() { return this.logs.map((l) => JSON.parse(l)).filter((l) => l.event === 'consent_record') }
  dispose() { this.controller.reset() }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(name)) yield p
  }
}

const R = createRegistry()

// ── Background ────────────────────────────────────────────────────────
R.Given(/^the wellness check is enabled for outlet "([^"]+)" at Calendesk location (\d+) for services (\d+) and (\d+)$/, (w, outlet, loc, s1, s2) => {
  Object.assign(w.env, {
    SCANS_ENABLED: '1', KIOSK_OUTLET: outlet, KIOSK_LOCATION_ID: loc, KIOSK_SERVICE_IDS: `${s1},${s2}`, KIOSK_TIME_ZONE: 'Asia/Kuala_Lumpur',
    FACEPHYS_BASE_URL: `https://${HOSTS.facephys}`, FACEPHYS_KEY_ID: 'kid-test', FACEPHYS_SECRET_KEY: SECRETS.facephys,
    CALENDESK_API_BASE: `https://${HOSTS.calendesk}/api`, CALENDESK_API_KEY: SECRETS.calendesk, CALENDESK_TENANT: 'tenant-test',
    RESEND_API_KEY: SECRETS.mail, EMAIL_API_BASE: `https://${HOSTS.mail}`, EMAIL_FROM: 'DR MAGfield <kiosk@drmagfield.test>',
    KIOSK_ENROLL_CODE: 'enroll-code-for-tests-0001', KIOSK_COOKIE_SECRET: 'cookie-secret-for-tests-0123456789abcdef',
  })
})
R.Given(/^this kiosk tablet is enrolled$/, async (w) => {
  const req = new Request('https://kiosk.test/api/wellness/enroll', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: w.env.KIOSK_ENROLL_CODE }),
  })
  const res = await handleEnroll(req, w.deps())
  assert.equal(res.status, 204)
  const set = res.headers.get('set-cookie') || ''
  assert.ok(set.startsWith('__Host-dmk-device='), 'no device cookie')
  for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=Strict/i, /Path=\//]) assert.match(set, flag)
  assert.equal(w.calls.length, 0, 'enrolment must not call any vendor')
  w.cookie = set.split(';')[0]
})
R.Given(/^this kiosk tablet is not enrolled$/, (w) => { w.cookie = null })
R.Given(/^today in Kuala Lumpur is "(\d{4}-\d{2}-\d{2})"$/, (w, day) => { w.now = new Date(`${day}T02:00:00Z`) })
R.Given(/^Calendesk has booking (\d+) at location (\d+) for service (\d+) on "([^"]+)" with status "([^"]+)" for "([^"]+)" and employee (\d+)$/,
  (w, id, loc, svc, date, status, email, emp) => {
    w.bookings.set(Number(id), {
      id: Number(id), status, paid: true, location: { id: 9000 + Number(loc), location_id: Number(loc) }, service_id: Number(svc), employee_id: Number(emp), user_id: 77,
      start_date: date, start_time: '10:30', starts_at: `${date} 10:30:00`, user: { id: 77, email, name: 'Test', surname: 'Guest' }, employee: { id: Number(emp) },
    })
  })
R.Given(/^the CARE roster lists employee (\d+) "([^"]+)" with "([^"]+)" as (active|inactive) at "([^"]+)"$/, (w, id, name, email, state, outlet) => {
  w.roster = w.roster.filter((r) => r.calendeskEmployeeId !== Number(id))
    .concat({ calendeskEmployeeId: Number(id), name, email, outlets: [outlet], active: state === 'active' })
})
R.Given(/^the wellness check is switched off$/, (w) => { w.env.SCANS_ENABLED = '0' })

// ── Guest actions ─────────────────────────────────────────────────────
R.When(/^the guest declines the wellness check$/, (w) => { w.controller.decline() })
R.When(/^the guest confirms booking (\d+) with "([^"]+)"$/, async (w, id, email) => { w.controller.start(); await w.controller.submitBooking(id, email) })
R.Given(/^the guest confirmed booking (\d+) with "([^"]+)"$/, async (w, id, email) => {
  w.controller.start()
  await w.controller.submitBooking(id, email)
  assert.equal(w.controller.state.screen, 'consent', `booking not matched: ${w.lastReply?.text}`)
})
R.Given(/^the guest agreed to processing and email delivery$/, async (w) => {
  w.controller.setConsent('processing', true)
  w.controller.setConsent('emailResults', true)
  await w.controller.acceptConsent()
  assert.equal(w.controller.state.screen, 'camera')
})
R.Given(/^the guest ticked CC to "([^"]+)"$/, (w, name) => {
  assert.equal(w.controller.state.attempt?.care?.name, name)
  w.controller.setConsent('share', true)
  assert.equal(w.controller.state.consent.share, true)
})
R.Given(/^FacePhys will return heart rate (\d+), RMSSD (\d+), SDNN (\d+) and breathing rate (\d+) with signal quality ([\d.]+)$/, (w, hr, rm, sd, br, q) => {
  w.process.push({ type: 'result', body: vendorResult(+hr, +rm, +sd, +br, +q) })
})
R.Given(/^FacePhys will return heart rate (\d+) with signal quality ([\d.]+)$/, (w, hr, q) => {
  w.process.push({ type: 'result', body: { ok: true, result: { heartRate: +hr, sqi: +q } } })
})
R.Given(/^FacePhys accepts the process request but its response is lost$/, (w) => { w.process.push({ type: 'lost' }) })
R.Given(/^FacePhys refuses the process request with HTTP (\d+)$/, (w, s) => { w.process.push({ type: 'status', status: +s }) })
R.Given(/^FacePhys will answer the process request only when released$/, (w) => { w.process.push({ type: 'held' }) })

R.When(/^the guest starts the scan$/, async (w) => { await w.controller.startScan() })
R.When(/^the guest starts the scan twice for the same attempt$/, async (w) => {
  // A double tap: the controller ignores the second tap while the first is busy.
  await Promise.all([w.controller.startScan(), w.controller.startScan()])
  // A network-level duplicate of the same attempt (a reconnect resend) still reaches the server.
  await w.api().scan(w.lastScanInput)
})
R.When(/^the guest retries the same attempt$/, async (w) => { await w.controller.retrySameAttempt() })
R.When(/^the guest starts the scan without waiting$/, async (w) => {
  w.pending = w.controller.startScan()
  for (let i = 0; i < 200 && !w.held; i++) await new Promise((r) => setImmediate(r))
  assert.ok(w.held, 'the process request never reached FacePhys')
})
R.When(/^the kiosk is reset for the next guest$/, (w) => { w.controller.reset() })
R.When(/^FacePhys releases a result of heart rate (\d+), RMSSD (\d+), SDNN (\d+) and breathing rate (\d+) with signal quality ([\d.]+)$/, async (w, hr, rm, sd, br, q) => {
  w.held(vendorResult(+hr, +rm, +sd, +br, +q))
  await w.pending
})
R.When(/^the guest cancels while the camera is on$/, (w) => {
  assert.equal(w.media.isOpen(), true)
  w.controller.cancel()
})
R.When(/^the guest forces a CC on the scan request$/, async (w) => {
  // The controller offers no CC here, so bypass it and ask the server directly.
  const a = w.controller.state.attempt
  await w.api().scan({ attemptToken: a.token, email: a.email, consentVersion: CONSENT_VERSION, processing: true, emailResults: true, share: true, video: new Blob([FAKE_MP4], { type: 'video/mp4' }) })
})

// ── Outcomes ──────────────────────────────────────────────────────────
R.Then(/^the camera was never opened$/, (w) => { assert.equal(w.media.openCount, 0) })
R.Then(/^the camera is closed$/, (w) => { assert.equal(w.media.isOpen(), false) })
R.Then(/^no request reached FacePhys, Calendesk or the mail provider$/, (w) => { assert.deepEqual(w.callsTo(HOSTS.facephys, HOSTS.oss, HOSTS.calendesk, HOSTS.mail), []) })
R.Then(/^no request reached FacePhys or the mail provider$/, (w) => { assert.deepEqual(w.callsTo(HOSTS.facephys, HOSTS.oss, HOSTS.mail), []) })
R.Then(/^the kiosk shows the "([a-z_]+)" screen$/, (w, screen) => { assert.equal(w.controller.state.screen, screen) })
R.Then(/^the kiosk is refused with "([A-Z_]+)"$/, (w, code) => {
  assert.equal(w.lastReply?.body?.code, code)
  assert.equal(w.controller.state.errorCode, code)
})
R.Then(/^the booking is refused with "([A-Z_]+)"$/, (w, reason) => {
  assert.equal(w.lastReply.status, 409)
  assert.equal(w.lastReply.body.code, 'BOOKING_NOT_MATCHED')
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'booking_refused')
  assert.ok(line && line.reasons.includes(reason), `logged reasons: ${line?.reasons}`)
})
R.Then(/^the kiosk shows the same message as for a mismatched booking$/, (w) => {
  assert.equal(w.controller.state.errorCode, 'BOOKING_NOT_MATCHED')
  assert.equal(w.controller.state.message, MESSAGES.BOOKING_NOT_MATCHED)
})
R.Then(/^FacePhys received exactly (\d+) presign, (\d+) upload and (\d+) process request$/, (w, p, u, pr) => {
  assert.equal(w.callsTo(HOSTS.facephys).filter((c) => c.path === '/api/v2/video/upload/presign').length, +p)
  const uploads = w.callsTo(HOSTS.oss)
  assert.equal(uploads.length, +u)
  assert.ok(!uploads[0].path.includes('%2F'), 'the upload path kept an encoded slash')
  assert.equal(uploads[0].search, '?Signature=ab%2Fcd&Expires=1', 'the signed query must stay byte-exact')
  assert.equal(uploads[0].headers['content-type'], 'video/mp4')
  assert.equal(uploads[0].body.sha, FAKE_SHA)
  assert.equal(w.processCalls().length, +pr)
})
R.Then(/^the process request carried confirmCharge true, the attempt's idempotency key and the video's SHA-256$/, (w) => {
  const [c] = w.processCalls()
  assert.equal(c.body.confirmCharge, true)
  assert.equal(c.body.capability, 'rppg')
  assert.equal(c.body.videoSha256, FAKE_SHA)
  assert.match(c.body.objectKey, /^kiosk\/obj-\d+\.mp4$/)
  const [record] = w.records()
  assert.equal(c.body.idempotencyKey, `dmk-${record.attemptId}`)
  assert.ok(c.body.idempotencyKey.length >= 16 && c.body.idempotencyKey.length <= 200)
})
R.Then(/^exactly (\d+) email was sent to "([^"]+)" with CC "([^"]+)"$/, (w, n, to, cc) => {
  const mails = w.distinctMails()
  assert.equal(mails.length, +n)
  assert.deepEqual(mails[0].body.to, [to])
  assert.deepEqual(mails[0].body.cc, [cc])
})
R.Then(/^exactly (\d+) email was sent to "([^"]+)" with no CC$/, (w, n, to) => {
  const mails = w.distinctMails()
  assert.equal(mails.length, +n)
  assert.deepEqual(mails[0].body.to, [to])
  assert.ok(!mails[0].body.cc || mails[0].body.cc.length === 0, 'unexpected CC')
})
R.Then(/^the email says "([^"]+)"$/, (w, phrase) => {
  const [m] = w.distinctMails()
  assert.ok(m.body.text.includes(phrase), 'plain-text part')
  assert.ok(m.body.html.includes(phrase), 'html part')
  for (const leak of ['spo2', 'SpO2', 'stress', 'emotion', 'gender', 'age:']) assert.ok(!m.body.text.includes(leak), `email carries ${leak}`)
})
R.Then(/^the kiosk shows the "result" screen with heart rate (\d+) bpm and the email as sent$/, (w, hr) => {
  const s = w.controller.state
  assert.equal(s.screen, 'result')
  const h = s.result.indicators.find((i) => i.key === 'heart_rate')
  assert.equal(h.value, +hr)
  assert.equal(h.unit, 'bpm')
  assert.equal(s.result.delivery, 'sent')
  assert.deepEqual(s.result.indicators.map((i) => i.key).sort(), ['breathing_rate', 'heart_rate', 'hrv_rmssd', 'hrv_sdnn'])
})
// T1 #164 CALENDESK-CONSENT-FIELDS (Keith: location and CARE employee ID) plus Keith's chosen sent/failed codes.
const CONSENT_FIELDS = ['attemptId', 'bookingId', 'calendeskAccountRef', 'careCcDecision', 'careEmployeeId', 'careRecipientRef', 'consentRecordId', 'delivery',
  'deleteAfter', 'event', 'guestRecipientRef', 'locationId', 'noticeVersion', 'outcome', 'processingDecision', 'purpose', 'recordedAt', 'retentionPolicyVersion',
  'schemaVersion', 'serviceId', 'serviceLocationId', 'serviceTypeId', 'sourceSurface', 'subjectBinding', 'tenantId', 'verificationCheckedAt', 'verificationPolicyVersion']
R.Then(/^the consent record holds only the admitted fields, with Calendesk location (\d+), CARE employee (\d+), the CC agreed and no email address or reading$/, (w, loc, emp) => {
  const records = w.records()
  assert.equal(records.length, 1)
  const r = records[0]
  assert.deepEqual(Object.keys(r).sort(), [...CONSENT_FIELDS].sort())
  assert.equal(r.schemaVersion, 'dmk-consent-v2')
  assert.equal(r.noticeVersion, CONSENT_VERSION)
  assert.equal(r.bookingId, 501)
  assert.equal(r.locationId, +loc)
  assert.equal(r.serviceLocationId, 9006, 'serviceLocationId comes from location.id, never from locationId')
  assert.equal(r.careEmployeeId, +emp)
  assert.equal(r.careCcDecision, 'agreed')
  assert.equal(r.subjectBinding, 'booking-detail-knowledge-v1')
  assert.match(r.guestRecipientRef, /^[0-9a-f]{64}$/)
  assert.match(r.careRecipientRef, /^[0-9a-f]{64}$/)
  assert.equal(r.retentionPolicyVersion, 'unset')
  assert.equal(r.deleteAfter, null)
  assert.equal(r.outcome, 'completed')
  assert.equal(r.delivery, 'sent')
  assert.ok(!JSON.stringify(r).includes('@'), 'an email address entered the record')
})
R.Then(/^the consent record keeps CARE employee (\d+) with the CC "([a-z]+)"$/, (w, emp, decision) => {
  const [r] = w.records()
  assert.equal(r.careEmployeeId, +emp)
  assert.equal(r.careCcDecision, decision)
  assert.equal(r.careRecipientRef, null)
})
R.Then(/^the scan reply reports the CC as "([a-z]+)"$/, (w, status) => { assert.equal(w.lastReply.body.ccStatus, status) })
R.Then(/^no CARE recipient is offered$/, (w) => { assert.equal(w.controller.state.attempt.care, null) })
R.Then(/^the scan is refused with "([A-Z_]+)"$/, (w, code) => { assert.equal(w.lastReply.body.code, code) })
R.Then(/^every process request carried the same idempotency key and the same video SHA-256$/, (w) => {
  const p = w.processCalls()
  assert.ok(p.length >= 2, `only ${p.length} process request(s)`)
  assert.equal(new Set(p.map((c) => c.body.idempotencyKey)).size, 1)
  assert.equal(new Set(p.map((c) => c.body.videoSha256)).size, 1)
})
R.Then(/^no email was sent$/, (w) => { assert.equal(w.mails().length, 0) })
R.Then(/^the kiosk shows the "insufficient" screen with no values$/, (w) => {
  assert.equal(w.controller.state.screen, 'insufficient')
  assert.equal(w.controller.state.result, null)
  assert.equal(w.lastReply.body.indicators, undefined)
})
R.Then(/^the kiosk shows the "welcome" screen with no result, email or recipient$/, (w) => {
  const s = w.controller.state
  assert.equal(s.screen, 'welcome')
  assert.equal(s.result, null)
  assert.equal(s.attempt, null)
})
R.Then(/^no recording is held$/, (w) => { assert.equal(w.controller.hasRecording(), false) })
R.Then(/^the kiosk reports the email as "([a-z_]+)"$/, (w, d) => { assert.equal(w.controller.state.result.delivery, d) })
R.Then(/^nothing the kiosk shows or returns says the CARE team accepted or fulfilled anything$/, (w) => {
  const shown = JSON.stringify(w.controller.state) + w.responses.map((r) => r.text).join('') + JSON.stringify(MESSAGES)
  assert.ok(!/accept|fulfil/i.test(shown), 'a delivery was presented as CARE acceptance')
})
R.Then(/^every wellness response carried "Cache-Control: no-store"$/, (w) => {
  assert.ok(w.responses.length > 0)
  for (const r of w.responses) assert.equal(r.headers['cache-control'], 'no-store')
})
R.Then(/^no wellness response contains the FacePhys secret or the Calendesk key$/, (w) => {
  for (const r of w.responses) for (const s of Object.values(SECRETS)) assert.ok(!r.text.includes(s), 'a secret reached a response')
})
R.Then(/^no log line contains the FacePhys secret, the Calendesk key, the guest's email or a reading$/, (w) => {
  assert.ok(w.logs.length > 0)
  for (const l of w.logs) {
    for (const s of Object.values(SECRETS)) assert.ok(!l.includes(s), 'a secret reached a log line')
    assert.ok(!l.includes('@'), `an email address reached a log line: ${l}`)
    assert.ok(!/[:[,]\s*(72|41|55|14|0\.9)\b/.test(l), `a reading reached a log line: ${l}`)
  }
})
R.Then(/^the kiosk code uses no localStorage, sessionStorage, IndexedDB or service worker$/, () => {
  const files = [...walk(join(ROOT, 'app', 'scan')), join(ROOT, 'lib', 'wellness', 'controller.ts')]
  assert.ok(files.length >= 2)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker', 'caches.open']) assert.ok(!src.includes(banned), `${f} uses ${banned}`)
  }
})

runFeature(join(ROOT, 'features', 'kiosk-cloud-wellness.feature'), R, () => new World())
