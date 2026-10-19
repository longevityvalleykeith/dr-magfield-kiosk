'use client'

/**
 * The kiosk screen: a thin view over KioskController, so every rule the feature file proves
 * lives in the controller, not in this component.
 *
 * The browser parts:
 *   - getUserMedia (front camera, no audio) and MediaRecorder (video/mp4 only, which FacePhys needs);
 *   - fetch to the same-origin /api/wellness routes. The device cookie is HttpOnly, so this code
 *     never sees it.
 * The screen resets on inactivity and after a result. It runs on the guest's own phone (Keith 10-19), so hiding the
 * page (to read the emailed code) keeps the check; only a hidden page with the camera on resets.
 */
import { useEffect, useRef, useState } from 'react'
import { KioskController, MESSAGES } from '@/lib/wellness/controller.ts'
import type { KioskApi, KioskState, MediaPort, ScanInput } from '@/lib/wellness/controller.ts'
import { CONSENT_TEXT } from '@/lib/wellness/consent.ts'
import type { Lang } from '@/lib/wellness/consent.ts'
import styles from './kiosk.module.css'

const MP4_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
const IDLE_RESET_MS = 120_000
const DONE_RESET_MS = 45_000
/** The code step waits for an email, so it gets the code's own lifetime. */
const CODE_RESET_MS = 10 * 60_000

function pickType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of MP4_TYPES) if (MediaRecorder.isTypeSupported(t)) return t
  return null
}

function browserMedia(videoEl: () => HTMLVideoElement | null): MediaPort {
  let stream: MediaStream | null = null
  return {
    supported: () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && pickType() !== null,
    async open() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })
      const v = videoEl()
      if (v) { v.srcObject = stream; await v.play().catch(() => undefined) }
    },
    record(seconds) {
      return new Promise<Blob>((resolve, reject) => {
        const type = pickType()
        if (!stream || !type) { reject(new Error('camera')); return }
        const chunks: Blob[] = []
        const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_000_000 })
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        rec.onerror = () => reject(new Error('record'))
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }))
        rec.start()
        window.setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, seconds * 1000)
      })
    },
    close() {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      const v = videoEl()
      if (v) v.srcObject = null
    },
    isOpen: () => stream !== null,
  }
}

