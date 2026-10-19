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
import { handleEnroll, handleBooking, handleScan, handleHealth } from '../lib/wellness/http.ts'
import * as httpHandlers from '../lib/wellness/http.ts'
import { KioskController, MESSAGES } from '../lib/wellness/controller.ts'
import { CONSENT_VERSION, CONSENT_TEXT } from '../lib/wellness/consent.ts'
import { Brakes } from '../lib/wellness/limits.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRETS = { facephys: 'fp-secret-NEVER-LEAK-7f3a', calendesk: 'cd-key-NEVER-LEAK-91bc', mail: 'rs-key-NEVER-LEAK-2d4e' }
const HOSTS = { facephys: 'facephys.test', oss: 'facephys-kiosk.oss-ap-southeast-1.aliyuncs.com', calendesk: 'calendesk.test', mail: 'mail.test' }

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
    this.employees = new Map()
    this.presignHost = HOSTS.oss
    this.media = new FakeMedia()
    this.brakes = new Brakes()
    this.waits = []
    this.mailRefuses = false
    this.controller = new KioskController({ api: this.api(), media: this.media, scanSeconds: 20 })
  }

  deps() {
    return {
      env: { ...this.env, ...(this.roster === null ? {} : { CARE_ROSTER_JSON: JSON.stringify(this.roster) }) },
      fetch: (url, init) => this.fetch(url, init),
      now: () => this.now,
      log: (event, fields) => { this.logs.push(JSON.stringify({ event, ...fields })) },
      brakes: this.brakes,
      wait: async (ms) => { this.waits.push(ms) },
    }
  }

  headers(extra = {}) { return { ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.clientIp ? { 'x-real-ip': this.clientIp } : {}), ...extra } }

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
          method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify(bookingId ? { bookingId, email } : { email }),
        })
        const r = await this.capture(await handleBooking(req, this.deps()))
        return { status: r.status, body: r.body }
      },
      verify: async ({ challengeToken, email, code }) => {
        const req = new Request('https://kiosk.test/api/wellness/verify', {
          method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ challengeToken, email, code }),
        })
        const r = await this.capture(await httpHandlers.handleVerify(req, this.deps()))
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
    this.calls.push({ host: u.host, method, path: u.pathname, search: u.search, headers, body, redirect: init.redirect })
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

    if (u.host === HOSTS.facephys) {
      const expected = createHmac('sha256', SECRETS.facephys).update(headers['x-timestamp'] || '').digest('base64')
      if (headers['x-key-id'] !== 'kid-test' || headers['x-signature'] !== expected) return json(401, { error: 'invalid signature' })
      if (u.pathname === '/api/agent/auth/test' && method === 'GET') return json(200, { ok: true, keyId: 'kid-test', apiVersion: 3, checkedAt: this.now.toISOString(), secretShown: false })
      if (u.pathname === '/api/v2/video/upload/presign' && method === 'POST') {
        this.objects++
        return json(200, { uploadUrl: `https://${this.presignHost}/kiosk%2Fobj-${this.objects}.mp4?Signature=ab%2Fcd&Expires=1`, objectKey: `kiosk/obj-${this.objects}.mp4` })
      }
      if (u.pathname === '/api/v3/video/process' && method === 'POST') {
        const next = this.process[Math.min(this.processIndex, this.process.length - 1)]
        this.processIndex++
        if (!next) return json(500, { error: 'no scripted reply' })
        if (next.type === 'lost') throw new TypeError('fetch failed')
        if (next.type === 'status') return json(next.status, { error: 'refused' })
        if (next.type === 'held') return new Promise((resolve) => { this.held = (b) => resolve(json(200, b)) })
        if (next.delayMs) this.now = new Date(this.now.getTime() + next.delayMs)
        return json(200, next.body)
      }
      return json(404, { error: 'not found' })
    }
    // The vendor SDK's note: OSS refuses a path whose "/" arrived encoded as %2F.
    if (u.host === HOSTS.oss || u.host === this.presignHost) return new Response(null, { status: u.pathname.includes('%2F') ? 403 : 200 })
    if (u.host === HOSTS.calendesk) {
      if (headers['x-api-key'] !== SECRETS.calendesk || headers['x-tenant'] !== 'tenant-test') return json(401, { message: 'Unauthenticated.' })
      const m = /^\/api\/admin\/bookings\/(\d+)$/.exec(u.pathname)
      if (m && method === 'GET') {
        const b = this.bookings.get(Number(m[1]))
        return b ? json(200, { data: b }) : json(404, { message: 'Not found' })
      }
      if (u.pathname === '/api/admin/settings' && method === 'GET') return json(200, { data: { company_name: 'test' } })
      if (u.pathname === '/api/admin/bookings/v2' && method === 'GET') {
        const q = u.searchParams
        const from = q.get('booking_date_from'), to = q.get('booking_date_to')
        const statuses = (q.get('status_ids') || '').split(',').filter(Boolean)
        const rows = [...this.bookings.values()]
          .filter((b) => (!from || b.start_date >= from) && (!to || b.start_date <= to) && (statuses.length === 0 || statuses.includes(b.status)))
          .map((b) => (this.listOmitsEmail ? { ...b, user: undefined } : b))
          .map((b) => (this.listOmitsLocation ? { ...b, location: undefined } : b))
        return json(200, { data: rows, current_page: 1, last_page: 1, per_page: 100, total: rows.length })
      }
      const e = /^\/api\/admin\/employees\/(\d+)$/.exec(u.pathname)
      if (e && method === 'GET') {
        const emp = this.employees.get(Number(e[1]))
        return emp ? json(200, { data: emp }) : json(404, { message: 'Not found' })
      }
      return json(404, {})
    }
    if (u.host === HOSTS.mail) {
      if (headers.authorization !== `Bearer ${SECRETS.mail}`) return json(401, {})
      if (this.mailRefuses) return json(422, { message: 'refused' })
      return json(200, { id: `em_${this.calls.length}` })
    }
    throw new Error(`unexpected host ${u.host}`)
  }

  callsTo(...hosts) { return this.calls.filter((c) => hosts.includes(c.host)) }
  processCalls() { return this.calls.filter((c) => c.host === HOSTS.facephys && c.path === '/api/v3/video/process') }
  mails() { return this.callsTo(HOSTS.mail).filter((m) => !(m.body.to || []).includes(this.env.CONSENT_RECORD_TO) && !String(m.headers['idempotency-key'] || '').startsWith('code-')) }
  /** One-time-code emails (Idempotency-Key "code-…"), kept apart from result and record emails. */
  codeMails() { return this.callsTo(HOSTS.mail).filter((m) => String(m.headers['idempotency-key'] || '').startsWith('code-')) }
  lastCode() { const m = this.codeMails().at(-1); const hit = m && /\b(\d{6})\b/.exec(m.body.text || ''); return hit ? hit[1] : null }
  recordMails() { return this.callsTo(HOSTS.mail).filter((m) => this.env.CONSENT_RECORD_TO && (m.body.to || []).includes(this.env.CONSENT_RECORD_TO)) }
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
R.Given(/^the wellness check is enabled for outlet "([^"]+)" at Calendesk location (\d+)$/, (w, outlet, loc) => {
  Object.assign(w.env, {
    SCANS_ENABLED: '1', KIOSK_OUTLET: outlet, KIOSK_LOCATION_ID: loc, KIOSK_TIME_ZONE: 'Asia/Kuala_Lumpur',
    FACEPHYS_BASE_URL: `https://${HOSTS.facephys}`, FACEPHYS_KEY_ID: 'kid-test', FACEPHYS_SECRET_KEY: SECRETS.facephys,
    CALENDESK_API_BASE: `https://${HOSTS.calendesk}/api`, CALENDESK_API_KEY: SECRETS.calendesk, CALENDESK_TENANT: 'tenant-test',
    RESEND_API_KEY: SECRETS.mail, EMAIL_API_BASE: `https://${HOSTS.mail}`, EMAIL_FROM: 'DR MAGfield <kiosk@drmagfield.test>',
    KIOSK_ENROLL_CODE: 'enroll-code-for-tests-0001', KIOSK_COOKIE_SECRET: 'cookie-secret-for-tests-0123456789abcdef',
    FACEPHYS_UPLOAD_HOSTS: HOSTS.oss,
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
/** Confirms a booking through whichever gate the kiosk has: a direct match, or the code emailed to the booking's inbox. */
async function confirm(w, id, email) {
  // No booking number in the product: "booking N" is this guest's one booking under that email today.
  for (const [k, b] of w.bookings) if (k !== Number(id) && b.user?.email === email) w.bookings.delete(k)
  w.controller.start()
  const before = w.codeMails().length
  await w.controller.submitBooking('', email)
  if (w.controller.state.screen === 'code' && w.codeMails().length > before) await w.controller.submitCode(w.lastCode())
}
R.When(/^the guest confirms booking (\d+) with "([^"]+)"$/, async (w, id, email) => { await confirm(w, id, email) })
R.Given(/^the guest confirmed booking (\d+) with "([^"]+)"$/, async (w, id, email) => {
  await confirm(w, id, email)
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
// The one-time code email is the gate itself (phone-first, 10-19), so it is not a result or record email.
R.Then(/^no request reached FacePhys or the mail provider$/, (w) => {
  assert.deepEqual(w.callsTo(HOSTS.facephys, HOSTS.oss, HOSTS.mail).filter((c) => !String(c.headers['idempotency-key'] || '').startsWith('code-')), [])
})
R.Then(/^the kiosk shows the "([a-z_]+)" screen$/, (w, screen) => { assert.equal(w.controller.state.screen, screen) })
R.Then(/^the kiosk is refused with "([A-Z_]+)"$/, (w, code) => {
  assert.equal(w.lastReply?.body?.code, code)
  assert.equal(w.controller.state.errorCode, code)
})
R.Then(/^the booking is refused with "([A-Z_]+)"$/, (w, reason) => {
  // The guest never reaches consent and no code is sent. The reply itself is the same as for a match (no oracle).
  assert.notEqual(w.controller.state.screen, 'consent')
  assert.equal(w.codeMails().length, 0, 'no code goes out for a refused booking')
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'booking_refused')
  assert.ok(line && line.reasons.includes(reason), `logged reasons: ${line?.reasons}`)
})
const shape = (r) => ({ status: r.status, kind: r.body?.status, code: r.body?.code ?? null, keys: Object.keys(r.body || {}).sort().join(',') })
R.Then(/^the kiosk shows the same message as for a mismatched booking$/, async (w) => {
  const unknown = shape(w.lastReply)
  w.bookings.set(9998, { ...w.bookings.get(501), id: 9998, location: { id: 9007, location_id: 7 } })
  const mismatched = shape(await w.api().booking({ bookingId: '9998', email: 'guest@example.com' }))
  assert.deepEqual(unknown, mismatched)
  assert.notEqual(w.controller.state.screen, 'consent')
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
  assert.equal(r.subjectBinding, 'booking-inbox-code-v1', 'the code proves the inbox, not the person')
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

// ── v1.7 runtime review (#164 ADVERSARIAL-RUNTIME-019) ─────────────────
R.Given(/^the consent screen shows the exact To address "([^"]+)" and CC address "([^"]+)"$/, (w, to, cc) => {
  const a = w.controller.state.attempt
  assert.equal(a.email, to)
  assert.equal(a.care.email, cc, 'the CC destination must be shown exactly before consent (CLOUD-10)')
})
R.Then(/^every outbound request refused redirects$/, (w) => {
  assert.ok(w.calls.length > 0)
  for (const c of w.calls) assert.equal(c.redirect, 'error', `${c.method} ${c.host}${c.path} may follow a redirect`)
})
R.Given(/^FacePhys will return heart rate (\d+), RMSSD (\d+), SDNN (\d+) and breathing rate (\d+) with no signal quality field$/, (w, hr, rm, sd, br) => {
  w.process.push({ type: 'result', body: { ok: true, result: { heartRate: +hr, hrv: { rmssd: +rm, sdnn: +sd }, breathingRate: +br } } })
})
R.Given(/^no upload host is pinned$/, (w) => { delete w.env.FACEPHYS_UPLOAD_HOSTS })
R.When(/^staff run the free FacePhys preflight on this tablet$/, async (w) => {
  const req = new Request('https://kiosk.test/api/wellness/health?probe=facephys', { headers: w.headers() })
  await w.capture(await handleHealth(req, w.deps()))
})
R.Then(/^the preflight names the upload host "([^"]+)" as allowed by the "(dynamic|pinned)" rule$/, (w, host, rule) => {
  const b = w.lastReply.body
  assert.equal(b.facephysAuth, 'ok')
  assert.equal(b.uploadHost, host)
  assert.equal(b.uploadHostAllowed, true)
  assert.equal(b.uploadPolicy, rule)
  assert.equal(b.calendeskAuth, 'ok', 'the free probe also proves the Calendesk key and tenant')
  assert.ok(!w.lastReply.text.includes('Signature'), 'the signed upload URL must never be returned')
})
R.Then(/^no video was uploaded and no process request was sent$/, (w) => {
  assert.equal(w.callsTo(HOSTS.oss).length, 0)
  assert.equal(w.processCalls().length, 0)
})
R.Given(/^consent records are also mailed to "([^"]+)"$/, (w, to) => { w.env.CONSENT_RECORD_TO = to })
R.Then(/^exactly (\d+) consent-record email went to "([^"]+)" with no other email address or reading in it$/, (w, n, to) => {
  const recs = w.recordMails()
  assert.equal(recs.length, +n)
  assert.deepEqual(recs[0].body.to, [to])
  const text = JSON.stringify({ subject: recs[0].body.subject, text: recs[0].body.text, html: recs[0].body.html })
  assert.ok(!text.includes('@'), 'an email address entered the record email')
  assert.ok(!/[:[,]\s*(72|41|55|0\.9)\b/.test(text), 'a reading entered the record email')
})
R.Given(/^FacePhys takes (\d+) seconds and then returns heart rate (\d+), RMSSD (\d+), SDNN (\d+) and breathing rate (\d+) with signal quality ([\d.]+)$/, (w, secs, hr, rm, sd, br, q) => {
  w.process.push({ type: 'result', delayMs: +secs * 1000, body: vendorResult(+hr, +rm, +sd, +br, +q) })
})
R.Then(/^no consent-record email went to "([^"]+)"$/, (w) => { assert.equal(w.recordMails().length, 0) })
R.Then(/^the consent record line is still written$/, (w) => {
  assert.equal(w.records().length, 1)
  assert.ok(w.logs.some((l) => JSON.parse(l).event === 'consent_record_email_skipped'), 'the skip must be logged')
})

