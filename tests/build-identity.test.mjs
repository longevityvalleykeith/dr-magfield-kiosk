/**
 * Lane K · the build stamp — served must be able to say which build it is.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIdentity, buildStampText } from '../lib/build-identity.ts'

test('an unstamped environment says local/unknown, never a guess', () => {
  const b = buildIdentity({})
  assert.deepEqual(b, { tool: 'drm-standee', version: 'v2', deploy: 'local', BUILD_SHA12: 'unknown' })
  assert.equal(buildIdentity().deploy, 'local')
})

test('Vercel env and sha are carried, sha truncated to 12', () => {
  const b = buildIdentity({
    VERCEL_ENV: 'production',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  })
  assert.equal(b.deploy, 'production')
  assert.equal(b.BUILD_SHA12, '0123456789ab')
  assert.equal(b.BUILD_SHA12.length, 12)
})

test('a blank sha is unknown, not an empty string', () => {
  assert.equal(buildIdentity({ NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: '   ' }).BUILD_SHA12, 'unknown')
})

test('the stamp text names the tool, the version, the deploy and the sha', () => {
  const text = buildStampText(buildIdentity({ VERCEL_ENV: 'preview', NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' }))
  assert.equal(text, 'drm-standee v2 · preview · abcdef123456')
})
