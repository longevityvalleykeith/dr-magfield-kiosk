import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {MemoryStateStore} from '../lib/wellness/state-memory.ts'
import {makeRpcStateStore,readStateConfig} from '../lib/wellness/state-rpc.ts'
import {world,challenge,attempt,post,scanRequest,handleBooking,handleVerify,handleScan,NOW} from './state-world.mjs'

const day='2026-10-19',dayRef='a'.repeat(64), uid=()=>randomUUID()
const intent=()=>({schemaVersion:'dmk-consent-v3',bookingRef:'b'.repeat(64),tenantId:'dr-magfield',calendeskAccountRef:'c'.repeat(64),locationId:6,serviceLocationId:44,serviceId:8,serviceTypeId:null,careEmployeeId:null,subjectBinding:'booking-inbox-code-v1',purpose:'optional-wellness-indicators-cloud-v3',noticeVersion:'dmk-cloud-v3-2026-10-19',processingDecision:'agreed',emailResultsDecision:'agreed',careCcDecision:'declined',guestRecipientRef:'d'.repeat(64),careRecipientRef:null,sourceSurface:'dmk-kiosk',verificationCheckedAt:NOW.toISOString(),verificationPolicyVersion:'dmk-entity-match-v1',retentionPolicyVersion:'dmk-30-days-v1'})
async function ready(store){
 const challengeId=uid(), owner=uid(),attemptId=uid()
 assert.equal((await store.transition({kind:'take_code',challengeId,dayRef,day})).kind,'granted')
 assert.equal((await store.transition({kind:'claim_code',challengeId,owner,correct:true})).kind,'granted')
 assert.equal((await store.transition({kind:'consume_code',challengeId,owner,attemptId,dayRef,day})).kind,'consumed')
 return {attemptId,dayRef,owner:uid()}
}
const begin=(s,c,i=intent())=>s.transition({kind:'begin_check',...c,intent:i})
const command=(s,c,kind,extra={})=>s.transition({kind,...c,...extra})
const jwt=(claims)=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.syntheticSignature'
const configEnv=()=>({KIOSK_STATE_URL:'https://abcdefghijklmnopqrst.supabase.co',KIOSK_STATE_PUBLISHABLE_KEY:'sb_publishable_synthetickeyforisolatedtests',KIOSK_STATE_JWT:jwt({role:'kiosk_wellness',iat:Math.floor(NOW.getTime()/1000)-60,exp:Math.floor(NOW.getTime()/1000)+3600})})

