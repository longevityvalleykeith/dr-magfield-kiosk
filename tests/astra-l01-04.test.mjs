import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleBooking } from '../lib/wellness/http.ts'
import { KioskController } from '../lib/wellness/controller.ts'
import { Brakes } from '../lib/wellness/limits.ts'
const EMAIL='synthetic@example.invalid'
const NOW=new Date('2026-10-19T02:41:00Z')
const full={id:9021,status:'approved',location:{id:48,location_id:6},service_id:16,employee_id:4,start_date:'2026-10-19',starts_at:'2026-10-19T04:00:00Z',user:{email:EMAIL}}
const env={SCANS_ENABLED:'1',FACEPHYS_KEY_ID:'synthetic-key',FACEPHYS_SECRET_KEY:'synthetic-secret-isolated',CALENDESK_API_KEY:'synthetic-cd',RESEND_API_KEY:'synthetic-mail',CALENDESK_API_BASE:'https://calendar.invalid',EMAIL_API_BASE:'https://mail.invalid'}
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}})
function world(summary,detail=full){
 const calls={list:0,detail:0,mail:0};const events=[]
 const deps={env,now:()=>NOW,brakes:new Brakes(),log:(event,fields)=>events.push({event,fields}),fetch:async(input,init={})=>{
  const u=new URL(String(input))
  if(u.hostname==='calendar.invalid'&&u.pathname.endsWith('/v2')){calls.list++;return json({data:[summary],last_page:1})}
  if(u.hostname==='calendar.invalid'&&u.pathname.endsWith('/9021')){calls.detail++;return json({data:detail})}
  if(u.hostname==='mail.invalid'){calls.mail++;return json({id:'synthetic-provider-acceptance'})}
  throw Error('Unexpected synthetic boundary')
 }}
 return {deps,calls,events}
}
const req=email=>new Request('https://kiosk.invalid/booking',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})})

test('L01 complete eligible summary sends one synthetic code email',async()=>{
 const w=world(full);const r=await handleBooking(req(EMAIL),w.deps)
 assert.equal(r.status,200);assert.equal((await r.json()).status,'code_sent');assert.equal(w.calls.mail,1);assert.ok(w.events.some(e=>e.event==='code_sent'))
 assert.equal(w.calls.detail,1,'An eligible summary still needs authoritative confirmation before mail')
})
test('L02 unknown summary location is resolved from authoritative detail before declaring no match',async()=>{
 const sparse={...full};delete sparse.location
 const w=world(sparse);const r=await handleBooking(req(EMAIL),w.deps)
 assert.equal(r.status,200)
 assert.equal(w.calls.mail,1,'An eligible detail exists, but the missing-location summary was discarded before hydration')
 assert.equal(w.calls.detail,1)
})
test('L03 authoritative wrong-outlet booking never sends a code',async()=>{
 const wrong={...full,location:{id:46,location_id:5}}
 const w=world(wrong,wrong);await handleBooking(req(EMAIL),w.deps)
 assert.equal(w.calls.mail,0);assert.equal(w.calls.detail,1)
})
test('L04 generic code screen is reachable without any mail attempt',async()=>{
 const w=world(full)
 const api={booking:async input=>{const r=await handleBooking(req(input.email),w.deps);return {status:r.status,body:await r.json()}}}
 const media={supported:()=>false,isOpen:()=>false,close(){},async open(){throw Error('not used')},async record(){throw Error('not used')}}
 const c=new KioskController({api,media,scanSeconds:10});c.start();await c.submitBooking('','other-synthetic@example.invalid')
 assert.equal(c.state.screen,'code');assert.equal(w.calls.mail,0);assert.ok(w.events.some(e=>e.event==='booking_refused'))
})