R.Given(/^same-key retry is switched on$/, (w) => { w.env.SAME_KEY_RETRY = '1' })
R.When(/^the same attempt is resent at the network level$/, async (w) => { await w.api().scan(w.lastScanInput) })
R.Then(/^the kiosk offers no retry and shows the reference of the consent record's attempt$/, (w) => {
  const s = w.controller.state
  assert.equal(s.retryable, false)
  assert.match(s.reference ?? '', /^[0-9a-f]{8}$/)
  const [rec] = w.records()
  assert.ok(rec.attemptId.startsWith(s.reference), 'the reference must locate the consent record')
})

// ── production simplicity (Keith 10-19) ──────────────────────────────
R.Given(/^production simplicity: no enrolment code, cookie secret, CARE roster or upload pin is configured$/, (w) => {
  for (const k of ['KIOSK_ENROLL_CODE', 'KIOSK_COOKIE_SECRET', 'FACEPHYS_UPLOAD_HOSTS']) delete w.env[k]
  w.roster = null
})
R.Given(/^Calendesk names employee (\d+) as "([^"]+)" with "([^"]+)"$/, (w, id, name, email) => {
  w.employees.set(Number(id), { id: Number(id), user: { id: 900 + Number(id), name, surname: null, email, status: 'active' }, services: [{ id: 13 }] })
})
R.Given(/^FacePhys presigns uploads to "([^"]+)"$/, (w, host) => { w.presignHost = host })

