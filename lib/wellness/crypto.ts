/**
 * Server-only primitives for the wellness check. Nothing here is imported by a client component.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
export const hmacBase64 = (key: string, message: string): string => createHmac('sha256', key).update(message).digest('base64')
export const hmacHex = (key: string, message: string): string => createHmac('sha256', key).update(message).digest('hex')
export const newId = (): string => randomUUID()

/** Constant-time equality over digests, so neither length nor content leaks through timing. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/**
 * A signed, purpose-bound, expiring token: base64url(JSON) "." base64url(HMAC(purpose "." body)).
 * It is signed, not encrypted, so it must never carry anything the holder may not read.
 */
export function seal(secret: string, purpose: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', secret).update(`${purpose}.${body}`).digest('base64url')
  return `${body}.${mac}`
}

export function unseal(secret: string, purpose: string, token: string | null | undefined, nowMs: number): Record<string, unknown> | null {
  if (!token || token.length > 2048) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = createHmac('sha256', secret).update(`${purpose}.${parts[0]}`).digest('base64url')
  if (!sameSecret(parts[1], expected)) return null
  let payload: unknown
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { return null }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const exp = (payload as { exp?: unknown }).exp
  if (typeof exp !== 'number' || exp <= nowMs) return null
  return payload as Record<string, unknown>
}
