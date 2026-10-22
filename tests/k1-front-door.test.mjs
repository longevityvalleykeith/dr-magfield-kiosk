/**
 * K1: the paused front door (T1 #173 ACK c.6344672196; Main #175 A2, BS-00). Keith 10-22: "commence K1… fix all 234567".
 *
 * - C2 / BS-00: while scans are paused, the arrival page says so truthfully and offers a way back to booking.
 *   It shows no OTP, consent, camera or result action.
 * - C4: arrivals from both QRs are counted (the kiosk's own `src=qr` and LV's 308 `src=lvqr`), so the
 *   10-19 §7.4 "retire the redirect at zero" metric can be read. A count only: no address, device or person.
 * - C7: /scan states its build (it read "unknown"), and loads no third-party fonts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
function* walk(dir) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) yield* walk(p); else yield p }
}

test('K1-01 BS-00: the paused message says "paused" and that the visit continues', async () => {
  const { MESSAGES } = await import('../lib/wellness/controller.ts')
  assert.match(MESSAGES.CHECK_PAUSED ?? '', /paused/i)
  assert.match(MESSAGES.CHECK_PAUSED ?? '', /visit continues as normal/i)
})

test('K1-02 BS-00: the way back to booking is LV\'s booking site by default, absolute https', async () => {
  const { readConfig } = await import('../lib/wellness/config.ts')
  assert.equal(readConfig({}).bookingUrl, 'https://book.longevityvalley.ai')
})

test('K1-03 BS-00: a booking-URL override must be https on longevityvalley.ai, otherwise the default stands', async () => {
  const { readConfig } = await import('../lib/wellness/config.ts')
  assert.equal(readConfig({ KIOSK_BOOKING_URL: 'https://book.longevityvalley.ai/krpm' }).bookingUrl, 'https://book.longevityvalley.ai/krpm')
  for (const bad of ['http://book.longevityvalley.ai', 'https://evil.example/book', 'https://longevityvalley.ai.evil.example', 'javascript:alert(1)', '//book.longevityvalley.ai']) {
    assert.equal(readConfig({ KIOSK_BOOKING_URL: bad }).bookingUrl, 'https://book.longevityvalley.ai', bad)
  }
})

test('K1-04 BS-00: the paused page renders the paused message and the booking link, and nothing else of the check', () => {
  const k = src('app/scan/Kiosk.tsx')
  const paused = k.slice(k.indexOf('if (!ready)'), k.indexOf('return (', k.indexOf('if (!ready)') + 12))
  assert.ok(paused.includes('MESSAGES.CHECK_PAUSED'), 'paused branch uses the paused message')
  assert.ok(paused.includes('href={bookingUrl}'), 'paused branch links back to booking')
  assert.ok(!/submitBooking|submitCode|acceptConsent|startScan|<video/.test(paused), 'no OTP, consent, camera or scan action while paused')
  assert.ok(src('app/scan/page.tsx').includes('bookingUrl={config.bookingUrl}'), 'the page passes the booking URL')
})

test('K1-05 C4: both QR arrivals are recognised; anything else is not counted', async () => {
  const { arrivalSource } = await import('../lib/wellness/arrival.ts')
  assert.equal(arrivalSource('qr'), 'qr')
  assert.equal(arrivalSource('lvqr'), 'lvqr')
  for (const other of [undefined, '', 'QR', 'lvqr ', 'evil', ['qr']]) assert.equal(arrivalSource(other), null, String(other))
})

test('K1-06 C4: /scan logs one count-only qr_open line carrying the arrival source', () => {
  const p = src('app/scan/page.tsx')
  assert.ok(p.includes('arrivalSource('), 'uses the shared recogniser')
  assert.match(p, /event: 'qr_open', src: arrival/)
})

test('K1-07 C7: the build stamp falls back to the runtime commit, so a dynamic page can state its build', async () => {
  const { buildIdentity } = await import('../lib/build-identity.ts')
  assert.equal(buildIdentity({ VERCEL_GIT_COMMIT_SHA: 'e49950422e68aaaa' }).BUILD_SHA12, 'e49950422e68')
  assert.equal(buildIdentity({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: '111111111111bbbb', VERCEL_GIT_COMMIT_SHA: '222222222222cccc' }).BUILD_SHA12, '111111111111')
})

test('K1-08 C7: the root layout names the commit variables literally, so Next inlines them at build', () => {
  const l = src('app/layout.tsx')
  assert.ok(l.includes('process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'), 'literal NEXT_PUBLIC reference')
  assert.ok(l.includes('process.env.VERCEL_GIT_COMMIT_SHA'), 'literal runtime fallback')
  assert.ok(!/buildIdentity\(process\.env\)/.test(l), 'no whole-object env read')
})

test('K1-09 C7: no third-party font host on the root layout or anywhere under /scan', () => {
  assert.ok(!src('app/layout.tsx').includes('fonts.googleapis.com'), 'root layout loads no Google Fonts')
  for (const f of walk(join(ROOT, 'app', 'scan'))) assert.ok(!readFileSync(f, 'utf8').includes('fonts.g'), f)
  assert.ok(src('app/page.tsx').includes('fonts.googleapis.com'), 'the standee keeps its own typefaces')
})
