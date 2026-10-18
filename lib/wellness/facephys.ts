/**
 * The FacePhys v3 adapter, server-only. Contract sources (fetched 2026-10-18):
 *   - www.facephys.com/openapi.json (sha256 a3e476f6…)
 *   - www.facephys.com/docs/agent.md (21e7dd08…)
 *   - the vendor's sdks/javascript/facephys-sdk.js at 7037045a
 *
 * The flow is presign → PUT the mp4 → process. Every vendor call is signed with
 * x-key-id + x-timestamp + x-signature, where the signature is Base64(HMAC-SHA256(secret, unix-seconds)).
 *
 * Process may consume tokens, so it carries confirmCharge, a stable idempotencyKey and the
 * video's SHA-256. The gateway replays a completed result for the same key and digest instead of
 * charging again (agent.md). So a lost response is reported as unknown, and is reconciled only by
 * retrying the SAME attempt; it is never retried under a fresh key.
 */
import { hmacBase64 } from './crypto.ts'
import type { WellnessConfig } from './config.ts'

type FacePhys = NonNullable<WellnessConfig['facephys']>

export function signedHeaders(cfg: FacePhys, nowMs: number): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000))
  return { 'x-key-id': cfg.keyId, 'x-timestamp': timestamp, 'x-signature': hmacBase64(cfg.secretKey, timestamp) }
}

/**
 * The vendor SDK's own fix. An uploadUrl path sometimes arrives with "/" encoded as %2F while its
 * signature was computed over "/", and OSS then refuses the PUT. Restore "/" in the path only;
 * the query keeps its signed encoding.
 */
export function normalizeUploadUrl(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url.replace(/%2F/gi, '/') : url.slice(0, q).replace(/%2F/gi, '/') + url.slice(q)
}

/**
 * CLOUD-04: validate the upload origin. It must be https, unless the configured base URL is itself a loopback
 * test double, and its host must match FACEPHYS_UPLOAD_HOSTS when that list is set. Returns the host, or null.
 */
export function uploadHostAllowed(uploadUrl: string, cfg: FacePhys): string | null {
  let u: URL
  try { u = new URL(uploadUrl) } catch { return null }
  const loopbackDouble = cfg.baseUrl.startsWith('http://127.0.0.1:') && u.protocol === 'http:' && u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !loopbackDouble) return null
  const host = u.hostname.toLowerCase()
  if (cfg.uploadHosts.length > 0 && !cfg.uploadHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null
  return host
}

export type Submission =
  | { kind: 'completed'; body: unknown }
  | { kind: 'refused'; code: 'VENDOR_AUTH' | 'VENDOR_REFUSED' | 'VENDOR_REJECTED_VIDEO'; httpStatus: number }
  | { kind: 'not_submitted'; code: 'PRESIGN_FAILED' | 'UPLOAD_FAILED' }
  | { kind: 'unknown_outcome' }

export interface SubmitArgs { video: ArrayBuffer; videoSha256: string; idempotencyKey: string }

export async function submitVideo(cfg: FacePhys, a: SubmitArgs, fetchImpl: typeof fetch, nowMs: () => number, onUploadHost: (host: string) => void = () => undefined): Promise<Submission> {
  // 1 · presign. It consumes no tokens. The signed uploadUrl is sensitive and never logged.
  let uploadUrl: string
  let objectKey: string
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/v2/video/upload/presign`, {
      method: 'POST',
      headers: { ...signedHeaders(cfg, nowMs()), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) return { kind: 'refused', code: 'VENDOR_AUTH', httpStatus: res.status }
    if (!res.ok) return { kind: 'not_submitted', code: 'PRESIGN_FAILED' }
    const body = (await res.json()) as { uploadUrl?: unknown; objectKey?: unknown }
    if (typeof body.uploadUrl !== 'string' || typeof body.objectKey !== 'string' || !body.objectKey) return { kind: 'not_submitted', code: 'PRESIGN_FAILED' }
    uploadUrl = normalizeUploadUrl(body.uploadUrl)
    objectKey = body.objectKey
    const host = uploadHostAllowed(uploadUrl, cfg)
    if (host === null) return { kind: 'not_submitted', code: 'PRESIGN_FAILED' }
    onUploadHost(host)
  } catch { return { kind: 'not_submitted', code: 'PRESIGN_FAILED' } }

  // 2 · upload the exact bytes that were hashed.
  try {
    const put = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: a.video, signal: AbortSignal.timeout(30_000) })
    if (!put.ok) return { kind: 'not_submitted', code: 'UPLOAD_FAILED' }
  } catch { return { kind: 'not_submitted', code: 'UPLOAD_FAILED' } }

  // 3 · process. It may consume tokens. Re-signed, because presign and upload can take a while.
  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/api/v3/video/process`, {
      method: 'POST',
      headers: { ...signedHeaders(cfg, nowMs()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectKey, capability: 'rppg', confirmCharge: true, idempotencyKey: a.idempotencyKey, videoSha256: a.videoSha256 }),
      signal: AbortSignal.timeout(50_000),
    })
  } catch { return { kind: 'unknown_outcome' } }
  if (res.status === 200) {
    try { return { kind: 'completed', body: await res.json() } } catch { return { kind: 'unknown_outcome' } }
  }
  if (res.status === 401) return { kind: 'refused', code: 'VENDOR_AUTH', httpStatus: 401 }
  if (res.status === 403) return { kind: 'refused', code: 'VENDOR_REFUSED', httpStatus: 403 }
  if (res.status === 422) return { kind: 'refused', code: 'VENDOR_REJECTED_VIDEO', httpStatus: 422 }
  // 202/409 (in progress) and 5xx: the vendor may hold the submission. Only a same-key retry reconciles it.
  return { kind: 'unknown_outcome' }
}

/** GET /api/agent/auth/test: side-effect free; proves the key placement without a charge. */
export async function authTest(cfg: FacePhys, fetchImpl: typeof fetch, nowMs: () => number): Promise<boolean> {
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/agent/auth/test`, { method: 'GET', headers: signedHeaders(cfg, nowMs()), signal: AbortSignal.timeout(8000) })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: unknown }
    return body.ok === true
  } catch { return false }
}
