import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBooking, handleVerify, handleScan } from '../lib/wellness/http.ts'
import { Brakes } from '../lib/wellness/limits.ts'
import { CONSENT_VERSION } from '../lib/wellness/consent.ts'
const EMAIL = 'synthetic@example.invalid'
const NOW = new Date('2026-10-19T04:00:00Z')
const env = { SCANS_ENABLED: '1', FACEPHYS_KEY_ID: 'synthetic-key', FACEPHYS_SECRET_KEY: 'synthetic-secret-for-isolated-tests', CALENDESK_API_KEY: 'synthetic-cd', RESEND_API_KEY: 'synthetic-mail', FACEPHYS_BASE_URL: 'https://facephys.invalid', CALENDESK_API_BASE: 'https://calendesk.invalid', EMAIL_API_BASE: 'https://mail.invalid' }
const row = { id: 501, status: 'approved', location: { location_id: 6, id: 44 }, service_id: 8, employee_id: null, start_date: '2026-10-19', user: { email: EMAIL } }
const json = (x, status=200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
const request = (path, body) => new Request('https://kiosk.invalid'+path, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
function world() {
  const state = { mail:[], process:[], hold:[], processMode:'completed', detailFail:false }
  const deps = { env, now:()=>NOW, brakes:new Brakes(), log:()=>{}, fetch: async(input,init={})=>{
    const u = new URL(String(input))
    if (u.hostname === 'calendesk.invalid') {
      if (u.pathname.endsWith('/v2')) return json({data:[row], last_page:1})
      return state.detailFail ? json({},503) : json({data:row})
    }
    if (u.hostname === 'mail.invalid') { state.mail.push(JSON.parse(init.body)); return json({id:'synthetic-mail'}) }
    if (u.hostname === 'facephys.invalid' && u.pathname.endsWith('/presign')) return json({uploadUrl:'https://synthetic-bucket.s3.amazonaws.com/clip',objectKey:'synthetic-clip'})
    if (u.hostname === 'synthetic-bucket.s3.amazonaws.com') return new Response('',{status:200})
    if (u.hostname === 'facephys.invalid' && u.pathname.endsWith('/process')) {
      state.process.push(JSON.parse(init.body))
      if (state.processMode === 'hold') return new Promise(resolve=>state.hold.push(()=>resolve(json({heartRate:72,sqi:.9}))))
      if (state.processMode === 'unknown') return json({},503)
      return json({heartRate:72,sqi:.9})
    }
    throw new Error('Unexpected synthetic boundary '+u.hostname+u.pathname)
  }}
  return {state,deps}
}
async function challenge(w) {
  const r = await handleBooking(request('/booking',{email:EMAIL}),w.deps); assert.equal(r.status,200)
  const body=await r.json(); const code=w.state.mail.at(-1).text.match(/\b\d{6}\b/)[0]
  return {challengeToken:body.challengeToken,email:EMAIL,code}
}
async function attempt(w) { const input=await challenge(w); const r=await handleVerify(request('/verify',input),w.deps); assert.equal(r.status,200); return (await r.json()).attemptToken }
function scanReq(token) {
  const f=new FormData(); const b=new Uint8Array(2048);b.set([0,0,0,24,102,116,121,112,105,115,111,109])
  for(const [k,v] of Object.entries({attemptToken:token,email:EMAIL,consentVersion:CONSENT_VERSION,processing:'true',emailResults:'true',share:'false'}))f.set(k,v)
  f.set('video',new Blob([b],{type:'video/mp4'}),'synthetic.mp4')
  return new Request('https://kiosk.invalid/scan',{method:'POST',body:f})
}
async function until(predicate) { for(let i=0;i<100;i++){ if(predicate())return; await new Promise(r=>setImmediate(r)) } assert.fail('Synthetic barrier was not reached') }

test('RT01 challenge does not expose matched booking existence or booking ID',async()=>{
  const w=world();const c=await challenge(w)
  const payload=JSON.parse(Buffer.from(c.challengeToken.split('.')[0],'base64url').toString())
  assert.equal(payload.b,undefined,'Readable signed challenge exposes the matched booking ID; decoy carries null')
})
test('RT02 a consumed inbox code stays consumed across worker replacement',async()=>{
  const w=world();const c=await challenge(w)
  assert.equal((await handleVerify(request('/verify',c),w.deps)).status,200)
  const other={...w.deps,brakes:new Brakes()}
  const replay=await handleVerify(request('/verify',c),other)
  assert.equal(replay.status,429,'Fresh worker accepted the same consumed code and minted another attempt')
})
test('RT03 parallel distinct attempts cannot exceed two process dispatches for one booking-day',async()=>{
  const w=world(); const a=await attempt(w);const b=await attempt(w);const c=await attempt(w)
  assert.equal((await handleScan(scanReq(a),w.deps)).status,200)
  w.state.processMode='hold'
  let settled=0
  const pending=[handleScan(scanReq(b),w.deps),handleScan(scanReq(c),w.deps)].map(p=>p.then(r=>{settled++;return r}))
  await until(()=>w.state.hold.length+settled===2)
  w.state.hold.splice(0).forEach(release=>release()); await Promise.all(pending)
  assert.equal(w.state.process.length,2,'One completed dispatch plus two concurrent dispatches bypassed the daily cap')
})
test('RT04 unknown process outcome blocks a new attempt/key for the same booking until reconciliation',async()=>{
  const w=world();const a=await attempt(w); w.state.processMode='unknown'
  assert.equal((await handleScan(scanReq(a),w.deps)).status,202)
  const b=await attempt(w);await handleScan(scanReq(b),w.deps)
  assert.equal(w.state.process.length,1,'Unknown outcome was followed by another chargeable process under a fresh key')
})
test('RT05 temporary booking read failure does not burn a valid unused code',async()=>{
  const w=world();const c=await challenge(w);w.state.detailFail=true
  assert.equal((await handleVerify(request('/verify',c),w.deps)).status,503)
  w.state.detailFail=false
  const retry=await handleVerify(request('/verify',c),w.deps)
  assert.equal(retry.status,200,'Valid code was marked used before the transient Calendesk read failure')
})
