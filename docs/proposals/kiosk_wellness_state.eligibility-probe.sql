-- K12b F4: check_eligibility read-only probe. EXECUTED 2026-10-23 by Mini (the author), on a disposable local
-- PostgreSQL 15.18 cluster only, with a replay copy of kiosk_wellness_state.sql whose pg_cron precondition and
-- cron.schedule were removed (pg_cron not installed there). Not a migration and not an independent replay.
-- Result at the PR #13 head: under_cap granted, at_cap capped, held_at_cap pending, unknown_day granted,
-- wrong_day invalid, extra_key invalid; no write xid assigned; 0 non-AccessShare locks; rows unchanged; no day created.
-- Positive control: adding "for update" to the branch's select gave no_write_xid_assigned = f and 2 locks.
-- Fixture rows are written as the superuser; the probe calls run as kiosk_wellness with synthetic JWT claims.
-- Run in psql against a disposable database after installing the state SQL and the Supabase roles.
create or replace function pg_temp.call(cmd jsonb) returns text language plpgsql as $$
declare r jsonb; begin
  perform set_config('role','kiosk_wellness',true);
  perform set_config('request.jwt.claims', jsonb_build_object('role','kiosk_wellness','iat',floor(extract(epoch from now()))-60,'exp',floor(extract(epoch from now()))+3600)::text, true);
  execute 'set local role kiosk_wellness';
  r := public.kiosk_wellness_transition(cmd);
  execute 'reset role';
  return r->>'kind';
end $$;
create or replace function pg_temp.snap() returns text language sql as $$
  select md5(coalesce((select string_agg(t::text, '|' order by t::text) from kiosk.wellness_day t),'')
    || coalesce((select string_agg(t::text, '|' order by t::text) from kiosk.wellness_challenge t),'')
    || coalesce((select string_agg(t::text, '|' order by t::text) from kiosk.wellness_attempt t),'')
    || coalesce((select string_agg(t::text, '|' order by t::text) from kiosk.consent_record t),'')) $$;
\set today `TZ=Asia/Kuala_Lumpur date +%F`
\set ref '\'' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' '\''
-- fixture rows (superuser), then three day states
insert into kiosk.wellness_day(day_ref,booking_day,created_at,updated_at) values
 (repeat('a',64), :'today', now(), now()),
 (repeat('b',64), :'today', now(), now()),
 (repeat('c',64), :'today', now(), now());
update kiosk.wellness_day set checks_spent=1 where day_ref=repeat('a',64);
update kiosk.wellness_day set checks_spent=2 where day_ref=repeat('b',64);
update kiosk.wellness_day set checks_spent=2, active_attempt_id=gen_random_uuid(), active_owner=gen_random_uuid() where day_ref=repeat('c',64);
select pg_temp.snap() as before \gset
begin;
select pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('a',64),'day',:'today')) as under_cap,
       pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('b',64),'day',:'today')) as at_cap,
       pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('c',64),'day',:'today')) as held_at_cap,
       pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('d',64),'day',:'today')) as unknown_day,
       pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('a',64),'day','2000-01-01')) as wrong_day,
       pg_temp.call(jsonb_build_object('kind','check_eligibility','dayRef',repeat('a',64),'day',:'today','owner',gen_random_uuid())) as extra_key;
select txid_current_if_assigned() is null as no_write_xid_assigned,
  (select count(*) from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='kiosk' and l.pid=pg_backend_pid() and l.mode not in ('AccessShareLock')) as non_share_locks;
commit;
select pg_temp.snap() = :'before' as rows_unchanged, (select count(*) from kiosk.wellness_day where day_ref=repeat('d',64)) as day_created;
