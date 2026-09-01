/**
 * Lane K · EV-17 / EV-1 / EV-8 — the standee's laws, held without a browser.
 *
 * These assert on pure functions so a failure names the law, not a render.
 *   EV-1  one doorway   — the QR destination is the governed scan landing
 *   EV-17 honest        — no localhost default anywhere; status endpoint env-only
 *   EV-8  money fenced  — the rabbit-cup rail is off unless the deploy says so
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOORWAY_URL_CANON,
  LADDER,
  resolveDoorwayUrl,
  resolveStatusEndpoint,
  rabbitCupEnabled,
  isLoopbackHost,
  whatsappUrl,
  ARIE_WHATSAPP,
} from '../lib/standee.ts'

// ── EV-1 · one doorway ───────────────────────────────────────────────
test('EV-1: the canon doorway is the governed scan landing', () => {
  assert.equal(DOORWAY_URL_CANON, 'https://app.longevityvalley.ai/scan/dr-magfield/krpm')
})

test('EV-1: an unset environment still yields the canon doorway', () => {
  assert.equal(resolveDoorwayUrl({}), DOORWAY_URL_CANON)
  assert.equal(resolveDoorwayUrl(), DOORWAY_URL_CANON)
  assert.equal(resolveDoorwayUrl({ NEXT_PUBLIC_DOORWAY_URL: '' }), DOORWAY_URL_CANON)
  assert.equal(resolveDoorwayUrl({ NEXT_PUBLIC_DOORWAY_URL: '   ' }), DOORWAY_URL_CANON)
})

test('EV-1: the QR never points at Telegram', () => {
  assert.ok(!DOORWAY_URL_CANON.includes('t.me'))
  assert.ok(!DOORWAY_URL_CANON.includes('DrMAGfield_Bot'))
})

test('EV-1: an https override is honoured verbatim', () => {
  const staging = 'https://staging.longevityvalley.ai/scan/dr-magfield/krpm'
  assert.equal(resolveDoorwayUrl({ NEXT_PUBLIC_DOORWAY_URL: staging }), staging)
})

// ── EV-17 · no loopback can ever be the doorway ──────────────────────
test('EV-17: loopback hosts are recognised', () => {
  for (const h of ['localhost', 'LOCALHOST', 'api.localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(h), true, `${h} should be loopback`)
  }
  for (const h of ['app.longevityvalley.ai', 'example.com', '10.0.0.1']) {
    assert.equal(isLoopbackHost(h), false, `${h} should not be loopback`)
  }
})

test('EV-17: a loopback or non-https override is refused, and the canon stands', () => {
  const refused = [
    'http://localhost:3100',
    'https://localhost:3100/scan',
    'https://127.0.0.1/scan',
    'http://app.longevityvalley.ai/scan/dr-magfield/krpm',
    'not-a-url',
    'javascript:alert(1)',
  ]
  for (const raw of refused) {
    assert.equal(resolveDoorwayUrl({ NEXT_PUBLIC_DOORWAY_URL: raw }), DOORWAY_URL_CANON, `${raw} must be refused`)
  }
})

// ── EV-17 · the status endpoint is env-only, absence is honest ───────
test('EV-17: no status endpoint configured means null, never a localhost guess', () => {
  assert.equal(resolveStatusEndpoint({}), null)
  assert.equal(resolveStatusEndpoint(), null)
  assert.equal(resolveStatusEndpoint({ NEXT_PUBLIC_STANDEE_STATUS_URL: '' }), null)
})

test('EV-17: a loopback or non-https status endpoint is refused', () => {
  for (const raw of ['http://localhost:3100/api/banner', 'https://localhost:3100/x', 'http://example.com/x', 'nope']) {
    assert.equal(resolveStatusEndpoint({ NEXT_PUBLIC_STANDEE_STATUS_URL: raw }), null, `${raw} must be refused`)
  }
})

test('EV-17: a real https status endpoint is returned verbatim', () => {
  const url = 'https://app.longevityvalley.ai/api/o2o/venue-status?outlet=krpm'
  assert.equal(resolveStatusEndpoint({ NEXT_PUBLIC_STANDEE_STATUS_URL: url }), url)
})

// ── EV-8 · the money rail is off by default ──────────────────────────
test('EV-8: rabbit-cup is off unless the deployment says the exact word', () => {
  assert.equal(rabbitCupEnabled({}), false)
  assert.equal(rabbitCupEnabled(), false)
  for (const v of ['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true ']) {
    assert.equal(rabbitCupEnabled({ NEXT_PUBLIC_RABBIT_CUP_ENABLED: v }), false, `${JSON.stringify(v)} must not enable it`)
  }
  assert.equal(rabbitCupEnabled({ NEXT_PUBLIC_RABBIT_CUP_ENABLED: 'true' }), true)
})

// ── canon ladder · price is canon, session counts are not printed ────
test('the ladder is the canon three, each carrying its SKU', () => {
  assert.deepEqual(LADDER.map((r) => r.price), ['RM65', 'RM325', 'RM1500'])
  assert.deepEqual(LADDER.map((r) => r.sku), ['DRM-SINGLE-60', 'DRM-PKG5', 'DRM-PKG7'])
})

test('the ladder prints no package session count (T1 AMB-1 is unresolved)', () => {
  // RM325 is 5 (served landing / engine fixtures) vs 6 (partnership canon 5+1);
  // RM1500 is 7 vs 7+1. A standee must not pick a side, so it prints neither.
  for (const row of LADDER.filter((r) => r.sku !== 'DRM-SINGLE-60')) {
    assert.ok(!/\d+\s*(session|sessions|x\d)/i.test(row.label), `${row.sku} label must not claim a session count: ${row.label}`)
  }
})

// ── the one WhatsApp line ────────────────────────────────────────────
test('the WhatsApp line is the public business number and nothing else', () => {
  assert.equal(ARIE_WHATSAPP, '60126595319')
  assert.ok(whatsappUrl('Hi Arie').startsWith('https://wa.me/60126595319?text='))
  assert.ok(!whatsappUrl('a b').includes(' '), 'the message must be url-encoded')
})
