/**
 * K12b: Main's post-merge fix-forward on kiosk #12 (T1 #175 §27; kiosk #12 c. 23:06Z, merged 14145c0b).
 *
 * - F1 (P2): the slow three-page success path is exercised in real time against the route's own maxDuration.
 * - F2 (P3): the eligibility refusal checks release_code's reply, as the Calendesk-unavailable path does.
 * - F3 (P3): code-entry precedence matches begin_check's: a held booking (CHECK_PENDING) outranks the cap.
 * - F4 (P3): a denied attempt whose release is unacknowledged stays held; the eligibility read is proven
 *   read-only by executing it against the store, not only by reading the SQL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { world, challenge, attempt, scanRequest, post, json, EMAIL, NOW, UPLOAD_HOST, handleVerify, handleScan } from './state-world.mjs'
import { VERIFY_HEADROOM_MS } from '../lib/wellness/http.ts'
import { RPC_TIMEOUT_MS } from '../lib/wellness/state-rpc.ts'
import { CALENDESK_TIMEOUT_MS, CALENDESK_LIST_PAGES } from '../lib/wellness/calendesk.ts'
import { Brakes } from '../lib/wellness/limits.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const routeMs = Number(readFileSync(join(ROOT, 'app/api/wellness/verify/route.ts'), 'utf8').match(/export const maxDuration = (\d+)/)[1]) * 1000
const MIN = 60_000
const kinds = (w) => w.effects.events.map((e) => `${e.kind}:${e.reply}`)
const delay = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')) }, { once: true })
})

test('F1 P2: the slow three-page correct-code path finishes inside the route limit, less its headroom', async () => {
  const w = world()
  const c = await challenge(w)
  // Every Calendesk call and every state call runs just under its own deadline; the booking is on the last page.
  const slowCalendesk = CALENDESK_TIMEOUT_MS - 200
  const slowRpc = RPC_TIMEOUT_MS - 200
  const row = { id: 501, status: 'approved', location: { location_id: 6, id: 44 }, service_id: 8, employee_id: null, start_date: '2026-10-19', user: { email: EMAIL } }
  const other = (id) => ({ ...row, id, user: { email: `other${id}@example.invalid` } })
  const calls = { list: 0, detail: 0 }
  // Fresh brakes: the lookup's cached day list would otherwise skip the slow pages.
  const deps = { ...w.deps, brakes: new Brakes(),
    state: { transition: async (cmd) => { await delay(slowRpc); return w.deps.state.transition(cmd) } },
    fetch: async (input, init = {}) => {
      const u = new URL(String(input))
      if (u.hostname !== 'calendesk.invalid') return w.deps.fetch(input, init)
      await delay(slowCalendesk, init.signal)
      if (u.pathname.endsWith('/v2')) {
        calls.list++
        const page = Number(u.searchParams.get('page'))
        return json({ data: page === CALENDESK_LIST_PAGES ? [row] : [other(600 + page)], last_page: CALENDESK_LIST_PAGES, current_page: page })
      }
      calls.detail++
      return json({ data: row })
    } }
  const started = Date.now()
  const r = await handleVerify(post('/verify', c), deps)
  const elapsed = Date.now() - started
  const body = await r.json()
  assert.equal(r.status, 200, `slow path refused: ${body.code}`)
  assert.equal(body.status, 'matched')
  assert.equal(calls.list, CALENDESK_LIST_PAGES, 'every list page was read')
  assert.equal(calls.detail, 1)
  assert.ok(kinds(w).includes('consume_code:consumed'))
  assert.ok(elapsed >= CALENDESK_LIST_PAGES * slowCalendesk + slowCalendesk + 3 * slowRpc, `the slow path was not exercised (${elapsed} ms)`)
  assert.ok(elapsed + VERIFY_HEADROOM_MS <= routeMs, `${elapsed} ms + ${VERIFY_HEADROOM_MS} ms headroom exceeds the ${routeMs} ms route limit`)
})

for (const refusal of ['capped', 'unavailable']) {
  test(`F2 P3: an unacknowledged code release on the ${refusal} eligibility refusal is noticed and logged`, async () => {
    const w = world()
    if (refusal === 'capped') { for (let i = 0; i < 2; i++) assert.equal((await handleScan(scanRequest(await attempt(w)), w.deps)).status, 200) }
    const logs = []
    const inner = w.deps.state
    const deps = { ...w.deps, log: (event) => logs.push(event), state: { transition: async (cmd) => {
      if (cmd.kind === 'release_code') return { kind: 'unavailable' }
      if (cmd.kind === 'check_eligibility' && refusal === 'unavailable') return { kind: 'unavailable' }
      return inner.transition(cmd)
    } } }
    const r = await handleVerify(post('/verify', await challenge(w)), deps)
    assert.equal((await r.json()).code, refusal === 'capped' ? 'BOOKING_ALREADY_CHECKED' : 'STATE_UNAVAILABLE', 'the reply stays truthful')
    assert.ok(logs.includes('code_release_unacknowledged'), 'the release reply was ignored')
  })
}

test('F3 P3: at code entry a held booking at its cap answers CHECK_PENDING, the same order begin_check uses', async () => {
  const w = world()
  assert.equal((await handleScan(scanRequest(await attempt(w)), w.deps)).status, 200)
  w.effects.processMode = 'unknown'
  assert.equal((await handleScan(scanRequest(await attempt(w)), w.deps)).status, 202)
  const r = await handleVerify(post('/verify', await challenge(w)), w.deps)
  assert.equal(r.status, 409)
  assert.equal((await r.json()).code, 'CHECK_PENDING', 'the unreconciled check outranks the cap, as at submit')
  assert.ok(kinds(w).includes('check_eligibility:pending'))
})

test('F3 P3: a held booking under its cap still verifies (RT04); begin_check then answers CHECK_PENDING', async () => {
  const w = world()
  w.effects.processMode = 'unknown'
  assert.equal((await handleScan(scanRequest(await attempt(w)), w.deps)).status, 202)
  const token = await attempt(w)
  assert.equal((await (await handleScan(scanRequest(token), w.deps)).json()).code, 'CHECK_PENDING')
})

test('F4 P3: a denied attempt whose release is unacknowledged stays held and is never processed', async () => {
  const w = world()
  const token = await attempt(w)
  const inner = w.deps.state
  const deps = { ...w.deps,
    state: { transition: async (cmd) => (cmd.kind === 'release_check' ? { kind: 'unavailable' } : inner.transition(cmd)) },
    fetch: async (input, init) => {
      if (new URL(String(input)).hostname === UPLOAD_HOST) w.setNow(new Date(NOW.getTime() + 16 * MIN))
      return w.deps.fetch(input, init)
    } }
  const r = await handleScan(scanRequest(token), deps)
  assert.ok(kinds(w).includes('authorize_process:stale'), 'authorization was definitely denied')
  assert.equal(r.status, 202, 'an unacknowledged release is an unknown outcome')
  assert.equal(w.effects.process.length, 0)
  assert.equal((await (await handleScan(scanRequest(await attempt(w)), w.deps)).json()).code, 'CHECK_PENDING', 'the booking stays held')
})

test('F4 P3: check_eligibility is executed against the store and leaves every row unchanged', async () => {
  const w = world()
  await attempt(w)
  assert.equal((await handleScan(scanRequest(await attempt(w)), w.deps)).status, 200)
  const store = w.shared
  const snap = () => JSON.stringify(store, (_, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : typeof v === 'function' ? undefined : v))
  const [dayRef] = [...store.days.keys()]
  const before = snap()
  for (const ref of [dayRef, 'f'.repeat(64)]) {
    for (let i = 0; i < 5; i++) assert.equal((await store.transition({ kind: 'check_eligibility', dayRef: ref, day: '2026-10-19' })).kind, 'granted')
  }
  assert.equal(snap(), before, 'an eligibility read changed the store')
  assert.equal(store.days.has('f'.repeat(64)), false, 'an eligibility read created a day')
})
