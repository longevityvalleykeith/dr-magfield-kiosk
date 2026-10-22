import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBooking } from '../lib/wellness/http.ts'
import { Brakes } from '../lib/wellness/limits.ts'
import { MemoryStateStore } from '../lib/wellness/state-memory.ts'

const EMAIL = 'synthetic@example.invalid'
const NOW = new Date('2026-10-19T04:00:00Z')
const env = {
  SCANS_ENABLED: '1',
  FACEPHYS_KEY_ID: 'test-only-fake-key',
  FACEPHYS_SECRET_KEY: 'test-only-fake-secret-no-provider',
  CALENDESK_API_KEY: 'test-only-fake-calendar',
  RESEND_API_KEY: 'test-only-fake-mail',
  CALENDESK_API_BASE: 'https://calendar.invalid',
  EMAIL_API_BASE: 'https://mail.invalid',
  FACEPHYS_UPLOAD_HOSTS: 'synthetic-bucket.s3.amazonaws.com',
  CONSENT_RETENTION_DAYS: '30',
  CONSENT_RETENTION_POLICY: 'dmk-30-days-v1',
}

const eligible = {
  id: 9021,
  status: 'approved',
  location: { id: 48, location_id: 6 },
  service_id: 16,
  employee_id: 4,
  start_date: '2026-10-19',
  starts_at: '2026-10-19T04:00:00Z',
  user: { email: EMAIL },
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

function world({ pages = [{ data: [eligible], last_page: 1 }], details = new Map([[9021, eligible]]), unavailable = [] } = {}) {
  const state = { lists: [], details: [], mail: [], events: [], unexpected: [] }
  const deps = {
    env,
    state: new MemoryStateStore(() => NOW),
    now: () => NOW,
    wait: async () => {},
    brakes: new Brakes(),
    log: (event, fields) => state.events.push({ event, fields }),
    fetch: async (input, init = {}) => {
      const url = new URL(String(input))
      if (url.origin === 'https://calendar.invalid' && (init.method ?? 'GET') === 'GET') {
        if (url.pathname === '/admin/bookings/v2') {
          const page = Number(url.searchParams.get('page'))
          state.lists.push(page)
          if (pages[page - 1]) return json(pages[page - 1])
        }
        const match = /^\/admin\/bookings\/(\d+)$/.exec(url.pathname)
        if (match) {
          const id = Number(match[1])
          state.details.push(id)
          if (unavailable.includes(id)) return json({}, 503)
          if (details.has(id)) return json({ data: details.get(id) })
        }
      }
      if (url.origin === 'https://mail.invalid' && url.pathname === '/emails' && init.method === 'POST') {
        state.mail.push(JSON.parse(init.body))
        return json({ id: 'synthetic-provider-acceptance' })
      }
      state.unexpected.push(`${init.method ?? 'GET'} ${url.origin}${url.pathname}`)
      throw new Error('Unexpected synthetic boundary')
    },
  }
  return { state, deps }
}

async function lookup(w) {
  const request = new Request('https://kiosk.invalid/api/wellness/booking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  })
  const response = await handleBooking(request, w.deps)
  const body = await response.json()
  assert.deepEqual(w.state.unexpected, [], 'The real handler crossed an unapproved synthetic boundary')
  return { response, body }
}

const changedDetails = [
  ['LA01 authoritative wrong outlet prevents code mail despite an eligible summary', { ...eligible, location: { id: 46, location_id: 5 } }],
  ['LA02 authoritative cancelled status prevents code mail despite an eligible summary', { ...eligible, status: 'cancelled' }],
  ['LA03 authoritative changed inbox prevents mail to either inbox despite an eligible summary', { ...eligible, user: { email: 'other-synthetic@example.invalid' } }],
  ['LA04 authoritative different local day prevents code mail despite an eligible summary', { ...eligible, start_date: '2026-10-20', starts_at: '2026-10-20T04:00:00Z' }],
]

for (const [name, full] of changedDetails) {
  test(name, async () => {
    const w = world({ details: new Map([[9021, full]]) })
    const { response, body } = await lookup(w)
    assert.equal(response.status, 200)
    assert.equal(body.status, 'code_sent')
    assert.equal(w.state.mail.length, 0, 'The stale summary caused a code mail without authoritative eligibility')
    assert.deepEqual(w.state.details, [9021], 'The matching active summary must be confirmed by ID before mail')
  })
}

test('LA05 missing list location with the same inbox is confirmed by detail and sends one code', async () => {
  const { location, ...summary } = eligible
  const w = world({ pages: [{ data: [summary], last_page: 1 }] })
  const { response, body } = await lookup(w)
  assert.equal(response.status, 200)
  assert.equal(body.status, 'code_sent')
  assert.deepEqual(w.state.details, [9021])
  assert.equal(w.state.mail.length, 1)
  assert.deepEqual(w.state.mail[0].to, [EMAIL])
})

test('LA06 only active summaries with the typed inbox are hydrated', async () => {
  const { location, ...summary } = eligible
  const unrelated = { ...summary, id: 9022, user: null }
  const otherInbox = { ...summary, id: 9023, user: { email: 'unrelated@example.invalid' } }
  const cancelled = { ...summary, id: 9024, status: 'cancelled' }
  const w = world({
    pages: [{ data: [unrelated, otherInbox, cancelled, summary], last_page: 1 }],
    details: new Map([[9021, eligible], [9022, unrelated], [9023, otherInbox], [9024, cancelled]]),
  })
  const { response } = await lookup(w)
  assert.equal(response.status, 200)
  assert.equal(w.state.mail.length, 1)
  assert.deepEqual(w.state.details, [9021], 'Unrelated or inactive summary rows must not trigger customer detail reads')
})

test('LA07 a page limit that leaves more pages fails unavailable rather than claiming no match', async () => {
  const pages = [1, 2, 3].map(page => ({
    data: [{ ...eligible, id: 9100 + page, user: { email: `unrelated-${page}@example.invalid` } }],
    last_page: 4,
  }))
  const w = world({ pages, details: new Map() })
  const { response, body } = await lookup(w)
  assert.equal(w.state.mail.length, 0)
  assert.equal(response.status, 503, 'An incomplete daily list was presented as a completed no-match lookup')
  assert.equal(body.code, 'BOOKING_UNAVAILABLE')
  assert.ok(w.state.lists.length <= 3, 'The daily-list request cap was exceeded')
})

test('LA08 a detail limit that leaves eligible candidates unread fails unavailable', async () => {
  const summaries = Array.from({ length: 26 }, (_, index) => {
    const { location, ...row } = eligible
    return { ...row, id: 9200 + index, starts_at: `2026-10-19T04:${String(index).padStart(2, '0')}:00Z` }
  })
  const details = new Map(summaries.map((row, index) => [row.id, {
    ...row,
    location: index === 25 ? eligible.location : { id: 46, location_id: 5 },
  }]))
  const w = world({ pages: [{ data: summaries, last_page: 1 }], details })
  const { response, body } = await lookup(w)
  assert.equal(w.state.mail.length, 0)
  assert.equal(response.status, 503, 'The read cap hid an unread eligible booking behind a completed no-match reply')
  assert.equal(body.code, 'BOOKING_UNAVAILABLE')
  assert.ok(w.state.details.length <= 25, 'The booking-detail request cap was exceeded')
})

test('LA09 unavailable authoritative detail prevents mail even when the summary is complete', async () => {
  const w = world({ unavailable: [9021] })
  const { response, body } = await lookup(w)
  assert.equal(w.state.mail.length, 0)
  assert.equal(response.status, 503, 'A code was issued without a successful authoritative read')
  assert.equal(body.code, 'BOOKING_UNAVAILABLE')
})

test('LA10 complete list without a same-inbox active candidate needs no customer detail reads', async () => {
  const rows = [
    { ...eligible, id: 9301, user: null },
    { ...eligible, id: 9302, user: { email: 'unrelated@example.invalid' } },
    { ...eligible, id: 9303, status: 'cancelled' },
  ]
  const w = world({ pages: [{ data: rows, last_page: 1 }], details: new Map(rows.map(row => [row.id, row])) })
  const { response, body } = await lookup(w)
  assert.equal(response.status, 200)
  assert.equal(body.status, 'code_sent')
  assert.equal(w.state.mail.length, 0)
  assert.deepEqual(w.state.details, [], 'A no-candidate lookup read unrelated customer records')
})

test('LA11 stale list outlet cannot override a same-inbox active authoritative eligible detail', async () => {
  const w = world({ pages: [{ data: [{ ...eligible, location: { id: 46, location_id: 5 } }], last_page: 1 }] })
  const { response } = await lookup(w)
  assert.equal(response.status, 200)
  assert.equal(w.state.mail.length, 1, 'A list-only outlet claim suppressed authoritative eligibility')
  assert.deepEqual(w.state.details, [9021])
  assert.deepEqual(w.state.mail[0].to, [EMAIL])
})
