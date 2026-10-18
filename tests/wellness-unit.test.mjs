/**
 * Wellness check: the pure laws, held without a browser or a vendor.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { signedHeaders, normalizeUploadUrl } from '../lib/wellness/facephys.ts'
import { normalizeResult, keyPaths } from '../lib/wellness/result.ts'
import { matchBooking, localDay, bookingDay } from '../lib/wellness/match.ts'
import { parseBooking } from '../lib/wellness/calendesk.ts'
import { parseRoster, careRecipientFor } from '../lib/wellness/roster.ts'
import { readConfig, isReady } from '../lib/wellness/config.ts'
import { issueDevice, deviceIdFrom, issueAttempt, readAttempt, emailHash, enrollCodeMatches } from '../lib/wellness/tokens.ts'
import { composeResultEmail } from '../lib/wellness/email.ts'
import { isMp4, mask } from '../lib/wellness/http.ts'

const SECRET = 'cookie-secret-for-tests-0123456789abcdef'
const outlet = { slug: 'krpm', name: 'DR MAGfield KRPM', locationId: 6, serviceIds: [13, 14], timeZone: 'Asia/Kuala_Lumpur' }

test('FacePhys signing is Base64(HMAC-SHA256(secret, unix-seconds)) with the documented headers', () => {
  const h = signedHeaders({ baseUrl: 'https://x.test', keyId: 'kid', secretKey: 's3cret' }, 1_760_000_000_999)
  assert.equal(h['x-key-id'], 'kid')
  assert.equal(h['x-timestamp'], '1760000000')
  assert.equal(h['x-signature'], createHmac('sha256', 's3cret').update('1760000000').digest('base64'))
  assert.ok(!JSON.stringify(h).includes('s3cret'), 'the secret itself is never sent')
})

test('upload URL: %2F is restored in the path only; the signed query stays byte-exact', () => {
  assert.equal(normalizeUploadUrl('https://o.test/a%2Fb.mp4?Sig=x%2Fy'), 'https://o.test/a/b.mp4?Sig=x%2Fy')
  assert.equal(normalizeUploadUrl('https://o.test/a%2fb.mp4'), 'https://o.test/a/b.mp4')
})

test('results: only the four admitted indicators survive; everything else FacePhys returns is dropped', () => {
  const r = normalizeResult({ data: { heartRate: 71.6, hrv: { rmssd: 40.2, sdnn: 52 }, breathingRate: 15, sqi: 0.8, spo2: 97, bp: { systolic: 120 }, age: 40, emotion: 'calm' } }, 0.5)
  assert.equal(r.kind, 'completed')
  assert.deepEqual(r.indicators.map((i) => [i.key, i.value]), [['heart_rate', 72], ['hrv_rmssd', 40], ['hrv_sdnn', 52], ['breathing_rate', 15]])
})

test('results: poor quality, a missing heart rate or an implausible value never becomes a reading', () => {
  assert.equal(normalizeResult({ heartRate: 72, sqi: 0.3 }, 0.5).kind, 'insufficient_quality')
  assert.equal(normalizeResult({ heartRate: 72, confidence: 30 }, 0.5).kind, 'insufficient_quality', '0–100 scale is normalised')
  assert.equal(normalizeResult({ rmssd: 40 }, 0.5).kind, 'insufficient_quality')
  assert.equal(normalizeResult({ heartRate: 400 }, 0.5).kind, 'insufficient_quality')
  assert.equal(normalizeResult(null, 0.5).kind, 'insufficient_quality')
  assert.equal(normalizeResult({ heartRate: { value: 66 } }, 0.5).kind, 'completed')
})

test('result shape is logged as key paths only, never values', () => {
  const paths = keyPaths({ result: { heartRate: 72, hrv: { rmssd: 41 } } })
  assert.deepEqual(paths, ['result', 'result.heartRate', 'result.hrv', 'result.hrv.rmssd'])
  assert.ok(!JSON.stringify(paths).includes('72'))
})

test('Calendesk booking parsing reads the admin fields and the nested customer email, nothing else', () => {
  const b = parseBooking({ data: { id: 501, status: 'Approved', location: { location_id: 6 }, service_id: 13, employee_id: 12, start_date: '2026-10-20', starts_at: '2026-10-20 10:30:00', user: { email: ' Guest@Example.com ', name: 'Name', default_phone: { e164: '+60' } }, control: 'cancel-credential' } })
  assert.deepEqual(b, { id: 501, status: 'approved', locationId: 6, serviceId: 13, employeeId: 12, startDate: '2026-10-20', startsAt: '2026-10-20 10:30:00', customerEmail: 'guest@example.com' })
  assert.equal(parseBooking({ data: { status: 'approved' } }), null)
})

test('the day comes from Kuala Lumpur time, not UTC', () => {
  assert.equal(localDay(new Date('2026-10-19T17:30:00Z'), 'Asia/Kuala_Lumpur'), '2026-10-20')
  assert.equal(bookingDay({ startDate: null, startsAt: '2026-10-20T01:00:00+08:00' }, 'Asia/Kuala_Lumpur'), '2026-10-20')
})

test('entity matching lists every reason a booking is refused', () => {
  const booking = { id: 9, status: 'payment', locationId: 7, serviceId: 1, employeeId: 12, startDate: '2026-10-19', startsAt: null, customerEmail: 'a@b.co' }
  const m = matchBooking({ booking, typedEmail: 'x@y.co', outlet, roster: [], now: new Date('2026-10-20T02:00:00Z') })
  assert.equal(m.ok, false)
  assert.deepEqual(m.reasons, ['WRONG_OUTLET', 'WRONG_SERVICE', 'NOT_TODAY', 'BOOKING_NOT_ACTIVE', 'EMAIL_MISMATCH'])
})

test('the CARE recipient is the booking’s own employee, active at this outlet, never a substitute', () => {
  const roster = parseRoster(JSON.stringify([
    { calendeskEmployeeId: 12, name: 'A', email: 'a@x.co', outlets: ['krpm'], active: true },
    { calendeskEmployeeId: 13, name: 'B', email: 'b@x.co', outlets: ['other'], active: true },
    { calendeskEmployeeId: 14, name: 'C', email: 'not-an-email', outlets: ['krpm'], active: true },
  ]))
  assert.equal(roster.length, 2, 'an entry without a valid email is dropped')
  assert.equal(careRecipientFor(roster, 12, 'krpm')?.name, 'A')
  assert.equal(careRecipientFor(roster, 13, 'krpm'), null, 'wrong outlet')
  assert.equal(careRecipientFor(roster, 99, 'krpm'), null, 'unknown employee is not replaced')
  assert.equal(careRecipientFor(roster, null, 'krpm'), null)
  assert.deepEqual(parseRoster('not json'), [])
})

test('the check is off unless switched on AND fully configured', () => {
  assert.equal(isReady(readConfig({})), false)
  assert.equal(isReady(readConfig({ SCANS_ENABLED: '1' })), false)
  const c = readConfig({})
  assert.equal(c.facephys, null)
  assert.equal(c.outlet.locationId, 6)
  assert.deepEqual(c.outlet.serviceIds, [13, 14])
  assert.equal(c.scanSeconds, 20)
})

test('device cookie and attempt token refuse tampering, expiry and a swapped email', () => {
  const now = 1_000_000
  const dev = issueDevice(SECRET, now)
  assert.match(dev.header, /^__Host-dmk-device=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/)
  assert.ok(deviceIdFrom(SECRET, `a=b; __Host-dmk-device=${dev.value}`, now + 1))
  assert.equal(deviceIdFrom(SECRET, `__Host-dmk-device=${dev.value}x`, now + 1), null)
  assert.equal(deviceIdFrom('another-secret-another-secret-0000000', `__Host-dmk-device=${dev.value}`, now + 1), null)
  assert.equal(deviceIdFrom(SECRET, `__Host-dmk-device=${dev.value}`, now + 31 * 24 * 3600 * 1000), null)
  const t = issueAttempt(SECRET, { bookingId: 501, emailHash: emailHash(SECRET, 'g@x.co'), careEmployeeId: 12 }, now)
  const a = readAttempt(SECRET, t.token, now + 1)
  assert.equal(a.attemptId, t.attemptId)
  assert.equal(a.bookingId, 501)
  assert.notEqual(a.emailHash, emailHash(SECRET, 'other@x.co'))
  assert.equal(readAttempt(SECRET, t.token, now + 16 * 60 * 1000), null)
  assert.ok(enrollCodeMatches('code-1234567890abcdef', 'code-1234567890abcdef'))
  assert.equal(enrollCodeMatches('code-1234567890abcdef', 'code-1234567890abcdeX'), false)
  assert.equal(enrollCodeMatches('code-1234567890abcdef', 42), false)
})

test('the email escapes HTML, names the CC and carries the wellness disclaimer', () => {
  const m = composeResultEmail({ ccName: '<b>Aisyah</b>', outletName: 'DR MAGfield KRPM', when: new Date('2026-10-20T02:00:00Z'), timeZone: 'Asia/Kuala_Lumpur', indicators: [{ key: 'heart_rate', label: 'Heart rate', unit: 'bpm', value: 72 }], consentVersion: 'v1', reference: 'abcd1234' })
  assert.ok(m.html.includes('&lt;b&gt;Aisyah&lt;/b&gt;'))
  assert.ok(!m.html.includes('<b>Aisyah</b>'))
  assert.ok(m.text.includes('wellness indicator, not a medical measurement'))
  assert.ok(m.text.includes('Heart rate: 72 bpm'))
  assert.ok(m.text.includes('reply'), 'the CC email warns that replies reach everyone')
})

test('only an ISO-BMFF ("ftyp") file counts as mp4; masking hides the address', () => {
  assert.equal(isMp4(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])), true)
  assert.equal(isMp4(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), false, 'webm is refused')
  assert.equal(mask('guest@example.com'), 'g•••@example.com')
})