const fetchApi: KioskApi = {
  async booking(input) {
    const r = await fetch('/api/wellness/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), credentials: 'same-origin', cache: 'no-store' })
    return { status: r.status, body: await r.json().catch(() => null) }
  },
  async verify(input) {
    const r = await fetch('/api/wellness/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), credentials: 'same-origin', cache: 'no-store' })
    return { status: r.status, body: await r.json().catch(() => null) }
  },
  async scan(input: ScanInput) {
    const fd = new FormData()
    fd.set('attemptToken', input.attemptToken)
    fd.set('email', input.email)
    fd.set('consentVersion', input.consentVersion)
    fd.set('processing', String(input.processing))
    fd.set('emailResults', String(input.emailResults))
    fd.set('share', String(input.share))
    fd.set('video', input.video, 'scan.mp4')
    const r = await fetch('/api/wellness/scan', { method: 'POST', body: fd, credentials: 'same-origin', cache: 'no-store' })
    return { status: r.status, body: await r.json().catch(() => null) }
  },
}

export default function Kiosk({ ready, scanSeconds, outletName }: { ready: boolean; scanSeconds: number; outletName: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const ctl = useRef<KioskController | null>(null)
  if (ctl.current === null) ctl.current = new KioskController({ api: fetchApi, media: browserMedia(() => videoRef.current), scanSeconds })
  const [s, setS] = useState<KioskState>(ctl.current.state)
  const [lang, setLang] = useState<Lang>('en')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [touch, setTouch] = useState(0)

  useEffect(() => {
    const c = ctl.current!
    const off = c.subscribe(setS)
    const hide = () => { if (document.visibilityState === 'hidden') c.onHidden() }
    document.addEventListener('visibilitychange', hide)
    return () => { off(); document.removeEventListener('visibilitychange', hide); c.reset() }
  }, [])

  // The next guest starts clean: inputs are cleared whenever the controller is back at welcome.
  useEffect(() => { if (s.screen === 'welcome') { setEmail(''); setCode(''); setLang('en') } }, [s.screen])

  // Inactivity and post-result resets.
  useEffect(() => {
    if (s.screen === 'welcome' || s.busy || s.screen === 'recording' || s.screen === 'processing') return
    const done = ['result', 'insufficient', 'unknown', 'failed', 'unsupported'].includes(s.screen)
    const t = window.setTimeout(() => ctl.current!.reset(), done ? DONE_RESET_MS : s.screen === 'code' ? CODE_RESET_MS : IDLE_RESET_MS)
    return () => window.clearTimeout(t)
  }, [s.screen, s.busy, touch])

  useEffect(() => {
    if (s.screen !== 'recording') return
    const seconds = s.attempt?.scanSeconds ?? scanSeconds
    setCountdown(seconds)
    const t = window.setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearInterval(t)
  }, [s.screen, s.attempt, scanSeconds])

  const c = ctl.current
  const copy = CONSENT_TEXT[lang]
  const bump = () => setTouch((n) => n + 1)

  if (!ready) {
    return <main className={styles.shell}><section className={styles.card}><h1 className={styles.title}>Wellness check</h1><p className={styles.lead}>{MESSAGES.CHECK_DISABLED}</p></section></main>
  }

  return (
    <main className={styles.shell} onPointerDown={bump} onKeyDown={bump}>
      <section className={styles.card} aria-live="polite">
        <p className={styles.kicker}>{outletName}</p>

        {s.screen === 'welcome' && (<>
          <h1 className={styles.title}>{CONSENT_TEXT.en.title}</h1>
          <p className={styles.lead}>A {scanSeconds}-second face scan on your phone estimates your heart rate, heart-rate variability and breathing rate. You need today’s booking and the email you booked with.</p>
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => c.start()}>Start</button>
            <button className={styles.ghost} onClick={() => c.decline()}>{CONSENT_TEXT.en.decline}</button>
          </div>
        </>)}

        {s.screen === 'booking' && (<form onSubmit={(e) => { e.preventDefault(); void c.submitBooking('', email) }}>
          <h1 className={styles.title}>Your booking email</h1>
          <p className={styles.lead}>We’ll email a 6-digit code to the address on today’s booking.</p>
          <label className={styles.field}>Email you booked with<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {s.message && <p className={styles.error} role="alert">{s.message}</p>}
          <div className={styles.row}>
            <button className={styles.primary} type="submit" disabled={s.busy}>{s.busy ? 'Checking…' : 'Email me a code'}</button>
            <button className={styles.ghost} type="button" onClick={() => c.cancel()}>Cancel</button>
          </div>
        </form>)}

        {s.screen === 'code' && s.challenge && (<form onSubmit={(e) => { e.preventDefault(); void c.submitCode(code) }}>
          <h1 className={styles.title}>Enter your code</h1>
          <p className={styles.lead}>If {s.challenge.maskedEmail} has a booking at {outletName} today, a 6-digit code is on its way. It works for 10 minutes. You can switch to your email app and come back.</p>
          <label className={styles.field}>6-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></label>
          {s.message && <p className={styles.error} role="alert">{s.message}</p>}
          <div className={styles.row}>
            <button className={styles.primary} type="submit" disabled={s.busy || code.length !== 6}>{s.busy ? 'Checking…' : 'Continue'}</button>
            <button className={styles.ghost} type="button" onClick={() => c.cancel()}>Start again</button>
          </div>
        </form>)}

        {s.screen === 'consent' && s.attempt && (<>
          <div className={styles.langs}>
            <button className={lang === 'en' ? styles.langOn : styles.lang} onClick={() => setLang('en')}>English</button>
            <button className={lang === 'ms' ? styles.langOn : styles.lang} onClick={() => setLang('ms')}>Bahasa Melayu</button>
          </div>
          <h1 className={styles.title}>{copy.title}</h1>
          <ul className={styles.points}>{copy.points.map((p) => <li key={p}>{p}</li>)}</ul>
          <label className={styles.check}><input type="checkbox" checked={s.consent.processing} onChange={(e) => c.setConsent('processing', e.target.checked)} />{copy.processing}</label>
          <label className={styles.check}><input type="checkbox" checked={s.consent.emailResults} onChange={(e) => c.setConsent('emailResults', e.target.checked)} />{copy.emailResults} (To: {s.attempt.email})</label>
          {s.attempt.care && (<>
            <label className={styles.check}><input type="checkbox" checked={s.consent.share} onChange={(e) => c.setConsent('share', e.target.checked)} />{copy.share(s.attempt.care.name)} (CC: {s.attempt.care.email})</label>
            <p className={styles.note}>{copy.ccNotice}</p>
          </>)}
          {s.message && <p className={styles.error} role="alert">{s.message}</p>}
          <div className={styles.row}>
            <button className={styles.primary} disabled={s.busy || !s.consent.processing || !s.consent.emailResults} onClick={() => void c.acceptConsent()}>Turn on the camera</button>
            <button className={styles.ghost} onClick={() => c.decline()}>{copy.decline}</button>
          </div>
        </>)}

        <div className={s.screen === 'camera' || s.screen === 'recording' ? styles.preview : styles.hidden}>
          <video ref={videoRef} className={styles.video} playsInline muted />
          <div className={styles.oval} aria-hidden="true" />
        </div>

        {s.screen === 'camera' && (<>
          <p className={styles.lead}>Face the camera inside the oval, keep still and look straight ahead.</p>
          <div className={styles.row}>
            <button className={styles.primary} onClick={() => void c.startScan()} disabled={s.busy}>{copy.start}</button>
            <button className={styles.ghost} onClick={() => c.cancel()}>Cancel</button>
          </div>
        </>)}

        {s.screen === 'recording' && (<>
          <p className={styles.big}>{countdown}s</p>
          <p className={styles.lead}>Recording. Keep still.</p>
          <button className={styles.ghost} onClick={() => c.cancel()}>Cancel</button>
        </>)}

        {s.screen === 'processing' && (<>
          <h1 className={styles.title}>Analysing…</h1>
          <p className={styles.lead}>This usually takes under a minute. The camera is off.</p>
        </>)}

        {s.screen === 'result' && s.result && (<>
          <h1 className={styles.title}>Your wellness indicators</h1>
          <ul className={styles.results}>{s.result.indicators.map((i) => <li key={i.key}><span>{i.label}</span><strong>{i.value} {i.unit}</strong></li>)}</ul>
          <p className={styles.note}>{copy.disclaimer}</p>
          <p className={styles.lead}>{s.result.delivery === 'sent'
            ? `Your results email was sent to ${s.result.to}${s.result.ccStatus === 'sent' && s.result.cc ? `, with a copy to ${s.result.cc} (DR MAGfield CARE)` : ''}. Arrival isn’t confirmed.${s.result.ccStatus === 'unavailable' ? ' We couldn’t copy the CARE team member this time.' : ''}`
            : `We couldn’t send the email. Your results are on this screen${s.retryable ? '; you can try sending again, which reuses this check' : ''}.`}</p>
          <div className={styles.row}>
            {s.result.delivery !== 'sent' && s.retryable && <button className={styles.primary} onClick={() => void c.retrySameAttempt()}>Try sending again</button>}
            <button className={styles.ghost} onClick={() => c.reset()}>Done</button>
          </div>
        </>)}

        {s.screen === 'insufficient' && (<>
          <h1 className={styles.title}>We couldn’t get a clear reading</h1>
          <p className={styles.lead}>No values are shown and nothing was emailed. Good light and keeping still help. Your visit continues as normal.</p>
          <button className={styles.ghost} onClick={() => c.reset()}>Finish</button>
        </>)}

        {s.screen === 'unknown' && (<>
          <h1 className={styles.title}>We’re not sure the analysis finished</h1>
          <p className={styles.lead}>{s.retryable
            ? 'Trying again reuses this same check rather than starting a new one.'
            : 'Please don’t start a new check. The CARE team can look this one up.'}{s.reference ? ` Reference: ${s.reference}.` : ''}</p>
          <div className={styles.row}>
            {s.retryable && <button className={styles.primary} onClick={() => void c.retrySameAttempt()}>Try again</button>}
            <button className={styles.ghost} onClick={() => c.reset()}>Finish</button>
          </div>
        </>)}

        {(s.screen === 'failed' || s.screen === 'unsupported') && (<>
          <h1 className={styles.title}>Wellness check</h1>
          <p className={styles.lead}>{s.message ?? MESSAGES.FAILED}</p>
          <div className={styles.row}>
            {s.screen === 'failed' && s.retryable && c.hasRecording() && <button className={styles.primary} onClick={() => void c.retrySameAttempt()}>Try again</button>}
            <button className={styles.ghost} onClick={() => c.reset()}>Finish</button>
          </div>
        </>)}
      </section>
    </main>
  )
}