// ── any service at KRPM (Keith 10-19) ─────────────────────────────────
R.Given(/^the check is restricted to services (\d+) and (\d+)$/, (w, a, b) => { w.env.KIOSK_SERVICE_IDS = `${a},${b}` })
R.Then(/^the refusal log names location (\d+) and service (\d+) and no email address$/, (w, loc, svc) => {
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'booking_refused')
  assert.equal(line.locationId, +loc)
  assert.equal(line.serviceId, +svc)
  assert.ok(!JSON.stringify(line).includes('@'), 'an email address reached the refusal log')
})

// ── brakes (adversarial dogfood 10-19: A1 per-booking cap, A4 open-mode buckets, A2 lookup brakes) ──
const OK = { ok: true, result: { heartRate: 72, hrv: { rmssd: 41, sdnn: 55 }, breathingRate: 14, sqi: 0.9 } }
async function completeCheck(w, id, email) {
  w.controller.reset()
  await confirm(w, String(id), email)
  assert.equal(w.controller.state.screen, 'consent', `booking ${id}: ${w.lastReply?.body?.code}`)
  w.controller.setConsent('processing', true)
  w.controller.setConsent('emailResults', true)
  await w.controller.acceptConsent()
  w.process.push({ type: 'ok', body: OK })
  w.processIndex = w.process.length - 1
  await w.controller.startScan()
  assert.equal(w.controller.state.screen, 'result', `booking ${id}: ${w.lastReply?.body?.code}`)
  w.controller.reset()
}
const mark = (w) => { w.mark = { process: w.processCalls().length, calendesk: w.callsTo(HOSTS.calendesk).length, cameraOpens: w.media.openCount } }
R.Then(/^the camera was not opened again$/, (w) => { assert.equal(w.media.openCount, w.mark.cameraOpens) })
R.Given(/^the guest already completed (\d+) checks for booking (\d+) today$/, async (w, n, id) => {
  const email = w.bookings.get(Number(id)).user.email
  for (let i = 0; i < Number(n); i++) await completeCheck(w, id, email)
  mark(w)
})
R.Given(/^the guest holds a matched attempt for booking (\d+) from earlier$/, async (w, id) => {
  const email = w.bookings.get(Number(id)).user.email
  let r = await w.api().booking({ bookingId: id, email })
  if (r.body.status === 'code_sent') r = await w.api().verify({ challengeToken: r.body.challengeToken, email, code: w.lastCode() })
  assert.equal(r.body.status, 'matched')
  w.heldAttempt = { token: r.body.attemptToken, email: w.bookings.get(Number(id)).user.email }
})
R.When(/^the held attempt is submitted$/, async (w) => {
  w.process.push({ type: 'ok', body: OK })
  w.processIndex = w.process.length - 1
  await w.api().scan({ attemptToken: w.heldAttempt.token, email: w.heldAttempt.email, consentVersion: CONSENT_VERSION, processing: true, emailResults: true, share: false, video: new Blob([FAKE_MP4], { type: 'video/mp4' }) })
})
R.Then(/^no further process request reached FacePhys$/, (w) => { assert.equal(w.processCalls().length, w.mark.process) })
R.Then(/^no further request reached Calendesk$/, (w) => { assert.equal(w.callsTo(HOSTS.calendesk).length, w.mark.calendesk) })
R.Given(/^(\d+) other bookings each completed a check on this kiosk in the last hour$/, async (w, n) => {
  for (let i = 0; i < Number(n); i++) {
    const id = 600 + i, email = `other${i}@example.com`
    w.bookings.set(id, { ...w.bookings.get(501), id, user: { id: 78, email, name: 'Other', surname: 'Guest' } })
    await completeCheck(w, id, email)
  }
})
R.Given(/^the client "([^"]+)" had (\d+) booking lookups refused in the last 10 minutes$/, async (w, ip, n) => {
  w.clientIp = ip
  for (let i = 0; i < Number(n); i++) {
    const r = await w.api().booking({ bookingId: '', email: `nobody${i}@example.com` })
    assert.notEqual(r.body.status, 'matched')
    assert.notEqual(r.status, 429)
  }
  mark(w)
})
R.When(/^the client is "([^"]+)"$/, (w, ip) => { w.clientIp = ip })
R.Given(/^(\d+) booking lookups from different clients reached Calendesk in the last minute$/, async (w, n) => {
  for (let i = 0; i < Number(n); i++) {
    w.clientIp = `198.18.${i >> 8}.${i & 255}`
    await w.api().booking({ bookingId: '501', email: 'guest@example.com' })
  }
  w.clientIp = '192.0.2.200'
  mark(w)
})

