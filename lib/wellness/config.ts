/**
 * Wellness check configuration, read per request from the server environment.
 *
 * Every secret stays on the server. The page receives only `ready`, the scan length and the
 * outlet name, and the health view reports which groups are configured, never a value.
 * Env names follow the vendors' own docs: FACEPHYS_* from www.facephys.com/docs/agent.md.
 */
import { parseRoster } from './roster.ts'
import type { RosterEntry } from './roster.ts'

export type Env = Record<string, string | undefined>

export interface WellnessConfig {
  switchedOn: boolean
  facephys: { baseUrl: string; keyId: string; secretKey: string; uploadHosts: string[] } | null
  calendesk: { baseUrl: string; apiKey: string; tenant: string } | null
  mail: { baseUrl: string; apiKey: string; from: string; consentRecordTo: string | null } | null
  device: { enrollCode: string; cookieSecret: string } | null
  outlet: { slug: string; name: string; locationId: number; serviceIds: number[]; timeZone: string }
  roster: RosterEntry[]
  tenantId: string
  retention: { policyVersion: string; days: number | null }
  scanSeconds: number
  minQuality: number
}

const text = (v: string | undefined): string => (v ?? '').trim()
const int = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(text(v), 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export function readConfig(env: Env): WellnessConfig {
  const keyId = text(env.FACEPHYS_KEY_ID), secretKey = text(env.FACEPHYS_SECRET_KEY)
  const cdKey = text(env.CALENDESK_API_KEY), tenant = text(env.CALENDESK_TENANT)
  const mailKey = text(env.RESEND_API_KEY), from = text(env.EMAIL_FROM)
  const enrollCode = text(env.KIOSK_ENROLL_CODE), cookieSecret = text(env.KIOSK_COOKIE_SECRET)
  const serviceIds = text(env.KIOSK_SERVICE_IDS || '13,14').split(',')
    .map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isSafeInteger(n) && n > 0)
  const quality = Number.parseFloat(text(env.MIN_SIGNAL_QUALITY))
  return {
    switchedOn: text(env.SCANS_ENABLED) === '1',
    facephys: keyId && secretKey ? {
      baseUrl: text(env.FACEPHYS_BASE_URL) || 'https://www.facephys.com', keyId, secretKey,
      uploadHosts: text(env.FACEPHYS_UPLOAD_HOSTS).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    } : null,
    calendesk: cdKey && tenant ? { baseUrl: text(env.CALENDESK_API_BASE) || 'https://api.calendesk.com/api', apiKey: cdKey, tenant } : null,
    mail: mailKey && from ? { baseUrl: text(env.EMAIL_API_BASE) || 'https://api.resend.com', apiKey: mailKey, from, consentRecordTo: text(env.CONSENT_RECORD_TO) || null } : null,
    device: enrollCode.length >= 16 && cookieSecret.length >= 32 ? { enrollCode, cookieSecret } : null,
    outlet: {
      slug: text(env.KIOSK_OUTLET) || 'krpm',
      name: text(env.KIOSK_OUTLET_NAME) || 'DR MAGfield KRPM',
      locationId: int(env.KIOSK_LOCATION_ID, 6),
      serviceIds: serviceIds.length ? serviceIds : [13, 14],
      timeZone: text(env.KIOSK_TIME_ZONE) || 'Asia/Kuala_Lumpur',
    },
    roster: parseRoster(env.CARE_ROSTER_JSON),
    tenantId: text(env.KIOSK_TENANT) || 'dr-magfield',
    retention: { policyVersion: text(env.CONSENT_RETENTION_POLICY) || 'unset', days: text(env.CONSENT_RETENTION_DAYS) ? int(env.CONSENT_RETENTION_DAYS, 0) || null : null },
    scanSeconds: Math.min(30, Math.max(10, int(env.SCAN_SECONDS, 20))),
    minQuality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0.5,
  }
}

/** The check runs only when it is switched on AND every group it needs is configured. */
export function isReady(c: WellnessConfig): boolean {
  return c.switchedOn && c.facephys !== null && c.calendesk !== null && c.mail !== null && c.device !== null
}
