import assert from 'node:assert/strict'
import { Brakes } from '../lib/wellness/limits.ts'
import { MemoryStateStore } from '../lib/wellness/state-memory.ts'
import { handleBooking, handleVerify, handleScan } from '../lib/wellness/http.ts'
import { CONSENT_VERSION } from '../lib/wellness/consent.ts'
export const EMAIL = 'synthetic@example.invalid'
export const NOW = new Date('2026-10-19T04:00:00Z')
export const UPLOAD_HOST = 'synthetic-bucket.s3.amazonaws.com'
export const admittedEnv = {
 SCANS_ENABLED:'1', FACEPHYS_KEY_ID:'synthetic-key', FACEPHYS_SECRET_KEY:'synthetic-secret-for-isolated-tests',
 CALENDESK_API_KEY:'synthetic-cd', RESEND_API_KEY:'synthetic-mail', FACEPHYS_BASE_URL:'https://facephys.invalid',
 CALENDESK_API_BASE:'https://calendesk.invalid', EMAIL_API_BASE:'https://mail.invalid', FACEPHYS_UPLOAD_HOSTS:UPLOAD_HOST,
 CONSENT_RETENTION_DAYS:'30', CONSENT_RETENTION_POLICY:'dmk-30-days-v1'
}
export const json = (x,status=200) => new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}})
export const post = (path,body) => new Request('https://kiosk.invalid'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
export function world() {
 let now = NOW
 const effects={mail:[],process:[],presign:0,upload:0,events:[],processMode:'completed',presignFail:false,detailFail:false,held:[]}
 const shared = new MemoryStateStore(()=>now)
 const store = {transition:async command=>{
  const reply=await shared.transition(command)
  effects.events.push({kind:command.kind,reply:reply.kind})
  return reply
 }}
 const row={id:501,status:'approved',location:{location_id:6,id:44},service_id:8,employee_id:null,start_date:'2026-10-19',user:{email:EMAIL}}
 const makeDeps=()=>{
 let claim=null
 const scopedState={transition:async command=>{
  if(command.kind==='begin_check')claim=null
  const reply=await store.transition(command)
  if(command.kind==='begin_check'&&reply.kind==='granted')claim={attemptId:command.attemptId,owner:command.owner,authorized:false,processed:false}
  if(command.kind==='authorize_process'&&reply.kind==='authorized'){
   assert.ok(claim&&claim.attemptId===command.attemptId&&claim.owner===command.owner,'Grant belongs to a different request')
   claim.authorized=true
  }
  return reply
 }}
 return {env:{...admittedEnv},state:scopedState,brakes:new Brakes(),now:()=>now,wait:async()=>{},log:()=>{},fetch:async(input,init={})=>{
  const u=new URL(String(input))
  if(u.hostname==='calendesk.invalid')return effects.detailFail?json({},503):u.pathname.endsWith('/v2')?json({data:[row],last_page:1}):json({data:row})
  if(u.hostname==='mail.invalid'){effects.mail.push(JSON.parse(init.body));return json({id:'synthetic-provider-acceptance'})}
  if(u.hostname==='facephys.invalid'&&u.pathname.endsWith('/presign')){
   effects.presign++
   assert.ok(claim&&!claim.processed,'No committed consent+reservation for this request before first provider effect')
   return effects.presignFail?json({},503):json({uploadUrl:'https://'+UPLOAD_HOST+'/clip',objectKey:'synthetic-clip'})
  }
  if(u.hostname===UPLOAD_HOST){effects.upload++;return new Response('',{status:200})}
  if(u.hostname==='facephys.invalid'&&u.pathname.endsWith('/process')){
   assert.ok(claim&&claim.authorized&&!claim.processed,'No one-time permission for this request')
   const body=JSON.parse(init.body)
   assert.equal(body.idempotencyKey,'dmk-'+claim.attemptId,'Process key differs from this request grant')
   claim.processed=true
   effects.process.push(body)
   if(effects.processMode==='unknown')return json({},503)
   if(effects.processMode==='hold')return new Promise(resolve=>effects.held.push(()=>resolve(json({heartRate:72,sqi:.9}))))
   return json({heartRate:72,sqi:.9})
  }
  throw new Error('Unexpected synthetic boundary '+u.hostname+u.pathname)
 }}
 }
 const deps=makeDeps()
 return {deps,effects,shared,setNow:value=>{now=value},other:makeDeps}
}
export async function challenge(w) {
 const r=await handleBooking(post('/booking',{email:EMAIL}),w.deps);assert.equal(r.status,200)
 const body=await r.json(), code=w.effects.mail.at(-1).text.match(/\b\d{6}\b/)[0]
 return {challengeToken:body.challengeToken,email:EMAIL,code}
}
export async function attempt(w) {
 const c=await challenge(w),r=await handleVerify(post('/verify',c),w.deps);assert.equal(r.status,200)
 return (await r.json()).attemptToken
}
export function scanRequest(token) {
 const f=new FormData(),b=new Uint8Array(2048);b.set([0,0,0,24,102,116,121,112,105,115,111,109])
 for(const [k,v] of Object.entries({attemptToken:token,email:EMAIL,consentVersion:CONSENT_VERSION,processing:'true',emailResults:'true',share:'false'}))f.set(k,v)
 f.set('video',new Blob([b],{type:'video/mp4'}),'synthetic.mp4')
 return new Request('https://kiosk.invalid/scan',{method:'POST',body:f})
}
export {handleBooking,handleVerify,handleScan}