// ── phone-first, inbox key (Keith 10-19) ─────────────────────────────
R.When(/^the guest asks for a code with "([^"]+)"$/, async (w, email) => {
  w.controller.reset(); w.controller.start()
  w.mark = { ...(w.mark || {}), codes: w.codeMails().length }
  await w.controller.submitBooking('', email)
})
R.Given(/^the guest asked for a code with "([^"]+)" (\d+) times$/, async (w, email, n) => {
  for (let i = 0; i < Number(n); i++) { w.controller.reset(); w.controller.start(); await w.controller.submitBooking('', email) }
  w.mark = { ...(w.mark || {}), codes: w.codeMails().length }
  assert.equal(w.mark.codes, Number(n), 'each of the first requests sent a code')
})
R.Then(/^a 6-digit code was emailed to "([^"]+)" and to no one else$/, (w, to) => {
  const mails = w.codeMails()
  assert.equal(mails.length, 1)
  assert.deepEqual(mails[0].body.to, [to])
  assert.equal(mails[0].body.cc, undefined)
  assert.match(w.lastCode() || '', /^\d{6}$/)
  assert.ok(!JSON.stringify(w.lastReply.body).includes(w.lastCode()), 'the code never comes back to the page')
})
R.Then(/^no code email was sent$/, (w) => { assert.equal(w.codeMails().length, 0) })
R.Then(/^no further code email was sent$/, (w) => { assert.equal(w.codeMails().length, w.mark.codes) })
R.When(/^the guest enters the emailed code$/, async (w) => { await w.controller.submitCode(w.lastCode()) })
R.When(/^the guest enters a wrong code (\d+) times$/, async (w, n) => {
  const wrong = String((Number(w.lastCode()) + 1) % 1_000_000).padStart(6, '0')
  for (let i = 0; i < Number(n); i++) await w.controller.submitCode(wrong)
})
R.When(/^(\d+) minutes pass$/, (w, n) => { w.now = new Date(w.now.getTime() + Number(n) * 60_000) })
R.Then(/^the reply has the same shape as the reply for "([^"]+)"$/, async (w, other) => {
  const mine = shape(w.lastReply)
  const theirs = shape(await w.api().booking({ bookingId: '', email: other }))
  assert.deepEqual(mine, theirs)
})
R.Then(/^booking (\d+) at another outlet was never read in full$/, (w, id) => {
  assert.equal(w.callsTo(HOSTS.calendesk).filter((c) => c.path === `/api/admin/bookings/${id}`).length, 0)
})
R.Then(/^no Calendesk booking was read in full$/, (w) => {
  assert.equal(w.callsTo(HOSTS.calendesk).filter((c) => /^\/api\/admin\/bookings\/\d+$/.test(c.path)).length, 0)
})
R.When(/^the same code is entered again$/, async (w) => {
  const sent = [...w.responses].reverse().find((r) => r.body?.status === 'code_sent')
  await w.api().verify({ challengeToken: sent.body.challengeToken, email: 'guest@example.com', code: w.lastCode() })
})
R.Then(/^the reply is refused with "([A-Z_]+)"$/, (w, code) => { assert.equal(w.lastReply.body.code, code) })
R.Then(/^Calendesk's booking list was read with today's date filters only, as Foundry reads it in production$/, (w) => {
  const lists = w.callsTo(HOSTS.calendesk).filter((c) => c.path === '/api/admin/bookings/v2')
  assert.ok(lists.length >= 1)
  for (const c of lists) {
    const q = new URLSearchParams(c.search)
    assert.deepEqual([...q.keys()].sort(), ['booking_date_from', 'booking_date_to', 'limit', 'page'])
    assert.equal(q.get('booking_date_from'), '2026-10-20')
    assert.equal(q.get('booking_date_to'), '2026-10-20')
  }
})
R.Given(/^Calendesk lists bookings without customer emails$/, (w) => { w.listOmitsEmail = true })
R.When(/^the phone hides the page$/, (w) => { w.controller.onHidden() })
R.Then(/^the consent text says the check is for the person who received the code$/, (w) => {
  assert.equal(w.controller.state.screen, 'consent')
  assert.ok(CONSENT_TEXT.en.points.some((p) => p.includes('person who received the code')))
  assert.ok(CONSENT_TEXT.ms.points.some((p) => p.includes('orang yang menerima kod')))
})

