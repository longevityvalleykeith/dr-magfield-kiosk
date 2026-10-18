'use client'

/**
 * One-time staff setup per tablet. The code is typed here, never put in a URL. A correct code
 * makes the server set the HttpOnly device cookie, which this page cannot read.
 */
import { useState } from 'react'
import styles from '../kiosk.module.css'

export default function EnrollForm() {
  const [code, setCode] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'wrong' | 'off' | 'open'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('busy')
    const r = await fetch('/api/wellness/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
    setCode('')
    setState(r?.status === 204 ? 'done' : r?.status === 200 ? 'open' : r?.status === 503 ? 'off' : 'wrong')
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <p className={styles.kicker}>Staff only</p>
        <h1 className={styles.title}>Set up this tablet for wellness checks</h1>
        {state === 'open' ? (
          <>
            <p className={styles.lead}>This deployment needs no tablet set-up. Each check is gated by today’s booking.</p>
            <a className={styles.primary} href="/scan" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Open the wellness check</a>
          </>
        ) : state === 'done' ? (
          <>
            <p className={styles.lead}>This tablet is set up for 30 days.</p>
            <a className={styles.primary} href="/scan" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Open the wellness check</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className={styles.field}>Set-up code<input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
            {state === 'wrong' && <p className={styles.error} role="alert">That code didn’t work.</p>}
            {state === 'off' && <p className={styles.error} role="alert">Wellness checks aren’t configured on this deployment.</p>}
            <div className={styles.row}><button className={styles.primary} type="submit" disabled={state === 'busy'}>Set up</button></div>
          </form>
        )}
      </section>
    </main>
  )
}
