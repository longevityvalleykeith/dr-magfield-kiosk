/**
 * Wellness check configuration, read per request from the server environment.
 *
 * Every secret stays on the server. The page receives only `ready`, the scan length and the
 * outlet name, and the health view reports which groups are configured, never a value.
 * Env names follow the vendors' own docs: FACEPHYS_* from www.facephys.com/docs/agent.md.
 */
import { hmacHex } from './crypto.ts'
import { parseRoster } from './roster.ts'
import type { RosterEntry } from './roster.ts'

export type Env = Record<string, string | undefined>

export interface WellnessConfig {
  switchedOn: boolean
  facephys: { baseUrl: string; keyId: string; secretKey: string; uploadHosts: string[]; uploadPolicy: 'pinned' | 'dynamic' } | null
  calendesk: { baseUrl: string; apiKey: string; tenant: string } | null
  mail: { baseUrl: string; apiKey: string; from: string; consentRecordTo: string | null } | null
  /** cookieSecret signs attempts, cookies and keyed hashes. enrollCode null = open mode (no tablet set-up). */
  device: { enrollCode: string | null; cookieSecret: string } | null
  /** Who resolves the CC: CARE_ROSTER_JSON when set, otherwise Calendesk's own booking employee. */
  careSource: 'roster' | 'calendesk'
  outlet: { slug: string; name: string; locationId: number; serviceIds: number[]; timeZone: string }
  roster: RosterEntry[]
  tenantId: string
  retention: { policyVersion: string; days: number | null }
  scanSeconds: number
  minQuality: number
  allowMissingQuality: boolean
  sameKeyRetry: boolean
}

const text = (v: string | undefined): string => (v ?? '').trim()

/** LV's own Calendesk tenant: book.longevityvalley.ai resolves to it, and it takes the KRPM bookings (T1, measured). */
export const DEFAULT_CALENDESK_TENANT = 'zqlc6ablyz'
/** The sender Foundry already uses on LV's Resend domain. */
export const DEFAULT_EMAIL_FROM = 'DR MAGfield <noreply@longevityvalley.ai>'
/**
 * The dynamic upload rule (Keith: "dynamic and not vercel static"). A presigned upload may go only to FacePhys's own
 * domain or a known object-storage provider, always https, never through a redirect. FACEPHYS_UPLOAD_HOSTS pins it tighter.
 */
export const STORAGE_PROVIDERS = ['aliyuncs.com', 'amazonaws.com', 'myqcloud.com', 'r2.cloudflarestorage.com', 'storage.googleapis.com', 'blob.core.windows.net']

function baseDomain(baseUrl: string): string | null {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
    return host.split('.').slice(-2).join('.')
  } catch { return null }
}
const int = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(text(v), 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export function readConfig(env: Env): WellnessConfig {
  const keyId = text(env.FACEPHYS_KEY_ID), secretKey = text(env.FACEPHYS_SECRET_KEY)
  const cdKey = text(env.CALENDESK_API_KEY), tenant = text(env.CALENDESK_TENANT) || DEFAULT_CALENDESK_TENANT
  const mailKey = text(env.RESEND_API_KEY), from = text(env.EMAIL_FROM) || DEFAULT_EMAIL_FROM
  const enrollRaw = text(env.KIOSK_ENROLL_CODE)
  // No KIOSK_COOKIE_SECRET? Derive a purpose-bound key from the FacePhys secret (HMAC, domain-separated).
  const cookieSecret = text(env.KIOSK_COOKIE_SECRET) || (secretKey ? hmacHex(secretKey, 'dmk-kiosk-signing-v1') : '')
  const baseUrl = text(env.FACEPHYS_BASE_URL) || 'https://www.facephys.com'
  const pins = text(env.FACEPHYS_UPLOAD_HOSTS).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const own = baseDomain(baseUrl)
  const roster = parseRoster(env.CARE_ROSTER_JSON)
  // Empty = any service at the outlet (Keith 10-19: "Any service at KRPM"). KIOSK_SERVICE_IDS restricts it.
  const serviceIds = text(env.KIOSK_SERVICE_IDS).split(',')
    .map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isSafeInteger(n) && n > 0)
  const quality = Number.parseFloat(text(env.MIN_SIGNAL_QUALITY))
  return {
    switchedOn: text(env.SCANS_ENABLED) === '1',
    facephys: keyId && secretKey ? {
      baseUrl, keyId, secretKey,
      uploadHosts: pins.length > 0 ? pins : [...(own ? [own] : []), ...STORAGE_PROVIDERS],
      uploadPolicy: pins.length > 0 ? 'pinned' : 'dynamic',
    } : null,
    calendesk: cdKey && tenant ? { baseUrl: text(env.CALENDESK_API_BASE) || 'https://api.calendesk.com/api', apiKey: cdKey, tenant } : null,
    mail: mailKey && from ? { baseUrl: text(env.EMAIL_API_BASE) || 'https://api.resend.com', apiKey: mailKey, from, consentRecordTo: text(env.CONSENT_RECORD_TO) || null } : null,
    // A set but too-short enrolment code fails closed: it never silently opens the kiosk.
    device: cookieSecret.length >= 32 && (enrollRaw === '' || enrollRaw.length >= 16) ? { enrollCode: enrollRaw || null, cookieSecret } : null,
    careSource: text(env.CARE_ROSTER_JSON) ? 'roster' : 'calendesk',
    outlet: {
      slug: text(env.KIOSK_OUTLET) || 'krpm',
      name: text(env.KIOSK_OUTLET_NAME) || 'DR MAGfield KRPM',
      locationId: int(env.KIOSK_LOCATION_ID, 6),
      serviceIds,
      timeZone: text(env.KIOSK_TIME_ZONE) || 'Asia/Kuala_Lumpur',
    },
    roster,
    tenantId: text(env.KIOSK_TENANT) || 'dr-magfield',
    retention: { policyVersion: text(env.CONSENT_RETENTION_POLICY) || 'unset', days: text(env.CONSENT_RETENTION_DAYS) ? int(env.CONSENT_RETENTION_DAYS, 0) || null : null },
    scanSeconds: Math.min(30, Math.max(10, int(env.SCAN_SECONDS, 20))),
    minQuality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0.5,
    allowMissingQuality: text(env.ALLOW_MISSING_QUALITY) === '1',
    // Off by default: an unknown outcome stops and is reconciled. Turn on only once the vendor's same-key replay is measured.
    sameKeyRetry: text(env.SAME_KEY_RETRY) === '1',
  }
}

/**
 * The check runs when switched on and the four vendor secrets are present: FACEPHYS_KEY_ID + FACEPHYS_SECRET_KEY,
 * CALENDESK_API_KEY and RESEND_API_KEY. Everything else has a safe default or is derived.
 */
export function isReady(c: WellnessConfig): boolean {
  return c.switchedOn && c.facephys !== null && c.facephys.uploadHosts.length > 0 && c.calendesk !== null && c.mail !== null && c.device !== null
}