// ── no-store cures (10-19) ────────────────────────────────────────────
R.When(/^FacePhys presigns uploads to its own storage again$/, (w) => { w.presignHost = HOSTS.oss })
R.When(/^the guest completes another check for booking (\d+)$/, async (w, id) => {
  w.controller.reset()
  await confirm(w, id, w.bookings.get(Number(id)).user.email)
  assert.equal(w.controller.state.screen, 'consent', `booking ${id}: ${w.lastReply?.body?.code}`)
  w.controller.setConsent('processing', true); w.controller.setConsent('emailResults', true)
  await w.controller.acceptConsent()
  w.process.push({ type: 'ok', body: OK }); w.processIndex = w.process.length - 1
  await w.controller.startScan()
})
R.Given(/^Calendesk lists bookings without their location$/, (w) => { w.listOmitsLocation = true })
R.When(/^a lookup names booking (\d+) with "([^"]+)"$/, async (w, id, email) => { await w.api().booking({ bookingId: id, email }) })
R.Then(/^both lookups were held to the same reply time$/, (w) => {
  assert.equal(w.waits.length, 2, 'each lookup is padded')
  assert.equal(w.waits[0], w.waits[1])
  assert.ok(w.waits[0] >= 1000)
})
R.Given(/^the mail provider refuses messages$/, (w) => { w.mailRefuses = true })
R.Then(/^Calendesk's booking list was read (\d+) times?$/, (w, n) => {
  assert.equal(w.callsTo(HOSTS.calendesk).filter((c) => c.path === '/api/admin/bookings/v2').length, Number(n))
})
R.Then(/^the booking list shape was logged with field names and no values$/, (w) => {
  const lines = w.logs.filter((l) => JSON.parse(l).event === 'booking_list_shape')
  assert.equal(lines.length, 1)
  const l = JSON.parse(lines[0])
  assert.ok(Array.isArray(l.keys) && l.keys.includes('location.location_id') && l.keys.includes('user.email'))
  assert.ok(!lines[0].includes('@'), 'no email address in the shape line')
  assert.equal(typeof l.rows, 'number')
})

runFeature(join(ROOT, 'features', 'kiosk-cloud-wellness.feature'), R, () => new World())