test('DS01 shared wrong-code count locks the fifth guess and refuses a correct sixth',async()=>{
 const s=new MemoryStateStore(()=>NOW),challengeId=uid()
 await s.transition({kind:'take_code',challengeId,dayRef,day})
 for(let i=1;i<=5;i++)assert.equal((await s.transition({kind:'claim_code',challengeId,owner:uid(),correct:false})).kind,i===5?'locked':'wrong')
 assert.equal((await s.transition({kind:'claim_code',challengeId,owner:uid(),correct:true})).kind,'locked')
})
test('DS02 only three distinct code grants across workers; duplicates grant no mail',async()=>{
 const s=new MemoryStateStore(()=>NOW),first={kind:'take_code',challengeId:uid(),dayRef,day}
 assert.equal((await s.transition(first)).kind,'granted')
 assert.notEqual((await s.transition(first)).kind,'granted')
 for(let i=0;i<2;i++)assert.equal((await s.transition({...first,challengeId:uid()})).kind,'granted')
 assert.equal((await s.transition({...first,challengeId:uid()})).kind,'capped')
})
test('DS03 reservation and minimal consent fail together, then valid input can reserve',async()=>{
 const s=new MemoryStateStore(()=>NOW),c=await ready(s)
 assert.equal((await begin(s,c,{...intent(),email:'forbidden@example.invalid'})).kind,'invalid')
 assert.equal((await begin(s,c)).kind,'granted')
})
test('DS04 same-attempt concurrent owners receive exactly one grant',async()=>{
 const s=new MemoryStateStore(()=>NOW),c=await ready(s)
 const replies=await Promise.all(Array.from({length:16},()=>begin(s,{...c,owner:uid()})))
 assert.equal(replies.filter(r=>r.kind==='granted').length,1)
 assert.equal(replies.filter(r=>r.kind==='pending').length,15)
})
test('DS05 stale release and old-owner regrant cannot displace a later owner',async()=>{
 const s=new MemoryStateStore(()=>NOW),c=await ready(s)
 assert.equal((await begin(s,c)).kind,'granted')
 assert.equal((await command(s,c,'release_check')).kind,'released')
 const second={...c,owner:uid()}
 assert.equal((await begin(s,second)).kind,'granted')
 assert.equal((await command(s,c,'release_check')).kind,'stale')
 assert.equal((await command(s,second,'release_check')).kind,'released')
 assert.notEqual((await begin(s,c)).kind,'granted')
})
test('DS06 process permission is one-time and prevents safe-release fraud',async()=>{
 const s=new MemoryStateStore(()=>NOW),c=await ready(s);await begin(s,c)
 assert.equal((await command(s,c,'authorize_process')).kind,'authorized')
 assert.notEqual((await command(s,c,'authorize_process')).kind,'authorized')
 assert.equal((await command(s,c,'release_check')).kind,'stale')
})
test('DS07 unfinalized process holds fresh attempts; time is not reconciliation',async()=>{
 let now=NOW;const s=new MemoryStateStore(()=>now),a=await ready(s),b=await ready(s)
 await begin(s,a);await command(s,a,'authorize_process')
 now=new Date(NOW.getTime()+60_000)
 assert.equal((await begin(s,b)).kind,'pending')
 assert.notEqual((await command(s,b,'authorize_process')).kind,'authorized')
})
test('DS08 known outcomes permit two sequential checks and cap the third',async()=>{
 const s=new MemoryStateStore(()=>NOW),a=await ready(s),b=await ready(s),c=await ready(s)
 for(const item of [a,b]){
  assert.equal((await begin(s,item)).kind,'granted')
  assert.equal((await command(s,item,'authorize_process')).kind,'authorized')
  assert.equal((await command(s,item,'finish_check',{outcome:'completed',delivery:'sent'})).kind,'finished')
 }
 assert.equal((await begin(s,c)).kind,'capped')
})
test('DS09 a consumed code cannot issue a second attempt even with a reused owner',async()=>{
 const s=new MemoryStateStore(()=>NOW),challengeId=uid(),owner=uid()
 await s.transition({kind:'take_code',challengeId,dayRef,day});await s.transition({kind:'claim_code',challengeId,owner,correct:true})
 assert.equal((await s.transition({kind:'consume_code',challengeId,owner,attemptId:uid(),dayRef,day})).kind,'consumed')
 assert.notEqual((await s.transition({kind:'consume_code',challengeId,owner,attemptId:uid(),dayRef,day})).kind,'consumed')
})
test('DS10 stale code release cannot clear a replacement claim',async()=>{
 const s=new MemoryStateStore(()=>NOW),challengeId=uid(),owner=uid()
 await s.transition({kind:'take_code',challengeId,dayRef,day});await s.transition({kind:'claim_code',challengeId,owner,correct:true})
 assert.equal((await s.transition({kind:'release_code',challengeId,owner})).kind,'released')
 const next=uid();assert.equal((await s.transition({kind:'claim_code',challengeId,owner:next,correct:true})).kind,'granted')
 assert.equal((await s.transition({kind:'release_code',challengeId,owner})).kind,'stale')
})
test('DS11 role JWT alone is never an apikey or configured transport',()=>{
 const e=configEnv();delete e.KIOSK_STATE_PUBLISHABLE_KEY;assert.equal(readStateConfig(e,NOW),null)
 const roleAsKey={...configEnv(),KIOSK_STATE_PUBLISHABLE_KEY:configEnv().KIOSK_STATE_JWT};assert.equal(readStateConfig(roleAsKey,NOW),null)
})
test('DS12 expired, wrong-role, future-issued and overlong role credentials fail configuration',()=>{
 const now=Math.floor(NOW.getTime()/1000)
 for(const claims of [{role:'kiosk_wellness',iat:now-60,exp:now-1},{role:'service_role',iat:now-60,exp:now+100},{role:'kiosk_wellness',iat:now+10,exp:now+100},{role:'kiosk_wellness',iat:now-1,exp:now+91*86400}])assert.equal(readStateConfig({...configEnv(),KIOSK_STATE_JWT:jwt(claims)},NOW),null)
})
test('DS13 transport uses mandatory separate credentials and no redirect',async()=>{
 const e=configEnv(),cfg=readStateConfig(e,NOW);assert.ok(cfg)
 let calls=0
 const store=makeRpcStateStore(cfg,async(url,init)=>{
  calls++;assert.equal(url,e.KIOSK_STATE_URL+'/rest/v1/rpc/kiosk_wellness_transition')
  const h=new Headers(init.headers);assert.equal(h.get('apikey'),e.KIOSK_STATE_PUBLISHABLE_KEY);assert.equal(h.get('authorization'),'Bearer '+e.KIOSK_STATE_JWT)
  assert.equal(init.redirect,'error');assert.equal(init.method,'POST')
  assert.deepEqual(JSON.parse(init.body),{p_command:{kind:'take_code',challengeId:id,dayRef,day}})
  return new Response(JSON.stringify({kind:'granted'}),{status:200})
 },()=>NOW)
 const id=uid();assert.equal((await store.transition({kind:'take_code',challengeId:id,dayRef,day})).kind,'granted');assert.equal(calls,1)
})
test('DS14 malformed or impossible RPC replies fail closed without retry',async()=>{
 const cfg=readStateConfig(configEnv(),NOW);assert.ok(cfg)
 for(const reply of [{kind:'authorized'},{kind:'granted',email:'forbidden'},null,[],{kind:'new_status'}]){
  let n=0;const s=makeRpcStateStore(cfg,async()=>{n++;return new Response(JSON.stringify(reply),{status:200})},()=>NOW)
  assert.equal((await s.transition({kind:'take_code',challengeId:uid(),dayRef,day})).kind,'unavailable');assert.equal(n,1)
 }
})
test('DS15 arbitrary origins, userinfo, paths and privileged keys are refused',()=>{
 const e=configEnv()
 for(const url of ['https://outside.example','https://user@abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co/private','http://abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co?next=outside'])assert.equal(readStateConfig({...e,KIOSK_STATE_URL:url},NOW),null)
 for(const key of ['sb_secret_fake',jwt({role:'service_role'}),jwt({role:'anon'})])assert.equal(readStateConfig({...e,KIOSK_STATE_PUBLISHABLE_KEY:key},NOW),null)
})

