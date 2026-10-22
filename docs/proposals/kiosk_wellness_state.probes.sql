-- PREPARED PROBES ONLY: NOT_EXECUTED. Review before use in a disposable database.
-- Assumes separately admitted source was installed there by its migration owner.
-- No JWT is minted and no HTTP/JWT signature or Data API exposure is proved here.
-- The main block uses synthetic references, then ROLLBACK removes every fixture.
begin;

do $privileges$
declare
  r record;
  t text;
  actor text;
begin
  select * into strict r from pg_catalog.pg_roles where rolname = 'kiosk_wellness';
  if r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole
    or r.rolreplication or r.rolbypassrls or r.rolinherit then
    raise exception 'FAIL: unsafe kiosk role attributes';
  end if;
  if not pg_catalog.pg_has_role('authenticator','kiosk_wellness','MEMBER') then
    raise exception 'FAIL: authenticator cannot assume kiosk role';
  end if;
  if pg_catalog.has_schema_privilege('kiosk_wellness','public','CREATE')
    or pg_catalog.has_schema_privilege('kiosk_wellness','kiosk','USAGE')
    or pg_catalog.has_schema_privilege('kiosk_wellness','kiosk','CREATE') then
    raise exception 'FAIL: kiosk role has schema privileges beyond public USAGE';
  end if;
  foreach actor in array array['anon','authenticated','service_role','kiosk_wellness'] loop
    foreach t in array array['wellness_day','wellness_challenge','wellness_attempt','consent_record'] loop
      if pg_catalog.has_table_privilege(actor,'kiosk.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'FAIL: table privilege for % on %',actor,t;
      end if;
    end loop;
    if pg_catalog.has_function_privilege(actor,'kiosk.wellness_cleanup()','EXECUTE')
      or pg_catalog.has_function_privilege(actor,'kiosk.positive_id(jsonb,boolean)','EXECUTE') then
      raise exception 'FAIL: private helper executable by %',actor;
    end if;
    if pg_catalog.has_function_privilege(actor,'public.kiosk_wellness_transition(jsonb)','EXECUTE')
      is distinct from (actor = 'kiosk_wellness') then
      raise exception 'FAIL: facade EXECUTE for %',actor;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='kiosk' and c.relkind='r' and not c.relrowsecurity) then
    raise exception 'FAIL: private table without RLS';
  end if;
end
$privileges$;

-- Actual negative SQL permission probes; spoofing claims cannot grant EXECUTE.
set local role anon;
do $negative_anon$
begin
  begin
    perform public.kiosk_wellness_transition('{"kind":"reconcile"}'::jsonb);
    raise exception 'FAIL: anon could execute facade';
  exception when insufficient_privilege then null;
  end;
end
$negative_anon$;
reset role;
set local role authenticated;
do $negative_authenticated$
begin
  begin
    perform public.kiosk_wellness_transition('{"kind":"reconcile"}'::jsonb);
    raise exception 'FAIL: authenticated could execute facade';
  exception when insufficient_privilege then null;
  end;
end
$negative_authenticated$;
reset role;

