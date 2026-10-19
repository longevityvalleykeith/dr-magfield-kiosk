/**
 * The kiosk's state machine, free of React and the browser, so the feature file can drive it.
 *
 * Shared-device laws (T1 #164 O2O-02/08/10/12; Main's EDGE-03):
 * - Every async step captures an epoch. reset() bumps it, so a late reply is dropped and never
 *   reaches the next guest.
 * - The camera closes as soon as the clip exists, and on cancel and reset.
 * - The clip lives in memory only, and only while a same-attempt retry may still need it.
 * - Nothing is persisted on the device.
 *
 * Phone-first (Keith 10-19): the guest's own phone runs the check, and a code emailed to the booking's inbox opens it.
 * Leaving the page to read that email must not wipe the check, so hiding the page resets only while the camera is on.
 */
import { CONSENT_VERSION } from './consent.ts'

export type Screen =
  | 'welcome' | 'booking' | 'code' | 'consent' | 'camera' | 'recording' | 'processing'
  | 'result' | 'insufficient' | 'unknown' | 'failed' | 'unsupported'

export interface Indicator { key: string; label: string; value: number; unit: string }
export interface AttemptView { token: string; email: string; maskedEmail: string; care: { name: string; email: string; maskedEmail: string } | null; scanSeconds: number }
export interface ResultView { indicators: Indicator[]; delivery: 'sent' | 'failed'; to: string; cc: string | null; ccStatus: string }
export interface Consent { processing: boolean; emailResults: boolean; share: boolean }
export interface ChallengeView { token: string; email: string; maskedEmail: string }
export interface KioskState {
  screen: Screen
  busy: boolean
  attempt: AttemptView | null
  /** The code step: which inbox the code went to (masked), and the signed challenge to answer. */
  challenge: ChallengeView | null
  consent: Consent
  result: ResultView | null
  errorCode: string | null
  message: string | null
  /** The server says a same-attempt resubmission is safe. */
  retryable: boolean
  /** Short reference of an unknown outcome, quoted to staff for reconciliation. */
  reference: string | null
}

export interface ApiReply { status: number; body: Record<string, unknown> | null }
export interface ScanInput { attemptToken: string; email: string; consentVersion: string; processing: boolean; emailResults: boolean; share: boolean; video: Blob }
export interface KioskApi {
  booking(input: { bookingId: string; email: string }): Promise<ApiReply>
  verify(input: { challengeToken: string; email: string; code: string }): Promise<ApiReply>
  scan(input: ScanInput): Promise<ApiReply>
}
export interface MediaPort {
  supported(): boolean
  open(): Promise<void>
  record(seconds: number): Promise<Blob>
  close(): void
  isOpen(): boolean
}

/** Guest-facing copy per refusal code. A delivery is only ever "sent", never a CARE commitment. */
export const MESSAGES: Record<string, string> = {
  BOOKING_NOT_MATCHED: 'We couldn’t match that booking to today’s wellness session with this email. Please check with the CARE team. Your visit continues as normal.',
  BOOKING_INPUT_INVALID: 'Please enter your booking number and the email you booked with.',
  BOOKING_UNAVAILABLE: 'We can’t reach the booking system right now. Your visit continues as normal.',
  BOOKING_CHANGED: 'Your booking changed since you confirmed it. Please start again.',
  DEVICE_NOT_ENROLLED: 'This tablet isn’t set up for wellness checks. Please ask the CARE team.',
  CHECK_DISABLED: 'The wellness check isn’t available right now. Your visit continues as normal.',
  CONSENT_REQUIRED: 'Please tick both boxes to continue, or choose No thanks.',
  RECIPIENT_UNAVAILABLE: 'That CARE team member can’t be copied right now. You can continue without the CC.',
  VIDEO_UNSUPPORTED: 'This tablet can’t record a video the analysis can use. Your visit continues as normal.',
  CAMERA_UNAVAILABLE: 'The camera isn’t available. Your visit continues as normal.',
  ATTEMPT_INVALID: 'This check has expired. Please start again.',
  ATTEMPT_ALREADY_SUBMITTED: 'This check was already sent. Please ask the CARE team to look it up.',
  TOO_MANY_SCANS: 'Please wait a moment before the next check.',
  CODE_WRONG: 'That code isn’t right. Check the latest email from DR MAGfield and try again.',
  CODE_LOCKED: 'Too many wrong codes. Please start again to get a new code.',
  CODE_EXPIRED: 'That code has expired. Please start again to get a new code.',
  CODE_UNAVAILABLE: 'We couldn’t send the code just now. Your visit continues as normal.',
  CHECK_PENDING: 'Your earlier check is still being confirmed. Please ask the CARE team before starting another.',
  TOO_MANY_LOOKUPS: 'Too many tries just now. Please wait a few minutes or ask the CARE team. Your visit continues as normal.',
  BOOKING_ALREADY_CHECKED: 'This booking has already had its wellness check today. Your visit continues as normal.',
  FAILED: 'The wellness check couldn’t be completed and no results were sent. Your visit continues as normal.',
}

