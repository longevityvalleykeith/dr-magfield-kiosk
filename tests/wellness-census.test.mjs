/**
 * Wellness census: the assertion is on the BUILT client chunks the tablet downloads, not the
 * source. Run `npm run build` first; `npm run verify` does both.
 *
 * The /scan and /scan/enroll chunks must carry no secret's name, no vendor host, no signing
 * header and no loopback host. Every vendor call happens on the server.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHUNKS = join(ROOT, '.next', 'static', 'chunks', 'app', 'scan')

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (name.endsWith('.js')) yield p
  }
}

const FORBIDDEN = [
  'FACEPHYS_SECRET_KEY', 'FACEPHYS_KEY_ID', 'CALENDESK_API_KEY', 'RESEND_API_KEY', 'KIOSK_COOKIE_SECRET', 'KIOSK_ENROLL_CODE', 'CARE_ROSTER_JSON',
  'www.facephys.com', 'api.calendesk.com', 'api.resend.com', 'x-signature', 'X-Api-Key', 'localhost',
]

test('census: the wellness client chunks exist after a build', () => {
  assert.ok(existsSync(CHUNKS), `no build output at ${CHUNKS}; run "npm run build" first`)
  const files = [...walk(CHUNKS)]
  assert.ok(files.some((f) => /scan[/\\]page-.*\.js$/.test(f)), 'no /scan page chunk')
  assert.ok(files.some((f) => /enroll[/\\]page-.*\.js$/.test(f)), 'no /scan/enroll page chunk')
})

test('census: no secret name, vendor host, signing header or loopback host in a wellness client chunk', () => {
  for (const f of walk(CHUNKS)) {
    const src = readFileSync(f, 'utf8')
    for (const needle of FORBIDDEN) assert.equal(src.split(needle).length - 1, 0, `${f} carries ${needle}`)
  }
})
