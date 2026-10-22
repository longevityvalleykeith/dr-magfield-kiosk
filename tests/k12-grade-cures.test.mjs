/**
 * K12: the cures Main and Astra require on kiosk PR #12 at 038aa5c9 (T1 #175 §11.3, #173 c.6350118848; Astra 98afb52a).
 *
 * - P2 r4352455647: a definite authorization denial ("stale") releases the reservation through the owner- and
 *   phase-guarded release_check. Only a missing acknowledgement (or any reply that is not a definite answer) stays held.
 * - P2 r4352455663: verification has an admitted route duration whose serial sub-budgets fit with cleanup headroom.
 * - K-29 (Main: RESTORE): an exhausted booking is refused at code entry by a read-only eligibility check, so no
 *   consent screen, camera or video upload happens. The atomic cap at begin_check stays as the race barrier (K-30).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { world, challenge, attempt, scanRequest, post, UPLOAD_HOST, NOW, handleVerify, handleScan } from './state-world.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const MIN = 60_000
const kinds = (w) => w.effects.events.map((e) => `${e.kind}:${e.reply}`)

async function completeOne(w) {
  const r = await handleScan(scanRequest(await attempt(w)), w.deps)
  assert.equal(r.status, 200, 'a check completes')
}

test('K12-01 P2: a definite authorization denial releases the reservation, so the booking is not held', async () => {
  const w = world()
  const token = await attempt(w)
  // The 15-minute ready window passes during the upload, so authorize_process answers a definite "stale".
  const late = { ...w.deps, fetch: async (input, init) => {
    if (new URL(String(input)).hostname === UPLOAD_HOST) w.setNow(new Date(NOW.getTime() + 16 * MIN))
    return w.deps.fetch(input, init)
  } }
  const r = await handleScan(scanRequest(token), late)
  const body = await r.json()
  assert.ok(kinds(w).includes('authorize_process:stale'), 'the store definitely refused authorization')
  assert.equal(w.effects.process.length, 0, 'no process request after a denial')
  assert.ok(kinds(w).includes('release_check:released'), 'the denied reservation is released through the guarded path')
  assert.notEqual(r.status, 202, 'a definite denial is not an unknown outcome')
  assert.equal(body.code, 'ATTEMPT_INVALID')
  // The booking-day is free again: a fresh attempt is admitted and charged once.
  const again = await handleScan(scanRequest(await attempt(w)), w.deps)
  assert.equal(again.status, 200, 'the booking was left held after a definite denial')
  assert.equal(w.effects.process.length, 1)
})

for (const lost of ['unavailable', 'invalid', 'throw']) {
  test(`K12-02 P2: a missing authorization acknowledgement (${lost}) stays held and is never released`, async () => {
    const w = world()
    const token = await attempt(w)
    const inner = w.deps.state
    const deps = { ...w.deps, state: { transition: async (c) => {
      const reply = await inner.transition(c)
      if (c.kind !== 'authorize_process') return reply
      if (lost === 'throw') throw new Error('synthetic transport loss')
      return { kind: lost }
    } } }
    const r = await handleScan(scanRequest(token), deps)
    assert.equal(r.status, 202, 'a lost acknowledgement is an unknown outcome')
    assert.equal(w.effects.process.length, 0)
    assert.ok(!kinds(w).some((k) => k.startsWith('release_check')), 'a lost acknowledgement must not be released')
    const next = await handleScan(scanRequest(await attempt(w)), w.deps)
    assert.equal((await next.json()).code, 'CHECK_PENDING', 'the booking stays held for reconciliation')
  })
}

test('K12-03 P2: verification has an admitted duration that fits its serial calls plus cleanup headroom', async () => {
  const { RPC_TIMEOUT_MS } = await import('../lib/wellness/state-rpc.ts')
  const { CALENDESK_TIMEOUT_MS, CALENDESK_LIST_PAGES } = await import('../lib/wellness/calendesk.ts')
  const { VERIFY_HEADROOM_MS } = await import('../lib/wellness/http.ts')
  for (const n of [RPC_TIMEOUT_MS, CALENDESK_TIMEOUT_MS, CALENDESK_LIST_PAGES, VERIFY_HEADROOM_MS]) assert.ok(Number.isSafeInteger(n) && n > 0)
  const route = src('app/api/wellness/verify/route.ts').match(/export const maxDuration = (\d+)/)
  assert.ok(route, 'the verify route declares maxDuration')
  const routeMs = Number(route[1]) * 1000
  // Serial worst case on a correct code: claim → list pages → parallel detail reads → eligibility → consume or release.
  const serial = RPC_TIMEOUT_MS + CALENDESK_LIST_PAGES * CALENDESK_TIMEOUT_MS + CALENDESK_TIMEOUT_MS + RPC_TIMEOUT_MS + RPC_TIMEOUT_MS
  assert.ok(VERIFY_HEADROOM_MS >= 3_000, 'at least 3 s are kept for overhead and serialization')
  assert.ok(serial + VERIFY_HEADROOM_MS <= routeMs, `serial ${serial} ms + headroom ${VERIFY_HEADROOM_MS} ms exceeds the ${routeMs} ms route limit`)
  assert.ok(routeMs <= 60_000, 'no wellness route is admitted above the scan route\'s 60 s')
  // The budget reads the real deadlines: Calendesk calls take theirs from the one constant.
  assert.ok(!/AbortSignal\.timeout\(\d/.test(src('lib/wellness/calendesk.ts')), 'a Calendesk deadline is a bare literal')
  assert.ok(/AbortSignal\.timeout\(CALENDESK_TIMEOUT_MS\)/.test(src('lib/wellness/calendesk.ts')))
  assert.ok(/page <= CALENDESK_LIST_PAGES/.test(src('lib/wellness/calendesk.ts')), 'the list reads at most the budgeted pages')
})

test('K12-04 K-29: an exhausted booking is refused at code entry, before consent, camera or upload', async () => {
  const w = world()
  await completeOne(w)
  await completeOne(w)
  const before = { presign: w.effects.presign, upload: w.effects.upload, events: w.effects.events.length }
  const r = await handleVerify(post('/verify', await challenge(w)), w.deps)
  const body = await r.json()
  assert.equal(r.status, 409)
  assert.equal(body.code, 'BOOKING_ALREADY_CHECKED')
  assert.equal(body.attemptToken, undefined, 'no attempt is issued, so no consent screen or camera can follow')
  const after = kinds(w).slice(before.events)
  assert.ok(after.includes('check_eligibility:capped'), 'the read-only eligibility check refused it')
  assert.ok(!after.some((k) => k.startsWith('consume_code') || k.startsWith('begin_check')), 'nothing was consumed or begun')
  assert.equal(w.effects.presign, before.presign)
  assert.equal(w.effects.upload, before.upload)
})

test('K12-05 K-29: the eligibility check is read-only and only answers granted or capped', async () => {
  const { parseStateCommand, parseStateReply } = await import('../lib/wellness/state-validation.ts')
  const dayRef = 'a'.repeat(64)
  const cmd = { kind: 'check_eligibility', dayRef, day: '2026-10-19' }
  assert.deepEqual(parseStateCommand(cmd), cmd)
  assert.equal(parseStateCommand({ ...cmd, owner: '00000000-0000-4000-8000-000000000000' }), null, 'extra keys are refused')
  assert.deepEqual(parseStateReply('check_eligibility', { kind: 'granted' }), { kind: 'granted' })
  assert.deepEqual(parseStateReply('check_eligibility', { kind: 'capped' }), { kind: 'capped' })
  for (const k of ['consumed', 'authorized', 'pending', 'released']) assert.equal(parseStateReply('check_eligibility', { kind: k }), null, k)
  // Asking twice changes nothing: two checks still complete afterwards, and a third is then refused.
  const w = world()
  await attempt(w)
  await attempt(w)
  await completeOne(w)
  await completeOne(w)
  assert.equal(w.effects.process.length, 2)
  // The proposed SQL branch reads without locking or writing.
  const sql = src('docs/proposals/kiosk_wellness_state.sql')
  assert.match(sql, /when 'check_eligibility' then array\['kind','dayRef','day'\]/)
  const start = sql.indexOf("if v_kind = 'check_eligibility' then")
  assert.ok(start > 0, 'the SQL proposal has a check_eligibility branch')
  const branch = sql.slice(start, sql.indexOf('end if;\n\n', start))
  assert.ok(!/\b(update|insert|delete)\b|for update/i.test(branch), 'the eligibility branch must not write or lock')
})

test('K12-06 K-29: an unavailable eligibility answer refuses verification and keeps the code usable', async () => {
  const w = world()
  const c = await challenge(w)
  const inner = w.deps.state
  let down = true
  const deps = { ...w.deps, state: { transition: async (cmd) => (down && cmd.kind === 'check_eligibility' ? { kind: 'unavailable' } : inner.transition(cmd)) } }
  const r = await handleVerify(post('/verify', c), deps)
  assert.equal(r.status, 503)
  assert.equal((await r.json()).code, 'STATE_UNAVAILABLE')
  assert.ok(!kinds(w).some((k) => k.startsWith('consume_code')), 'the code was not consumed')
  down = false
  assert.equal((await handleVerify(post('/verify', c), deps)).status, 200, 'the same code works once state is back')
})