const noConsent = (): Consent => ({ processing: false, emailResults: false, share: false })
export const initialState = (): KioskState => ({ screen: 'welcome', busy: false, attempt: null, challenge: null, consent: noConsent(), result: null, errorCode: null, message: null, retryable: false, reference: null })

export class KioskController {
  state: KioskState
  api: KioskApi
  media: MediaPort
  scanSeconds: number
  epoch: number
  clip: Blob | null
  /** The camera permission prompt is open: the stream may still arrive, so hiding the page must stop it. */
  opening: boolean
  listeners: Set<(s: KioskState) => void>

  constructor(deps: { api: KioskApi; media: MediaPort; scanSeconds: number }) {
    this.api = deps.api
    this.media = deps.media
    this.scanSeconds = deps.scanSeconds
    this.state = initialState()
    this.epoch = 0
    this.clip = null
    this.opening = false
    this.listeners = new Set()
  }

  subscribe(fn: (s: KioskState) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  set(patch: Partial<KioskState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn(this.state))
  }

  hasRecording(): boolean { return this.clip !== null }

  start(): void {
    if (this.state.screen === 'welcome') this.set({ screen: 'booking', errorCode: null, message: null })
  }

  decline(): void { this.reset() }

  async submitBooking(bookingId: string, email: string): Promise<void> {
    if (this.state.busy || this.state.screen !== 'booking') return
    const epoch = this.epoch
    this.set({ busy: true, errorCode: null, message: null })
    let reply: ApiReply
    try { reply = await this.api.booking({ bookingId: bookingId.trim(), email: email.trim() }) } catch { reply = { status: 0, body: { code: 'BOOKING_UNAVAILABLE' } } }
    if (epoch !== this.epoch) return
    const b = reply.body ?? {}
    if (this.matched(b, email.trim())) return
    if (b.status === 'code_sent' && typeof b.challengeToken === 'string') {
      this.set({ busy: false, screen: 'code', challenge: { token: b.challengeToken, email: email.trim(), maskedEmail: String(b.maskedEmail ?? '') } })
      return
    }
    const code = typeof b.code === 'string' ? b.code : 'BOOKING_UNAVAILABLE'
    this.set({ busy: false, errorCode: code, message: MESSAGES[code] ?? MESSAGES.FAILED })
  }

  /** A matched reply (from the code step, or a direct match) opens consent. */
  matched(b: Record<string, unknown>, email: string): boolean {
    if (b.status !== 'matched' || typeof b.attemptToken !== 'string') return false
    const care = b.care && typeof b.care === 'object' ? (b.care as { name: string; email: string; maskedEmail: string }) : null
    this.set({
      busy: false, screen: 'consent', consent: noConsent(), challenge: null,
      attempt: { token: b.attemptToken, email, maskedEmail: String(b.maskedEmail ?? ''), care, scanSeconds: Number(b.scanSeconds) || this.scanSeconds },
    })
    return true
  }

  /** The 6-digit code from the booking's inbox. Wrong, expired or locked codes keep the guest on this step. */
  async submitCode(code: string): Promise<void> {
    const ch = this.state.challenge
    if (this.state.busy || this.state.screen !== 'code' || !ch) return
    const epoch = this.epoch
    this.set({ busy: true, errorCode: null, message: null })
    let reply: ApiReply
    try { reply = await this.api.verify({ challengeToken: ch.token, email: ch.email, code: String(code ?? '').trim() }) } catch { reply = { status: 0, body: { code: 'BOOKING_UNAVAILABLE' } } }
    if (epoch !== this.epoch) return
    const b = reply.body ?? {}
    if (this.matched(b, ch.email)) return
    const err = typeof b.code === 'string' ? b.code : 'BOOKING_UNAVAILABLE'
    this.set({ busy: false, errorCode: err, message: MESSAGES[err] ?? MESSAGES.FAILED })
  }

  /** The page was hidden. Reading the code in the mail app keeps the check; a hidden page never keeps the camera on. */
  onHidden(): void {
    if (this.opening || this.media.isOpen() || this.state.screen === 'camera' || this.state.screen === 'recording') this.reset()
  }

  setConsent(field: keyof Consent, value: boolean): void {
    if (this.state.busy || (this.state.screen !== 'consent' && this.state.screen !== 'camera')) return
    if (field === 'share' && value && !this.state.attempt?.care) return // sharing starts unticked and needs a recipient
    this.set({ consent: { ...this.state.consent, [field]: value } })
  }

