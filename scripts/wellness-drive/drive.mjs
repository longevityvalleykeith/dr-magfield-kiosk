// Local runtime drive of /scan: headless Google Chrome with a fake camera, against `next start` on 127.0.0.1:3107
// and mock-vendors.mjs on 127.0.0.1:4810. No real vendor, charge or email. See README.md in this folder.
import { createRequire } from 'node:module'
// Any checkout with playwright-core installed: PLAYWRIGHT_FROM=<that checkout's package.json>
const require = createRequire(process.env.PLAYWRIGHT_FROM || new URL('../../package.json', import.meta.url).pathname)
const { chromium } = require('playwright-core')
const BASE = 'http://127.0.0.1:3107'
const out = (k, v) => console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const OPEN = process.env.DRIVE_MODE === 'open' // production simplicity: no KIOSK_ENROLL_CODE
// DRIVE_MODE=paused (start next with SCANS_ENABLED=0): BS-00, the paused arrival from LV's old QR.
if (process.env.DRIVE_MODE === 'paused') {
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage()
    const thirdParty = []
    page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== '127.0.0.1') thirdParty.push(h) })
    await page.goto(`${BASE}/scan?src=lvqr`)
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    out('paused page', text)
    out('back to booking', await page.getByRole('link', { name: 'Back to booking' }).getAttribute('href'))
    out('check actions present', await page.locator('input, video, button').count())
    out('build stamp', await page.locator('small[data-build]').innerText())
    out('third-party hosts requested', [...new Set(thirdParty)])
  } finally { await browser.close() }
  process.exit(0)
}
try {
  // 1 · an unenrolled tablet is refused before any vendor call (enrolled mode only)
  if (!OPEN) {
  const stranger = await (await browser.newContext()).newPage()
  await stranger.goto(`${BASE}/scan`)
  await stranger.getByRole('button', { name: 'Start' }).click()
  await stranger.getByLabel('Email you booked with').fill('guest@example.com')
  await stranger.getByRole('button', { name: 'Email me a code' }).click()
  const msg = stranger.getByText('set up for wellness checks'); await msg.waitFor({ timeout: 15_000 })
  out('unenrolled', await msg.innerText())
  }
  // 2 · the guest's own phone (enrol only in tablet mode)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/scan/enroll`)
  await page.getByLabel('Set-up code').fill('drive-enroll-code-0001')
  await page.getByRole('button', { name: 'Set up' }).click()
  out('enrolled', await page.getByText(OPEN ? 'needs no tablet set-up' : 'This tablet is set up').innerText())
  out('cookie', (await ctx.cookies()).map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })))
  // free preflight on the enrolled tablet: auth test + presign host, no upload, no charge
  const pre = await page.goto(`${BASE}/api/wellness/health?probe=facephys`)
  out('preflight', await pre.json())
  // 3 · the guest journey
  const resp = await page.goto(`${BASE}/scan?src=qr`)
  const hdr = resp.headers()
  out('scan headers', { cache: hdr['cache-control'], permissions: hdr['permissions-policy'], robots: hdr['x-robots-tag'], referrer: hdr['referrer-policy'] })
  out('mp4 recorder supported', await page.evaluate(() => ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'].filter((t) => MediaRecorder.isTypeSupported(t))))
  await page.getByRole('button', { name: 'Start' }).click()
  out('booking number asked', await page.getByLabel('Booking number').count() > 0)
  await page.getByLabel('Email you booked with').fill('Guest@Example.com')
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByText('Enter your code').waitFor()
  out('code screen', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 220))
  // The guest switches to the mail app: the page is hidden, then shown again.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  out('code step survives a hidden page', await page.getByText('Enter your code').isVisible())
  const { code } = await (await fetch('http://127.0.0.1:4810/__inbox')).json()
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error(`no code reached the mock inbox (got ${code}): the lookup did not match`)
  out('code in the page', (await page.content()).includes(code))
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Optional wellness check').waitFor()
  out('inbox-not-person line shown', (await page.locator('main').innerText()).includes('person who received the code'))
  const boxes = page.getByRole('checkbox')
  out('checkboxes', await boxes.count())
  out('share unticked by default', !(await boxes.nth(2).isChecked()))
  out('camera button disabled before consent', await page.getByRole('button', { name: 'Turn on the camera' }).isDisabled())
  out('consent destinations', (await page.locator('main').innerText()).match(/\(To: [^)]+\)|\(CC: [^)]+\)/g))
  await boxes.nth(0).check(); await boxes.nth(1).check(); await boxes.nth(2).check()
  await page.getByRole('button', { name: 'Turn on the camera' }).click()
  await page.getByRole('button', { name: 'Start my scan' }).waitFor()
  out('camera live', await page.evaluate(() => { const v = document.querySelector('video'); return !!(v && v.srcObject && v.srcObject.getVideoTracks()[0]?.readyState === 'live') }))
  await page.getByRole('button', { name: 'Start my scan' }).click()
  await page.getByText('Your wellness indicators').waitFor({ timeout: 90_000 })
  out('result', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 420))
  out('camera off after scan', await page.evaluate(() => { const v = document.querySelector('video'); return !v.srcObject }))
  await page.screenshot({ path: new URL('./result.png', import.meta.url).pathname, fullPage: true })
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Start' }).waitFor()
  out('after Done', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 120))
  out('no result text after reset', !(await page.locator('main').innerText()).includes('68 bpm'))
} finally { await browser.close() }
const calls = await (await fetch('http://127.0.0.1:4810/__calls')).json()
out('vendor calls', calls)
