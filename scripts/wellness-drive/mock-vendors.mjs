// Mock FacePhys + OSS + Calendesk + Resend on 127.0.0.1:4810 for the local runtime drive (never a real vendor).
import http from 'node:http'
import { createHmac, createHash } from 'node:crypto'
const FP = 'drive-fp-secret', CD = 'drive-cd-key', RS = 'drive-rs-key'
const calls = []
let n = 0
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const send = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const u = new URL(req.url, 'http://127.0.0.1:4810')
    const h = req.headers
    if (u.pathname === '/__calls') return send(res, 200, calls)
    if (u.pathname.startsWith('/oss/')) {
      calls.push({ kind: 'put', rawPath: req.url.split('?')[0], query: u.search, type: h['content-type'], bytes: body.length, ftyp: body.subarray(4, 8).toString('latin1'), sha: createHash('sha256').update(body).digest('hex') })
      return send(res, req.url.split('?')[0].includes('%2F') ? 403 : 200)
    }
    if (u.pathname.startsWith('/api/admin/bookings/')) {
      calls.push({ kind: 'booking', id: u.pathname.split('/').pop(), auth: h['x-api-key'] === CD && ['drive-tenant', 'zqlc6ablyz'].includes(h['x-tenant']) })
      if (h['x-api-key'] !== CD) return send(res, 401, { message: 'Unauthenticated.' })
      if (u.pathname.endsWith('/501')) return send(res, 200, { data: { id: 501, status: 'approved', paid: true, location: { location_id: 6 }, service_id: 13, employee_id: 12, start_date: today, starts_at: `${today} 10:30:00`, user: { email: 'guest@example.com', name: 'Drive', surname: 'Guest' } } })
      return send(res, 404, { message: 'Not found' })
    }
    if (u.pathname === '/api/admin/employees/12') { calls.push({ kind: 'employee', id: '12' }); return send(res, 200, { data: { id: 12, user: { name: 'Aisyah', surname: null, email: 'aisyah@example.com', status: 'active' } } }) }
    if (u.pathname === '/api/admin/settings') { calls.push({ kind: 'calendesk_settings' }); return send(res, h['x-api-key'] === CD ? 200 : 401, { data: {} }) }
    if (u.pathname === '/emails') {
      const m = JSON.parse(body.toString() || '{}')
      calls.push({ kind: 'email', auth: h.authorization === `Bearer ${RS}`, idem: h['idempotency-key'], to: m.to, cc: m.cc, subject: m.subject, disclaimer: (m.text || '').includes('wellness indicator, not a medical measurement'), leaks: ['spo2', 'SpO2', 'stress', 'emotion'].filter((w) => (m.text || '').includes(w)) })
      return send(res, 200, { id: `em_${calls.length}` })
    }
    if (u.pathname.startsWith('/api/')) {
      const ok = h['x-key-id'] === 'drive-kid' && h['x-signature'] === createHmac('sha256', FP).update(String(h['x-timestamp'] || '')).digest('base64')
      if (!ok) { calls.push({ kind: 'facephys_unsigned', path: u.pathname }); return send(res, 401, { error: 'invalid signature' }) }
      if (u.pathname === '/api/v2/video/upload/presign') { n++; calls.push({ kind: 'presign' }); return send(res, 200, { uploadUrl: `http://127.0.0.1:4810/oss/kiosk%2Fobj-${n}.mp4?Signature=ab%2Fcd&Expires=9`, objectKey: `kiosk/obj-${n}.mp4` }) }
      if (u.pathname === '/api/v3/video/process') { const p = JSON.parse(body.toString()); calls.push({ kind: 'process', ...p }); return send(res, 200, { ok: true, result: { heartRate: 68.4, hrv: { rmssd: 38, sdnn: 49 }, breathingRate: 13, sqi: 0.88, spo2: 97, stressLevel: 'low' } }) }
      if (u.pathname === '/api/agent/auth/test') return send(res, 200, { ok: true, keyId: 'drive-kid', apiVersion: 3, checkedAt: new Date().toISOString(), secretShown: false })
    }
    send(res, 404, { error: 'nope' })
  })
}).listen(4810, '127.0.0.1', () => console.log('mock up'))