set local role kiosk_wellness;
do $protocol$
declare
  today text := (pg_catalog.clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date::text;
  epoch bigint := pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  ref text := pg_catalog.repeat('a',64);
  lock_ref text := pg_catalog.repeat('b',64);
  hold_ref text := pg_catalog.repeat('c',64);
  retry_ref text := pg_catalog.repeat('d',64);
  intent jsonb;
  cmd jsonb;
  got jsonb;
  i integer;
  cid text;
  aid text;
  code_owner text;
  check_owner text;
begin
  intent := pg_catalog.jsonb_build_object(
    'schemaVersion','dmk-consent-v3','bookingRef',pg_catalog.repeat('1',64),
    'tenantId','synthetic-kiosk','calendeskAccountRef',pg_catalog.repeat('2',64),
    'locationId',6,'serviceLocationId',null,'serviceId',8,'serviceTypeId',null,'careEmployeeId',null,
    'subjectBinding','booking-inbox-code-v1','purpose','optional-wellness-indicators-cloud-v3',
    'noticeVersion','dmk-cloud-v3-2026-10-19','processingDecision','agreed','emailResultsDecision','agreed',
    'careCcDecision','unavailable','guestRecipientRef',pg_catalog.repeat('3',64),'careRecipientRef',null,
    'sourceSurface','dmk-kiosk','verificationCheckedAt',pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'verificationPolicyVersion','dmk-entity-match-v1','retentionPolicyVersion','dmk-30-days-v1');

  -- An assumed SQL role with absent/mismatched/overlong/expired claims fails closed.
  cmd := pg_catalog.jsonb_build_object('kind','take_code','challengeId','10000000-0000-4000-8000-000000000001','dayRef',ref,'day',today);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: missing claims'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('role','authenticated','iat',epoch,'exp',epoch+60)::text,true);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: wrong role claim'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('role','kiosk_wellness','iat',epoch-1,'exp',epoch-1)::text,true);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: expired claim'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('role','kiosk_wellness','iat',epoch,'exp',epoch+7776001)::text,true);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: overlong claim'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('role','kiosk_wellness','iat',epoch,'exp',epoch+3600)::text,true);

  -- Closed command union, exact keys/types, and current-MYT-day authority.
  if public.kiosk_wellness_transition('{"kind":"reconcile"}'::jsonb)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: reconcile accepted'; end if;
  if public.kiosk_wellness_transition(cmd || '{"rawBookingId":42}'::jsonb)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: extra command key'; end if;
  if public.kiosk_wellness_transition(cmd - 'day')->>'kind' is distinct from 'invalid' then raise exception 'FAIL: missing command key'; end if;
  if public.kiosk_wellness_transition(cmd || '{"challengeId":42}'::jsonb)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: non UUID'; end if;
  if public.kiosk_wellness_transition(cmd || '{"dayRef":"raw-booking"}'::jsonb)->>'kind' is distinct from 'invalid' then raise exception 'FAIL: raw reference'; end if;
  if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('day',((today::date)-1)::text))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: old day'; end if;

  -- Two sequential known checks succeed; the third consumes a code but is capped.
  for i in 1..3 loop
    cid := '10000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0');
    aid := '20000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0');
    code_owner := '30000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0');
    check_owner := '40000000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0');
    cmd := pg_catalog.jsonb_build_object('kind','take_code','challengeId',cid,'dayRef',ref,'day',today);
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: take code %',i; end if;
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'capped' then raise exception 'FAIL: duplicate take regranted'; end if;
    cmd := pg_catalog.jsonb_build_object('kind','claim_code','challengeId',cid,'owner',code_owner,'correct',true);
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: claim %',i; end if;
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'locked' then raise exception 'FAIL: claim regranted'; end if;
    cmd := pg_catalog.jsonb_build_object('kind','consume_code','challengeId',cid,'owner',code_owner,'attemptId',aid,'dayRef',ref,'day',today);
    if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('dayRef',lock_ref))->>'kind' is distinct from 'stale' then raise exception 'FAIL: cross-day consume'; end if;
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'consumed' then raise exception 'FAIL: consume %',i; end if;
    if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'stale' then raise exception 'FAIL: consumed twice'; end if;
    cmd := pg_catalog.jsonb_build_object('kind','begin_check','attemptId',aid,'dayRef',ref,'owner',check_owner,'intent',intent);
    if i <= 2 then
      if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('intent',intent||'{"email":"forbidden"}'::jsonb))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: extra intent key'; end if;
      if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('intent',intent||'{"locationId":0}'::jsonb))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: zero ID'; end if;
      if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('intent',intent||'{"serviceId":1.5}'::jsonb))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: fractional ID'; end if;
      if public.kiosk_wellness_transition(cmd || pg_catalog.jsonb_build_object('intent',intent||'{"careCcDecision":"agreed"}'::jsonb))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: CC enabled'; end if;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: begin %',i; end if;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'pending' then raise exception 'FAIL: begin replay not held'; end if;
      cmd := cmd - 'intent' || '{"kind":"authorize_process"}'::jsonb;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'authorized' then raise exception 'FAIL: authorize %',i; end if;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'stale' then raise exception 'FAIL: authorize regranted'; end if;
      if public.kiosk_wellness_transition(cmd||'{"kind":"release_check"}'::jsonb)->>'kind' is distinct from 'stale' then raise exception 'FAIL: released after process'; end if;
      cmd := cmd || '{"kind":"finish_check","outcome":"completed","delivery":"sent"}'::jsonb;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'finished' then raise exception 'FAIL: finish %',i; end if;
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'finished' then raise exception 'FAIL: duplicate identical finish'; end if;
      if public.kiosk_wellness_transition(cmd||'{"outcome":"failed"}'::jsonb)->>'kind' is distinct from 'stale' then raise exception 'FAIL: changed terminal outcome'; end if;
    else
      if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'capped' then raise exception 'FAIL: third check uncapped'; end if;
    end if;
  end loop;
  cmd := pg_catalog.jsonb_build_object('kind','take_code','challengeId','10000000-0000-4000-8000-000000000004','dayRef',ref,'day',today);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'capped' then raise exception 'FAIL: fourth code uncapped'; end if;

  -- Five wrong guesses remain cumulative after a known transient release.
  cid := '10000000-0000-4000-8000-000000000010';
  code_owner := '30000000-0000-4000-8000-000000000010';
  cmd := pg_catalog.jsonb_build_object('kind','take_code','challengeId',cid,'dayRef',lock_ref,'day',today);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: lock fixture'; end if;
  cmd := pg_catalog.jsonb_build_object('kind','claim_code','challengeId',cid,'owner',code_owner,'correct',false);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'wrong' then raise exception 'FAIL: initial wrong'; end if;
  if public.kiosk_wellness_transition(cmd||'{"correct":true}'::jsonb)->>'kind' is distinct from 'granted' then raise exception 'FAIL: transient claim'; end if;
  cmd := cmd - 'correct' || '{"kind":"release_code"}'::jsonb;
  if public.kiosk_wellness_transition(cmd||'{"owner":"30000000-0000-4000-8000-000000000011"}'::jsonb)->>'kind' is distinct from 'stale' then raise exception 'FAIL: stale release'; end if;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'released' then raise exception 'FAIL: release current code'; end if;
  cmd := cmd||'{"kind":"claim_code","correct":true}'::jsonb;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'locked' then raise exception 'FAIL: released code owner regranted'; end if;
  cmd := cmd||'{"owner":"30000000-0000-4000-8000-000000000012","correct":false}'::jsonb;
  for i in 2..5 loop
    got := public.kiosk_wellness_transition(cmd);
    if got->>'kind' is distinct from case when i=5 then 'locked' else 'wrong' end then raise exception 'FAIL: wrong counter %',i; end if;
  end loop;
  if public.kiosk_wellness_transition(cmd||'{"correct":true}'::jsonb)->>'kind' is distinct from 'locked' then raise exception 'FAIL: fifth wrong did not lock'; end if;

  -- A safe pre-process retry uses a fresh owner; changed immutable intent fails.
  cid := '10000000-0000-4000-8000-000000000020';
  aid := '20000000-0000-4000-8000-000000000020';
  code_owner := '30000000-0000-4000-8000-000000000020';
  check_owner := '40000000-0000-4000-8000-000000000020';
  if public.kiosk_wellness_transition(pg_catalog.jsonb_build_object('kind','take_code','challengeId',cid,'dayRef',retry_ref,'day',today))->>'kind' is distinct from 'granted' then raise exception 'FAIL: retry take'; end if;
  if public.kiosk_wellness_transition(pg_catalog.jsonb_build_object('kind','claim_code','challengeId',cid,'owner',code_owner,'correct',true))->>'kind' is distinct from 'granted' then raise exception 'FAIL: retry claim'; end if;
  if public.kiosk_wellness_transition(pg_catalog.jsonb_build_object('kind','consume_code','challengeId',cid,'owner',code_owner,'attemptId',aid,'dayRef',retry_ref,'day',today))->>'kind' is distinct from 'consumed' then raise exception 'FAIL: retry consume'; end if;
  cmd := pg_catalog.jsonb_build_object('kind','begin_check','attemptId',aid,'dayRef',retry_ref,'owner',check_owner,'intent',intent);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: retry begin'; end if;
  if public.kiosk_wellness_transition(cmd - 'intent' || '{"kind":"release_check"}'::jsonb)->>'kind' is distinct from 'released' then raise exception 'FAIL: retry release'; end if;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'stale' then raise exception 'FAIL: old attempt owner regranted'; end if;
  cmd := cmd||'{"owner":"40000000-0000-4000-8000-000000000021"}'::jsonb;
  if public.kiosk_wellness_transition(cmd||pg_catalog.jsonb_build_object('intent',intent||'{"serviceId":13}'::jsonb))->>'kind' is distinct from 'invalid' then raise exception 'FAIL: mutable intent'; end if;
  intent := intent||pg_catalog.jsonb_build_object('verificationCheckedAt',pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  cmd := cmd||pg_catalog.jsonb_build_object('intent',intent);
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'granted' then raise exception 'FAIL: fresh-owner safe retry'; end if;
  if public.kiosk_wellness_transition(cmd - 'intent' || '{"kind":"release_check","owner":"40000000-0000-4000-8000-000000000020"}'::jsonb)->>'kind' is distinct from 'stale' then raise exception 'FAIL: old attempt owner cleared new hold'; end if;

  -- A lost authorize response grants no second permission; unknown cannot be cleared.
  cmd := cmd - 'intent' || '{"kind":"authorize_process"}'::jsonb;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'authorized' then raise exception 'FAIL: hold authorize'; end if;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'stale' then raise exception 'FAIL: lost-ack replay'; end if;
  cmd := cmd||'{"kind":"finish_check","outcome":"unknown_outcome","delivery":"not_attempted"}'::jsonb;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'finished' then raise exception 'FAIL: unknown finish'; end if;
  if public.kiosk_wellness_transition(cmd||'{"outcome":"completed"}'::jsonb)->>'kind' is distinct from 'stale' then raise exception 'FAIL: kiosk reconciled unknown'; end if;
  cmd := cmd - array['outcome','delivery'] || '{"kind":"release_check"}'::jsonb;
  if public.kiosk_wellness_transition(cmd)->>'kind' is distinct from 'stale' then raise exception 'FAIL: kiosk released unknown'; end if;
end
$protocol$;

-- Direct table and maintenance access fail even with the permitted caller role.
do $negative_kiosk$
begin
  begin perform 1 from kiosk.wellness_day; raise exception 'FAIL: kiosk direct read';
  exception when insufficient_privilege then null; end;
  begin perform kiosk.wellness_cleanup(); raise exception 'FAIL: kiosk cleanup';
  exception when insufficient_privilege then null; end;
end
$negative_kiosk$;
reset role;

do $owner_readback$
begin
  if (select checks_spent from kiosk.wellness_day where day_ref=pg_catalog.repeat('a',64)) is distinct from 2
    or (select active_attempt_id from kiosk.wellness_day where day_ref=pg_catalog.repeat('a',64)) is not null then
    raise exception 'FAIL: two known results did not retain two spent slots and clear hold';
  end if;
  if (select count(*) from kiosk.consent_record where day_ref=pg_catalog.repeat('a',64)) is distinct from 2 then
    raise exception 'FAIL: invalid/capped begins wrote consent';
  end if;
  if (select checks_spent from kiosk.wellness_day where day_ref=pg_catalog.repeat('d',64)) is distinct from 1
    or (select active_attempt_id from kiosk.wellness_day where day_ref=pg_catalog.repeat('d',64)) is null then
    raise exception 'FAIL: unknown did not retain one active spent slot';
  end if;
  if exists(select 1 from kiosk.consent_record where delete_after is distinct from recorded_at + interval '720 hours') then
    raise exception 'FAIL: retention extended';
  end if;
end
$owner_readback$;

-- Capture these readbacks only in an approved execution seat; no expected hash is invented.
select p.oid::regprocedure as signature, p.prosecdef, p.proconfig,
  pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as function_definition_md5,
  pg_catalog.pg_get_userbyid(p.proowner) as owner, p.proacl
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname='kiosk_wellness_transition')
  or (n.nspname='kiosk' and p.proname in ('positive_id','wellness_cleanup'));
