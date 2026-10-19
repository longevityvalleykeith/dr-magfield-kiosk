import type { StateConfig, StateStore } from './state.ts'
import { parseStateCommand, parseStateReply } from './state-validation.ts'

const MAX_JWT_LIFETIME_SECONDS = 90 * 24 * 60 * 60
const RPC_TIMEOUT_MS = 2_000

function validRoleJwt(jwt: string, now: Date): boolean {
  if (jwt.length > 8_192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) return false
  const payload = jwt.split('.')[1]
  if (!payload) return false
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof claims !== 'object' || claims === null || !('role' in claims) || claims.role !== 'kiosk_wellness'
      || !('iat' in claims) || typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat)
      || !('exp' in claims) || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) return false
    const seconds = Math.floor(now.getTime() / 1_000)
    return Number.isFinite(seconds) && claims.iat > 0 && claims.iat <= seconds && claims.exp > seconds
      && claims.exp > claims.iat && claims.exp - claims.iat <= MAX_JWT_LIFETIME_SECONDS
  } catch { return false }
}

/** Claim parsing checks configuration hygiene only. Supabase authenticates the JWT signature. */
export function readStateConfig(env: Record<string, string | undefined>, now: Date): StateConfig | null {
  const url = env.KIOSK_STATE_URL
  const publishableKey = env.KIOSK_STATE_PUBLISHABLE_KEY
  const jwt = env.KIOSK_STATE_JWT
  if (!url || !publishableKey || !jwt || !/^sb_publishable_[A-Za-z0-9_-]{1,256}$/.test(publishableKey) || !validRoleJwt(jwt, now)) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
      || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash
      || (url !== parsed.origin && url !== `${parsed.origin}/`)) return null
    return { url: parsed.origin, publishableKey, jwt }
  } catch { return null }
}

export function makeRpcStateStore(config: StateConfig, fetchImpl: typeof fetch, now: () => Date): StateStore {
  // Copy credentials into the private closure; caller mutation cannot retarget an existing store.
  const supplied = { KIOSK_STATE_URL: config.url, KIOSK_STATE_PUBLISHABLE_KEY: config.publishableKey, KIOSK_STATE_JWT: config.jwt }
  return {
    async transition(command) {
      const parsed = parseStateCommand(command)
      if (!parsed) return { kind: 'invalid' }
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const current = readStateConfig(supplied, now())
        if (!current) return { kind: 'unavailable' }
        const controller = new AbortController()
        timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
        const response = await fetchImpl(`${current.url}/rest/v1/rpc/kiosk_wellness_transition`, {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: {
            apikey: current.publishableKey, Authorization: `Bearer ${current.jwt}`,
            'Content-Type': 'application/json', 'Content-Profile': 'public', 'Accept-Profile': 'public', 'Cache-Control': 'no-store',
          },
          body: JSON.stringify({ p_command: parsed }),
        })
        if (!response.ok) return { kind: 'unavailable' }
        return parseStateReply(parsed.kind, await response.json()) ?? { kind: 'unavailable' }
      } catch { return { kind: 'unavailable' } }
      finally { if (timeout !== undefined) clearTimeout(timeout) }
    },
  }
}