  async acceptConsent(): Promise<void> {
    if (this.state.busy || this.state.screen !== 'consent') return
    const c = this.state.consent
    if (!c.processing || !c.emailResults) { this.set({ errorCode: 'CONSENT_REQUIRED', message: MESSAGES.CONSENT_REQUIRED }); return }
    if (!this.media.supported()) { this.set({ screen: 'unsupported', errorCode: 'VIDEO_UNSUPPORTED', message: MESSAGES.VIDEO_UNSUPPORTED }); return }
    const epoch = this.epoch
    this.set({ busy: true, errorCode: null, message: null })
    this.opening = true
    try { await this.media.open() } catch {
      this.opening = false
      this.media.close()
      if (epoch === this.epoch) this.set({ busy: false, screen: 'failed', errorCode: 'CAMERA_UNAVAILABLE', message: MESSAGES.CAMERA_UNAVAILABLE })
      return
    }
    this.opening = false
    if (epoch !== this.epoch) { this.media.close(); return }
    this.set({ busy: false, screen: 'camera' })
  }

  /** The guest's Start tap: Keith's 10-19 charge confirmation for this one attempt. */
  async startScan(): Promise<void> {
    const a = this.state.attempt
    if (this.state.busy || this.state.screen !== 'camera' || !a) return
    const epoch = this.epoch
    this.set({ busy: true, screen: 'recording' })
    let clip: Blob
    try { clip = await this.media.record(a.scanSeconds) } catch {
      this.media.close()
      if (epoch === this.epoch) this.set({ busy: false, screen: 'failed', errorCode: 'CAMERA_UNAVAILABLE', message: MESSAGES.CAMERA_UNAVAILABLE })
      return
    }
    this.media.close()
    if (epoch !== this.epoch) return
    this.clip = clip
    await this.submit(epoch)
  }

  /** Resubmits the SAME attempt and clip, and only when the server said that is safe. */
  async retrySameAttempt(): Promise<void> {
    if (this.state.busy || !this.clip || !this.state.attempt || !this.state.retryable) return
    if (this.state.screen !== 'unknown' && this.state.screen !== 'failed' && this.state.screen !== 'result') return
    await this.submit(this.epoch)
  }

  async submit(epoch: number): Promise<void> {
    const a = this.state.attempt
    const clip = this.clip
    if (!a || !clip) return
    const c = this.state.consent
    this.set({ busy: true, screen: 'processing', errorCode: null, message: null, retryable: false, reference: null })
    let reply: ApiReply
    try {
      reply = await this.api.scan({ attemptToken: a.token, email: a.email, consentVersion: CONSENT_VERSION, processing: c.processing, emailResults: c.emailResults, share: c.share && a.care !== null, video: clip })
    } catch { reply = { status: 0, body: null } }
    if (epoch !== this.epoch) return // a late reply never reaches the next guest
    const b = reply.body ?? {}
    // No JSON from us (network loss, a 502/504 from the platform) may come after FacePhys charged: unknown, retry-safe.
    const platformError = reply.status === 0 || (reply.status >= 500 && typeof b.status !== 'string')
    if (platformError || b.status === 'unknown_outcome') {
      const retryable = b.retryable === true
      if (!retryable) this.clip = null // stop and reconcile: no resubmission from this tablet
      this.set({ busy: false, screen: 'unknown', retryable, reference: typeof b.reference === 'string' ? b.reference : null })
      return
    }
    if (b.status === 'completed') {
      const delivery = b.delivery === 'sent' ? 'sent' : 'failed'
      const retryable = b.retryable === true
      if (delivery === 'sent' || !retryable) this.clip = null
      this.set({
        busy: false, screen: 'result', retryable,
        result: { indicators: Array.isArray(b.indicators) ? (b.indicators as Indicator[]) : [], delivery, to: String(b.to ?? ''), cc: typeof b.cc === 'string' ? b.cc : null, ccStatus: typeof b.ccStatus === 'string' ? b.ccStatus : 'declined' },
      })
      return
    }
    if (b.status === 'insufficient_quality') { this.clip = null; this.set({ busy: false, screen: 'insufficient', result: null }); return }
    const code = typeof b.code === 'string' ? b.code : 'FAILED'
    const retryable = b.retryable === true
    if (!retryable) this.clip = null
    this.set({ busy: false, screen: 'failed', errorCode: code, message: MESSAGES[code] ?? MESSAGES.FAILED, retryable })
  }

  cancel(): void { this.reset() }

  reset(): void {
    this.epoch++
    this.media.close()
    this.clip = null
    this.set(initialState())
  }
}
