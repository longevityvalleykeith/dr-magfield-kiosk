/**
 * Lane K · EV-8 — the pre-K-1 money rail is fenced in the SERVED artifact.
 *
 * `rabbitCupEnabled()` returning false is not the acceptance criterion; the
 * audit's F is "unset flag → the checkout is reachable → RED". So this reads
 * what the build actually serves with the flag unset: the prerendered HTML a
 * guest receives, and the JS chunk their phone downloads.
 *
 * The code is quarantined, not deleted — retire vs quarantine is Keith's
 * door S-C.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARIE_WHATSAPP } from '../lib/standee.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = (...p) => {
  const file = join(ROOT, '.next', 'server', 'app', ...p)
  assert.ok(existsSync(file), `no prerendered page at ${file} — run "npm run build" first`)
  return readFileSync(file, 'utf8')
}
const chunks = (...p) => {
  const dir = join(ROOT, '.next', 'static', 'chunks', 'app', ...p)
  assert.ok(existsSync(dir), `no chunk dir at ${dir} — run "npm run build" first`)
  const names = readdirSync(dir).filter((f) => /^page-.*\.js$/.test(f))
  assert.ok(names.length > 0, `no page-*.js in ${dir}`)
  return names.map((name) => ({ name, src: readFileSync(join(dir, name), 'utf8') }))
}
const count = (haystack, needle) => haystack.split(needle).length - 1

test('EV-8: with the flag unset, /rabbit-cup serves a plain not-available page', () => {
  const page = html('rabbit-cup.html')
  assert.match(page, /not available/i, 'the served page does not say it is not available')
  assert.ok(page.includes(ARIE_WHATSAPP), 'the not-available page must still carry the WhatsApp line')
})

test('EV-8: with the flag unset, the served /rabbit-cup carries no register or checkout path', () => {
  const page = html('rabbit-cup.html')
  for (const needle of ['rabbit-cup/register', 'consent_acknowledged', 'checkout']) {
    assert.equal(count(page, needle), 0, `the served page still carries "${needle}"`)
  }
})

test('EV-8: the register endpoint is not in the chunk the phone downloads', () => {
  for (const { name, src } of chunks('rabbit-cup')) {
    assert.equal(count(src, 'rabbit-cup/register'), 0, `${name} still embeds the register endpoint`)
    assert.equal(count(src, 'consent_acknowledged'), 0, `${name} still embeds the register payload`)
  }
})

test('EV-8: with the flag unset, /rabbit-cup/success serves the not-available page too', () => {
  const page = html('rabbit-cup', 'success.html')
  assert.match(page, /not available/i, 'the served success page does not say it is not available')
  for (const { name, src } of chunks('rabbit-cup', 'success')) {
    assert.equal(count(src, 'drmf_rc_receipt'), 0, `${name} still reads the receipt from sessionStorage`)
  }
})