test('DI01 two sequential booking checks deliver only to the verified inbox; third is refused',async()=>{
 const w=world(),tokens=[await attempt(w),await attempt(w),await attempt(w)]
 assert.equal((await handleScan(scanRequest(tokens[0]),w.deps)).status,200)
 assert.equal((await handleScan(scanRequest(tokens[1]),w.other())).status,200)
 assert.equal((await handleScan(scanRequest(tokens[2]),w.other())).status,409)
 assert.equal(w.effects.process.length,2)
 const results=w.effects.mail.filter(m=>!String(m.subject).toLowerCase().includes('code'))
 assert.equal(results.length,2)
 for(const mail of results){assert.ok(JSON.stringify(mail.to).includes('synthetic@example.invalid'));assert.ok(!mail.cc||mail.cc.length===0)}
})
test('DI02 known presign failure releases slot; same token can recover on a fresh worker',async()=>{
 const w=world(),token=await attempt(w);w.effects.presignFail=true
 assert.equal((await handleScan(scanRequest(token),w.deps)).status,502);assert.equal(w.effects.process.length,0)
 w.effects.presignFail=false;assert.equal((await handleScan(scanRequest(token),w.other())).status,200);assert.equal(w.effects.process.length,1)
})
test('DI03 unknown outcome blocks both the same attempt and a fresh key across workers',async()=>{
 const w=world(),a=await attempt(w),b=await attempt(w);w.effects.processMode='unknown'
 assert.equal((await handleScan(scanRequest(a),w.deps)).status,202)
 assert.equal((await handleScan(scanRequest(a),w.other())).status,409)
 assert.equal((await handleScan(scanRequest(b),w.other())).status,409)
 assert.equal(w.effects.process.length,1)
})
test('DI04 store unavailable at atomic begin sends no video and no charge request',async()=>{
 const w=world(),a=await attempt(w),underlying=w.deps.state
 w.deps.state={transition:cmd=>cmd.kind==='begin_check'?Promise.resolve({kind:'unavailable'}):underlying.transition(cmd)}
 assert.equal((await handleScan(scanRequest(a),w.deps)).status,503)
 assert.equal(w.effects.presign,0);assert.equal(w.effects.upload,0);assert.equal(w.effects.process.length,0)
})
test('DI05 lost process-permission reply never calls process; fresh keys remain held',async()=>{
 const w=world(),a=await attempt(w),b=await attempt(w),underlying=w.deps.state
 w.deps.state={transition:async cmd=>{const r=await underlying.transition(cmd);return cmd.kind==='authorize_process'&&r.kind==='authorized'?{kind:'unavailable'}:r}}
 const first=await handleScan(scanRequest(a),w.deps)
 assert.ok([202,503].includes(first.status));assert.equal(w.effects.process.length,0)
 assert.equal((await handleScan(scanRequest(b),w.other())).status,409);assert.equal(w.effects.process.length,0)
})
test('DI06 five wrong guesses survive worker changes and no valid sixth mints an attempt',async()=>{
 const w=world(),c=await challenge(w),wrong=c.code==='000000'?'111111':'000000'
 for(let i=1;i<=5;i++)assert.equal((await handleVerify(post('/verify',{...c,code:wrong}),w.other())).status,400)
 assert.equal((await handleVerify(post('/verify',c),w.other())).status,429)
 assert.equal(w.effects.process.length,0)
})
test('DI07 same attempt racing on fresh workers dispatches at most once',async()=>{
 const w=world(),token=await attempt(w)
 const replies=await Promise.all(Array.from({length:8},()=>handleScan(scanRequest(token),w.other())))
 assert.equal(replies.filter(r=>r.status===200).length,1);assert.equal(w.effects.process.length,1)
})

