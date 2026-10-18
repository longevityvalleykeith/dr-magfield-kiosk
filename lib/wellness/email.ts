/**
 * The results email: one message to the booking's address, with an optional CC to the booking's
 * CARE employee. That is Keith's 10-19 choice of one email with CC over #164's separate deliveries,
 * so the reply-all consequence is stated in the email and on the consent screen.
 *
 * It is sent through Resend's REST API with an Idempotency-Key, so a replayed attempt is
 * one email. Its body carries only the admitted indicators, the disclaimer and the consent
 * reference.
 */
import type { Indicator } from './result.ts'
import type { WellnessConfig } from './config.ts'

export const DISCLAIMER = 'Each value is a wellness indicator, not a medical measurement. It is not a diagnosis. If you feel unwell, speak to a doctor; in an emergency call 999.'

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export interface ResultEmailInput {
  ccName: string | null
  outletName: string
  when: Date
  timeZone: string
  indicators: Indicator[]
  consentVersion: string
  reference: string
}

export function composeResultEmail(i: ResultEmailInput): { subject: string; text: string; html: string } {
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: i.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(i.when)
  const rows = i.indicators.map((x) => `${x.label}: ${x.value} ${x.unit}`)
  const lines = [
    `Your wellness check at ${i.outletName}, ${when}.`,
    '',
    ...rows,
    '',
    DISCLAIMER,
    '',
    `You agreed to consent version ${i.consentVersion}. Reference: ${i.reference}.`,
    'LV keeps no copy of your video, readings or email address. FacePhys, our technology provider, processed the video. The email provider and everyone on this email keep their own copy of it.',
    ...(i.ccName ? ['', `At your request this email is copied to ${i.ccName} of the DR MAGfield CARE team. Everyone on it can see each other's address, and a reply can reach everyone.`] : []),
  ]
  const html = [
    `<p>Your wellness check at ${esc(i.outletName)}, ${esc(when)}.</p>`,
    `<ul>${i.indicators.map((x) => `<li>${esc(x.label)}: <strong>${x.value} ${esc(x.unit)}</strong></li>`).join('')}</ul>`,
    `<p>${esc(DISCLAIMER)}</p>`,
    `<p style="color:#555">You agreed to consent version ${esc(i.consentVersion)}. Reference: ${esc(i.reference)}.<br>LV keeps no copy of your video, readings or email address. FacePhys, our technology provider, processed the video. The email provider and everyone on this email keep their own copy of it.</p>`,
    ...(i.ccName ? [`<p style="color:#555">At your request this email is copied to ${esc(i.ccName)} of the DR MAGfield CARE team. Everyone on it can see each other's address, and a reply can reach everyone.</p>`] : []),
  ].join('\n')
  return { subject: `Your ${i.outletName} wellness check`, text: lines.join('\n'), html }
}

type Mail = NonNullable<WellnessConfig['mail']>

export interface Outgoing { to: string; cc: string | null; subject: string; text: string; html: string }

export async function sendEmail(cfg: Mail, msg: Outgoing, idempotencyKey: string, fetchImpl: typeof fetch): Promise<'sent' | 'failed'> {
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], ...(msg.cc ? { cc: [msg.cc] } : {}), subject: msg.subject, text: msg.text, html: msg.html }),
      redirect: 'error',
      signal: AbortSignal.timeout(4_000),
    })
    return res.ok ? 'sent' : 'failed'
  } catch { return 'failed' }
}
