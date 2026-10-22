import test from 'node:test'
import assert from 'node:assert/strict'
import { world, handleBooking, post, EMAIL } from './state-world.mjs'

function observedWorld() {
  const w = world()
  w.deps.env.CARE_ROSTER_JSON = '[]'
  const calls = []
  const fakeFetch = w.deps.fetch
  w.deps.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    calls.push(`${init.method ?? 'GET'} ${url.hostname}${url.pathname}`)
    return fakeFetch(input, init)
  }
  return { ...w, calls }
}

test('ADMISSION01 the admitted synthetic booking sends one guest code without FacePhys effects', async () => {
  const w = observedWorld()
  const response = await handleBooking(post('/booking', { email: EMAIL }), w.deps)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'code_sent')
  assert.equal(w.calls.length, 3)
  assert.deepEqual([...w.calls].sort(), [
    'GET calendesk.invalid/admin/bookings/501',
    'GET calendesk.invalid/admin/bookings/v2',
    'POST mail.invalid/emails',
  ])
  assert.equal(w.effects.mail.length, 1)
  const mail = w.effects.mail[0]
  assert.deepEqual(mail.to, [EMAIL])
  assert.equal(Object.hasOwn(mail, 'cc'), false)
  assert.equal(Object.hasOwn(mail, 'bcc'), false)
  assert.match(mail.subject, /\b\d{6}\b/)
  assert.match(mail.text, /\b\d{6}\b/)
  assert.equal(w.effects.presign, 0)
  assert.equal(w.effects.upload, 0)
  assert.deepEqual(w.effects.process, [])
})

const deniedConfigurations = [
  {
    name: 'a valid active CARE roster in the original BDD shape',
    arrange: (deps) => {
      deps.env.CARE_ROSTER_JSON = JSON.stringify([
        { calendeskEmployeeId: 12, name: 'Aisyah', email: 'aisyah@example.com', outlets: ['krpm'], active: true },
      ])
    },
  },
  {
    name: 'a valid inactive CARE roster',
    arrange: (deps) => {
      deps.env.CARE_ROSTER_JSON = JSON.stringify([
        { calendeskEmployeeId: 12, name: 'Aisyah', email: 'aisyah@example.com', outlets: ['krpm'], active: false },
      ])
    },
  },
  {
    name: 'a missing upload pin',
    arrange: (deps) => { delete deps.env.FACEPHYS_UPLOAD_HOSTS },
  },
  {
    // Keith 10-22 admitted Alibaba Cloud: an exact OSS bucket host is a valid pin (tests/k10-alibaba-admission).
    // A bare Alibaba endpoint, with no bucket, is still not one exact storage host.
    name: 'a bare Aliyun endpoint pin',
    arrange: (deps) => { deps.env.FACEPHYS_UPLOAD_HOSTS = 'oss-ap-southeast-1.aliyuncs.com' },
  },
  {
    name: 'multiple otherwise admitted upload pins',
    arrange: (deps) => {
      deps.env.FACEPHYS_UPLOAD_HOSTS = 'synthetic-bucket.s3.amazonaws.com,second-synthetic-bucket.s3.amazonaws.com'
    },
  },
  {
    name: 'missing retention days',
    arrange: (deps) => { delete deps.env.CONSENT_RETENTION_DAYS },
  },
  {
    name: 'the wrong retention policy',
    arrange: (deps) => { deps.env.CONSENT_RETENTION_POLICY = 'other-retention-v1' },
  },
  {
    name: 'a missing state dependency',
    arrange: (deps) => { delete deps.state },
  },
  {
    name: 'the scan switch off',
    arrange: (deps) => { deps.env.SCANS_ENABLED = '0' },
  },
]

for (const { name, arrange } of deniedConfigurations) {
  test(`ADMISSION refuses ${name} before any injected request`, async () => {
    const w = observedWorld()
    arrange(w.deps)
    const response = await handleBooking(post('/booking', { email: EMAIL }), w.deps)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, 'CHECK_DISABLED')
    assert.equal(w.calls.length, 0)
    assert.deepEqual(w.effects.mail, [])
    assert.equal(w.effects.presign, 0)
    assert.equal(w.effects.upload, 0)
    assert.deepEqual(w.effects.process, [])
  })
}