select jobname,schedule,command,active from cron.job where jobname='kiosk-wellness-retention-v1';
rollback;

-- CONCURRENCY RECIPES, ALSO NOT_EXECUTED. Use two independent connections in a
-- disposable database. Fixtures must be committed for cross-connection visibility.
-- Each connection sets role kiosk_wellness and trusted synthetic claims as above.
-- Do not hold a production transaction open to perform these recipes.
--
-- RACE 1: seed a synthetic current day with codes_issued=2 and no fourth challenge.
-- Session A: BEGIN; take_code(challenge A, same day); leave transaction open.
-- Session B: BEGIN; take_code(challenge B, same day); must wait on day-row lock.
-- Session A: COMMIT. B must return capped; COMMIT. Readback codes_issued=3.
--
-- RACE 2: seed one available challenge with wrong_count=4.
-- Session A: BEGIN; claim_code(correct=false, owner A); expect locked; keep open.
-- Session B: BEGIN; claim_code(correct=true, owner B); must wait.
-- Session A: COMMIT. B must return locked. Readback wrong_count=5, no owner.
--
-- RACE 3: seed two ready attempts on one current day with checks_spent=0.
-- Session A: BEGIN; begin_check(attempt A, owner A, valid intent); expect granted.
-- Session B: BEGIN; begin_check(attempt B, owner B, valid intent); must wait.
-- Session A: COMMIT. B must return pending. One consent row, one spent/active slot.
-- Repeat with checks_spent=1 and no hold: winner granted, loser pending; total=2.
--
-- RACE 4: seed one reserved attempt owned by A. Two sessions concurrently call
-- authorize_process with owner A. Exactly one authorized, the other stale.
-- Discard winner response deliberately: a third authorize must still be stale.
-- Leave hold in place; a fresh owner cannot authorize/release/finish it.
--
-- RACE 5: after release_check(A), begin_check(B) succeeds on the same ready attempt.
-- Replayed release_check(A) and begin_check(A) are stale, even after B releases.
-- Add 64 distinct pre-process owner grants/releases; owner 65 cannot be granted.
-- Challenge release/claim history has the same bound and never regrants old owners.
--
-- CLOCK/CLEANUP: owner ages a synthetic ready attempt beyond 15m while maintaining
-- ready_expires_at=created_at+15m; begin and authorize must be stale without hold
-- reclamation. Age a challenge beyond 10m with its matching created_at; claim locks.
-- Age inactive day/challenge/attempt metadata beyond 48h and past MYT day, then run
-- kiosk.wellness_cleanup(): metadata gone, 30-day consent stays. Old-day take_code
-- remains invalid after cleanup. Repeat with unknown active hold: day/attempt and
-- owner remain, even if older than 48h; consent alone deletes at +720h.
-- For consent boundary: set recorded_at/delete_after together to exactly +720h;
-- cleanup before deadline retains and at/after deletes; refreshed verification
-- must never alter either original timestamp. pg_cron healthy cadence is 1 minute.
--
-- FAILURE/ROLLBACK: approved isolated owner installs a temporary BEFORE INSERT
-- consent trigger that RAISEs; begin_check must error with no spent/active grant,
-- no owner-history append and no consent. Remove trigger and retry a fresh owner.
-- This is a DB transaction test only; provider/mail invocation requires separate
-- candidate-level tests and remains outside this probe's authority.