test('DI08 wrong-code replies do not reveal registered, decoy or five-guess locked challenges',async()=>{
 const a=world(),b=world(),used=world(),wa=[],wb=[],wu=[]
 a.deps.wait=async ms=>wa.push(ms);b.deps.wait=async ms=>wb.push(ms);used.deps.wait=async ms=>wu.push(ms)
 const c=await challenge(a),uc=await challenge(used)
 assert.equal((await handleVerify(post('/verify',uc),used.deps)).status,200);wu.length=0
 const absent='absent@example.invalid'
 const decoyReply=await handleBooking(post('/booking',{email:absent}),b.deps)
 assert.equal(decoyReply.status,200)
 const decoy=await decoyReply.json();wa.length=0;wb.length=0
 const wrong=c.code==='000000'?'111111':'000000'
 const publicReplies=[]
 for(let i=0;i<6;i++){
  const r=await handleVerify(post('/verify',{...c,code:wrong}),a.deps)
  publicReplies.push({status:r.status,body:await r.json()})
 }
 const noMatch=await handleVerify(post('/verify',{challengeToken:decoy.challengeToken,email:absent,code:'000000'}),b.deps)
 const absentReply={status:noMatch.status,body:await noMatch.json()}
 const usedWrong=uc.code==='000000'?'111111':'000000'
 const ur=await handleVerify(post('/verify',{...uc,code:usedWrong}),used.deps)
 publicReplies.push({status:ur.status,body:await ur.json()})
 for(const reply of publicReplies)assert.deepEqual(reply,absentReply)
 assert.deepEqual(wu,[2500])
 assert.deepEqual(wa,Array(6).fill(2500));assert.deepEqual(wb,[2500])
 assert.equal((await handleVerify(post('/verify',c),a.deps)).status,429,'Actual five-guess lock was weakened')
})
