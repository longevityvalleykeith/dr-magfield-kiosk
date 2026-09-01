/**
 * Lane K · EV-17 census — the assertion is on the BUILT BUNDLE, not the source.
 *
 * The 09-02 audit's finding was that the *served* bundle embeds `localhost:3100`.
 * A source grep would have called that clean. So this test opens
 * `.next/static/chunks/app/page-*.js` — the bytes a phone at KRPM downloads —
 * and counts. Run `npm run build` first; `npm run verify` does both.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOORWAY_URL_CANON } from '../lib/standee.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHUNK_DIR = join(ROOT, '.next', 'static', 'chunks', 'app')
const HOME_HTML = join(ROOT, '.next', 'server', 'app', 'index.html')

function homeChunks() {
  assert.ok(existsSync(CHUNK_DIR), `no build output at ${CHUNK_DIR} — run "npm run build" first`)
  const names = readdirSync(CHUNK_DIR).filter((f) => /^page-.*\.js$/.test(f))
  assert.ok(names.length > 0, `no app/page-*.js chunk in ${CHUNK_DIR} — run "npm run build" first`)
  return names.map((name) => ({ name, src: readFileSync(join(CHUNK_DIR, name), 'utf8') }))
}

const count = (haystack, needle) => haystack.split(needle).length - 1

test('census: 0 occurrences of localhost in the served home chunk', () => {
  for (const { name, src } of homeChunks()) {
    assert.equal(count(src, 'localhost'), 0, `${name} still embeds localhost`)
  }
})

test('census: 0 occurrences of the Telegram bot doorway in the served home chunk', () => {
  for (const { name, src } of homeChunks()) {
    assert.equal(count(src, 't.me/DrMAGfield_Bot'), 0, `${name} still points at the Telegram bot`)
    assert.equal(count(src, 't.me/'), 0, `${name} still carries a t.me link`)
  }
})

test('census: at least one occurrence of the governed scan landing', () => {
  const total = homeChunks().reduce((n, { src }) => n + count(src, DOORWAY_URL_CANON), 0)
  assert.ok(total >= 1, `the scan landing ${DOORWAY_URL_CANON} is absent from the served home chunk`)
})

test('census: no MiniMax voice route survives in the build', () => {
  for (const { name, src } of homeChunks()) {
    assert.equal(count(src, '/api/kiosk/session'), 0, `${name} still calls the retired voice route`)
  }
  assert.equal(existsSync(join(ROOT, 'app', 'api', 'kiosk')), false, 'app/api/kiosk still exists')
})

test('census: the prerendered home carries the build stamp', () => {
  assert.ok(existsSync(HOME_HTML), `no prerendered home at ${HOME_HTML} — run "npm run build" first`)
  const html = readFileSync(HOME_HTML, 'utf8')
  assert.ok(html.includes('drm-standee'), 'the served home does not carry the drm-standee build stamp')
})
