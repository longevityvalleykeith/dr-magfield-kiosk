-- RAW SOURCE PROPOSAL. NOT_EXECUTED. Not a CLI-generated Foundry migration.
-- Public facade/composite tables are amendments awaiting Main's admission.
-- Apply only through the separately approved Foundry migration slot and gates.
-- Preconditions: role/schema below are new, pg_cron already installed, public
-- schema already denies CREATE to PUBLIC. Collisions fail without replacing objects.
begin;

create role kiosk_wellness nologin nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls;
create schema kiosk;
revoke all on schema kiosk from public, anon, authenticated, service_role, kiosk_wellness;
grant usage on schema public to kiosk_wellness;

do $preconditions$
begin
  if pg_catalog.has_schema_privilege('kiosk_wellness', 'public', 'CREATE') then
    raise exception 'public CREATE prerequisite failed; no broad schema revoke is authorized';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron must be admitted and installed separately';
  end if;
end
$preconditions$;

create table kiosk.wellness_day (
  day_ref text primary key check (day_ref ~ '^[0-9a-f]{64}$'),
  booking_day date not null,
  codes_issued smallint not null default 0 check (codes_issued between 0 and 3),
  checks_spent smallint not null default 0 check (checks_spent between 0 and 2),
  active_attempt_id uuid,
  active_owner uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((active_attempt_id is null) = (active_owner is null))
);

create table kiosk.wellness_challenge (
  challenge_id uuid primary key,
  day_ref text not null references kiosk.wellness_day(day_ref),
  status text not null default 'available' check (status in ('available', 'claimed', 'consumed')),
  wrong_count smallint not null default 0 check (wrong_count between 0 and 5),
  owner uuid,
  seen_owners uuid[] not null default '{}'::uuid[] check (pg_catalog.cardinality(seen_owners) <= 64),
  consumed_attempt_id uuid,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check ((status = 'claimed') = (owner is not null)),
  check ((status = 'consumed') = (consumed_attempt_id is not null)),
  check (expires_at = created_at + interval '10 minutes')
);
create index wellness_challenge_day on kiosk.wellness_challenge(day_ref);

create table kiosk.wellness_attempt (
  attempt_id uuid primary key,
  challenge_id uuid not null unique references kiosk.wellness_challenge(challenge_id),
  day_ref text not null references kiosk.wellness_day(day_ref),
  status text not null default 'ready' check (status in ('ready', 'reserved', 'processing', 'terminal', 'unknown')),
  owner uuid,
  seen_owners uuid[] not null default '{}'::uuid[] check (pg_catalog.cardinality(seen_owners) <= 64),
  outcome text check (outcome in ('completed', 'insufficient_quality', 'failed', 'unknown_outcome')),
  delivery text check (delivery in ('sent', 'failed', 'not_attempted')),
  created_at timestamptz not null,
  ready_expires_at timestamptz not null,
  updated_at timestamptz not null,
  check ((status = 'ready') = (owner is null)),
  check ((status in ('terminal', 'unknown')) = (outcome is not null and delivery is not null)),
  check ((status = 'unknown') = (outcome = 'unknown_outcome')),
  check (ready_expires_at = created_at + interval '15 minutes')
);
create index wellness_attempt_day on kiosk.wellness_attempt(day_ref);

create table kiosk.consent_record (
  attempt_id uuid primary key,
  day_ref text not null check (day_ref ~ '^[0-9a-f]{64}$'),
  schema_version text not null check (schema_version = 'dmk-consent-v3'),
  booking_ref text not null check (booking_ref ~ '^[0-9a-f]{64}$'),
  tenant_id text not null check (tenant_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and pg_catalog.length(tenant_id) <= 64),
  calendesk_account_ref text not null check (calendesk_account_ref ~ '^[0-9a-f]{64}$'),
  location_id bigint not null check (location_id between 1 and 9007199254740991),
  service_location_id bigint check (service_location_id between 1 and 9007199254740991),
  service_id bigint not null check (service_id between 1 and 9007199254740991),
  service_type_id bigint check (service_type_id between 1 and 9007199254740991),
  care_employee_id bigint check (care_employee_id between 1 and 9007199254740991),
  subject_binding text not null check (subject_binding = 'booking-inbox-code-v1'),
  purpose text not null check (purpose = 'optional-wellness-indicators-cloud-v3'),
  notice_version text not null check (notice_version = 'dmk-cloud-v3-2026-10-19'),
  processing_decision text not null check (processing_decision = 'agreed'),
  email_results_decision text not null check (email_results_decision = 'agreed'),
  care_cc_decision text not null check (care_cc_decision in ('declined', 'unavailable')),
  guest_recipient_ref text not null check (guest_recipient_ref ~ '^[0-9a-f]{64}$'),
  care_recipient_ref text check (care_recipient_ref is null),
  source_surface text not null check (source_surface = 'dmk-kiosk'),
  verification_checked_at timestamptz not null,
  verification_policy_version text not null check (verification_policy_version = 'dmk-entity-match-v1'),
  retention_policy_version text not null check (retention_policy_version = 'dmk-30-days-v1'),
  recorded_at timestamptz not null,
  delete_after timestamptz not null,
  outcome text check (outcome in ('completed', 'insufficient_quality', 'failed', 'unknown_outcome', 'not_submitted')),
  delivery text not null default 'not_attempted' check (delivery in ('sent', 'failed', 'not_attempted')),
  check (delete_after = recorded_at + interval '720 hours')
);
create index consent_record_delete_after on kiosk.consent_record(delete_after);
-- No FK to attempt: consent survives 48-hour safety-metadata cleanup until +30 days.

alter table kiosk.wellness_day enable row level security;
alter table kiosk.wellness_challenge enable row level security;
alter table kiosk.wellness_attempt enable row level security;
alter table kiosk.consent_record enable row level security;
revoke all on table kiosk.wellness_day, kiosk.wellness_challenge,
  kiosk.wellness_attempt, kiosk.consent_record
  from public, anon, authenticated, service_role, kiosk_wellness;

create function kiosk.positive_id(p_value jsonb, p_nullable boolean)
returns boolean language sql immutable set search_path = '' as $function$
  select case
    when p_value is null then false
    when pg_catalog.jsonb_typeof(p_value) = 'null' then p_nullable
    when pg_catalog.jsonb_typeof(p_value) <> 'number' then false
    else (p_value::text)::numeric between 1 and 9007199254740991
      and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric
  end
$function$;
revoke all on function kiosk.positive_id(jsonb, boolean)
  from public, anon, authenticated, service_role, kiosk_wellness;

create function public.kiosk_wellness_transition(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_kind text;
  v_keys text[];
  v_claims jsonb;
  v_owner uuid;
  v_challenge_id uuid;
  v_attempt_id uuid;
  v_day_ref text;
  v_day date;
  v_now timestamptz;
  v_intent jsonb;
  v_verified_at timestamptz;
  v_outcome text;
  v_delivery text;
  v_d kiosk.wellness_day%rowtype;
  v_c kiosk.wellness_challenge%rowtype;
  v_a kiosk.wellness_attempt%rowtype;
  v_record kiosk.consent_record%rowtype;
begin
  -- PostgREST verifies the JWT signature and supplies these trusted request claims.
  -- current_user is the definer here and MUST NOT be used as caller authority.
  if pg_catalog.current_setting('role', true) is distinct from 'kiosk_wellness' then
    return '{"kind":"invalid"}'::jsonb;
  end if;
  begin
    v_claims := pg_catalog.current_setting('request.jwt.claims', true)::jsonb;
    v_now := pg_catalog.clock_timestamp();
    if pg_catalog.jsonb_typeof(v_claims) is distinct from 'object'
      or v_claims->>'role' is distinct from 'kiosk_wellness'
      or pg_catalog.jsonb_typeof(v_claims->'iat') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_claims->'exp') is distinct from 'number'
      or (v_claims->>'iat')::numeric <> pg_catalog.trunc((v_claims->>'iat')::numeric)
      or (v_claims->>'exp')::numeric <> pg_catalog.trunc((v_claims->>'exp')::numeric)
      or (v_claims->>'iat')::numeric not between 1 and 9007199254740991
      or (v_claims->>'exp')::numeric not between 1 and 9007199254740991
      or (v_claims->>'iat')::numeric > pg_catalog.date_part('epoch', v_now)
      or (v_claims->>'exp')::numeric <= pg_catalog.date_part('epoch', v_now)
      or (v_claims->>'exp')::numeric <= (v_claims->>'iat')::numeric
      or (v_claims->>'exp')::numeric - (v_claims->>'iat')::numeric > 7776000 then
      return '{"kind":"invalid"}'::jsonb;
    end if;
  exception when others then
    return '{"kind":"invalid"}'::jsonb;
  end;

  if pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_command->'kind') is distinct from 'string' then
    return '{"kind":"invalid"}'::jsonb;
  end if;
  v_kind := p_command->>'kind';
  v_keys := case v_kind
    when 'take_code' then array['kind','challengeId','dayRef','day']
    when 'check_eligibility' then array['kind','dayRef','day']
    when 'claim_code' then array['kind','challengeId','owner','correct']
    when 'release_code' then array['kind','challengeId','owner']
    when 'consume_code' then array['kind','challengeId','owner','attemptId','dayRef','day']
    when 'begin_check' then array['kind','attemptId','dayRef','owner','intent']
    when 'authorize_process' then array['kind','attemptId','dayRef','owner']
    when 'release_check' then array['kind','attemptId','dayRef','owner']
    when 'finish_check' then array['kind','attemptId','dayRef','owner','outcome','delivery']
    else null end;
  if v_keys is null or not (p_command ?& v_keys)
    or (p_command - v_keys) <> '{}'::jsonb then
    return '{"kind":"invalid"}'::jsonb;
  end if;

  -- UUIDs are canonical wire strings; arbitrary JSON values never reach casts.
  if p_command ? 'owner' then
    if pg_catalog.jsonb_typeof(p_command->'owner') <> 'string'
      or p_command->>'owner' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    v_owner := (p_command->>'owner')::uuid;
  end if;
  if p_command ? 'challengeId' then
    if pg_catalog.jsonb_typeof(p_command->'challengeId') <> 'string'
      or p_command->>'challengeId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    v_challenge_id := (p_command->>'challengeId')::uuid;
  end if;
  if p_command ? 'attemptId' then
    if pg_catalog.jsonb_typeof(p_command->'attemptId') <> 'string'
      or p_command->>'attemptId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    v_attempt_id := (p_command->>'attemptId')::uuid;
  end if;
  if p_command ? 'dayRef' then
    if pg_catalog.jsonb_typeof(p_command->'dayRef') <> 'string'
      or p_command->>'dayRef' !~ '^[0-9a-f]{64}$' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    v_day_ref := p_command->>'dayRef';
  end if;
  if p_command ? 'day' then
    if pg_catalog.jsonb_typeof(p_command->'day') <> 'string'
      or p_command->>'day' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    begin
      v_day := (p_command->>'day')::date;
    exception when others then return '{"kind":"invalid"}'::jsonb;
    end;
  end if;
  if v_kind = 'claim_code' and pg_catalog.jsonb_typeof(p_command->'correct') <> 'boolean' then
    return '{"kind":"invalid"}'::jsonb;
  end if;
  if v_kind = 'finish_check' then
    if pg_catalog.jsonb_typeof(p_command->'outcome') <> 'string'
      or p_command->>'outcome' not in ('completed','insufficient_quality','failed','unknown_outcome')
      or pg_catalog.jsonb_typeof(p_command->'delivery') <> 'string'
      or p_command->>'delivery' not in ('sent','failed','not_attempted') then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    v_outcome := p_command->>'outcome';
    v_delivery := p_command->>'delivery';
  end if;

  if v_kind = 'begin_check' then
    v_intent := p_command->'intent';
    v_keys := array['schemaVersion','bookingRef','tenantId','calendeskAccountRef',
      'locationId','serviceLocationId','serviceId','serviceTypeId','careEmployeeId',
      'subjectBinding','purpose','noticeVersion','processingDecision','emailResultsDecision',
      'careCcDecision','guestRecipientRef','careRecipientRef','sourceSurface',
      'verificationCheckedAt','verificationPolicyVersion','retentionPolicyVersion'];
    if pg_catalog.jsonb_typeof(v_intent) is distinct from 'object'
      or not (v_intent ?& v_keys) or (v_intent - v_keys) <> '{}'::jsonb then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    if exists (select 1 from pg_catalog.unnest(array['schemaVersion','bookingRef','tenantId',
      'calendeskAccountRef','subjectBinding','purpose','noticeVersion','processingDecision',
      'emailResultsDecision','careCcDecision','guestRecipientRef','sourceSurface',
      'verificationCheckedAt','verificationPolicyVersion','retentionPolicyVersion']) as k(name)
      where pg_catalog.jsonb_typeof(v_intent->k.name) <> 'string')
      or v_intent->>'schemaVersion' <> 'dmk-consent-v3'
      or v_intent->>'bookingRef' !~ '^[0-9a-f]{64}$'
      or v_intent->>'tenantId' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or pg_catalog.length(v_intent->>'tenantId') > 64
      or v_intent->>'calendeskAccountRef' !~ '^[0-9a-f]{64}$'
      or not kiosk.positive_id(v_intent->'locationId', false)
      or not kiosk.positive_id(v_intent->'serviceLocationId', true)
      or not kiosk.positive_id(v_intent->'serviceId', false)
      or not kiosk.positive_id(v_intent->'serviceTypeId', true)
      or not kiosk.positive_id(v_intent->'careEmployeeId', true)
      or v_intent->>'subjectBinding' <> 'booking-inbox-code-v1'
      or v_intent->>'purpose' <> 'optional-wellness-indicators-cloud-v3'
      or v_intent->>'noticeVersion' <> 'dmk-cloud-v3-2026-10-19'
      or v_intent->>'processingDecision' <> 'agreed'
      or v_intent->>'emailResultsDecision' <> 'agreed'
      or v_intent->>'careCcDecision' not in ('declined','unavailable')
      or v_intent->>'guestRecipientRef' !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(v_intent->'careRecipientRef') <> 'null'
      or v_intent->>'sourceSurface' <> 'dmk-kiosk'
      or v_intent->>'verificationCheckedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      or v_intent->>'verificationPolicyVersion' <> 'dmk-entity-match-v1'
      or v_intent->>'retentionPolicyVersion' <> 'dmk-30-days-v1' then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    begin
      v_verified_at := (v_intent->>'verificationCheckedAt')::timestamptz;
      if pg_catalog.to_char(v_verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        <> v_intent->>'verificationCheckedAt' then
        return '{"kind":"invalid"}'::jsonb;
      end if;
    exception when others then return '{"kind":"invalid"}'::jsonb;
    end;
  end if;

  if v_kind = 'take_code' then
    v_now := pg_catalog.clock_timestamp();
    if v_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    insert into kiosk.wellness_day(day_ref, booking_day, created_at, updated_at)
      values (v_day_ref, v_day, v_now, v_now) on conflict (day_ref) do nothing;
    select * into v_d from kiosk.wellness_day where day_ref = v_day_ref for update;
    v_now := pg_catalog.clock_timestamp();
    if v_d.booking_day <> v_day or v_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    if v_d.codes_issued >= 3 then return '{"kind":"capped"}'::jsonb; end if;
    insert into kiosk.wellness_challenge(challenge_id, day_ref, created_at, expires_at)
      values (v_challenge_id, v_day_ref, v_now, v_now + interval '10 minutes')
      on conflict (challenge_id) do nothing;
    if not found then return '{"kind":"capped"}'::jsonb; end if;
    update kiosk.wellness_day set codes_issued = codes_issued + 1, updated_at = v_now
      where day_ref = v_day_ref;
    return '{"kind":"granted"}'::jsonb;
  end if;

  -- K-29: a read-only early refusal before consent and camera. No lock and no write; begin_check's cap stays the race barrier.
  if v_kind = 'check_eligibility' then
    v_now := pg_catalog.clock_timestamp();
    if v_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date then
      return '{"kind":"invalid"}'::jsonb;
    end if;
    if exists (select 1 from kiosk.wellness_day d where d.day_ref = v_day_ref and d.checks_spent >= 2) then
      return '{"kind":"capped"}'::jsonb;
    end if;
    return '{"kind":"granted"}'::jsonb;
  end if;

  -- Resolve the day without locking, then always lock day before challenge/attempt.
  if v_kind in ('claim_code','release_code','consume_code') then
    select day_ref into v_day_ref from kiosk.wellness_challenge where challenge_id = v_challenge_id;
    if not found then
      return case when v_kind = 'claim_code' then '{"kind":"locked"}'::jsonb else '{"kind":"stale"}'::jsonb end;
    end if;
    select * into v_d from kiosk.wellness_day where day_ref = v_day_ref for update;
    select * into v_c from kiosk.wellness_challenge where challenge_id = v_challenge_id for update;
    if not found then return '{"kind":"stale"}'::jsonb; end if;
    v_now := pg_catalog.clock_timestamp();

    if v_kind = 'release_code' then
      if v_c.status <> 'claimed' or v_c.owner is distinct from v_owner then
        return '{"kind":"stale"}'::jsonb;
      end if;
      update kiosk.wellness_challenge set status = 'available', owner = null
        where challenge_id = v_challenge_id;
      return '{"kind":"released"}'::jsonb;
    end if;
    if v_c.expires_at <= v_now or v_c.wrong_count >= 5
      or v_d.booking_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date then
      return '{"kind":"locked"}'::jsonb;
    end if;
    if v_kind = 'claim_code' then
      if v_c.status <> 'available' or v_owner = any(v_c.seen_owners)
        or pg_catalog.cardinality(v_c.seen_owners) >= 64 then
        return '{"kind":"locked"}'::jsonb;
      end if;
      if not (p_command->>'correct')::boolean then
        update kiosk.wellness_challenge set wrong_count = wrong_count + 1
          where challenge_id = v_challenge_id;
        return case when v_c.wrong_count + 1 >= 5 then '{"kind":"locked"}'::jsonb else '{"kind":"wrong"}'::jsonb end;
      end if;
      update kiosk.wellness_challenge set status = 'claimed', owner = v_owner,
        seen_owners = pg_catalog.array_append(seen_owners, v_owner) where challenge_id = v_challenge_id;
      return '{"kind":"granted"}'::jsonb;
    end if;
    if v_c.status <> 'claimed' or v_c.owner is distinct from v_owner
      or p_command->>'dayRef' <> v_c.day_ref or v_day <> v_d.booking_day then
      return '{"kind":"stale"}'::jsonb;
    end if;
    insert into kiosk.wellness_attempt(attempt_id, challenge_id, day_ref, created_at, ready_expires_at, updated_at)
      values (v_attempt_id, v_challenge_id, v_c.day_ref, v_now, v_now + interval '15 minutes', v_now)
      on conflict do nothing;
    if not found then return '{"kind":"stale"}'::jsonb; end if;
    update kiosk.wellness_challenge set status = 'consumed', owner = null,
      consumed_attempt_id = v_attempt_id where challenge_id = v_challenge_id;
    return '{"kind":"consumed"}'::jsonb;
  end if;

  select * into v_d from kiosk.wellness_day where day_ref = v_day_ref for update;
  if not found then return '{"kind":"stale"}'::jsonb; end if;
  select * into v_a from kiosk.wellness_attempt where attempt_id = v_attempt_id for update;
  if not found or v_a.day_ref <> v_day_ref then return '{"kind":"stale"}'::jsonb; end if;
  v_now := pg_catalog.clock_timestamp();
  if v_kind = 'begin_check' then
    if v_d.booking_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date
      or v_a.ready_expires_at <= v_now then
      return '{"kind":"stale"}'::jsonb;
    end if;
    if v_d.active_attempt_id is not null then return '{"kind":"pending"}'::jsonb; end if;
    if v_a.status <> 'ready' or v_owner = any(v_a.seen_owners)
      or pg_catalog.cardinality(v_a.seen_owners) >= 64 then
      return '{"kind":"stale"}'::jsonb;
    end if;
    select * into v_record from kiosk.consent_record where attempt_id = v_attempt_id for update;
    if found then
      -- Only refreshed verification time may differ on a safe pre-process retry.
      if row(v_record.day_ref,v_record.schema_version,v_record.booking_ref,v_record.tenant_id,
        v_record.calendesk_account_ref,v_record.location_id,v_record.service_location_id,
        v_record.service_id,v_record.service_type_id,v_record.care_employee_id,
        v_record.subject_binding,v_record.purpose,v_record.notice_version,
        v_record.processing_decision,v_record.email_results_decision,v_record.care_cc_decision,
        v_record.guest_recipient_ref,v_record.care_recipient_ref,v_record.source_surface,
        v_record.verification_policy_version,v_record.retention_policy_version)
        is distinct from row(v_day_ref,v_intent->>'schemaVersion',v_intent->>'bookingRef',v_intent->>'tenantId',
        v_intent->>'calendeskAccountRef',(v_intent->>'locationId')::numeric::bigint,(v_intent->>'serviceLocationId')::numeric::bigint,
        (v_intent->>'serviceId')::numeric::bigint,(v_intent->>'serviceTypeId')::numeric::bigint,(v_intent->>'careEmployeeId')::numeric::bigint,
        v_intent->>'subjectBinding',v_intent->>'purpose',v_intent->>'noticeVersion',
        v_intent->>'processingDecision',v_intent->>'emailResultsDecision',v_intent->>'careCcDecision',
        v_intent->>'guestRecipientRef',null::text,v_intent->>'sourceSurface',
        v_intent->>'verificationPolicyVersion',v_intent->>'retentionPolicyVersion') then
        return '{"kind":"invalid"}'::jsonb;
      end if;
    end if;
    if v_d.checks_spent >= 2 then return '{"kind":"capped"}'::jsonb; end if;
    if v_record.attempt_id is not null then
      update kiosk.consent_record set verification_checked_at = v_verified_at,
        outcome = null, delivery = 'not_attempted' where attempt_id = v_attempt_id;
    else
      insert into kiosk.consent_record(attempt_id,day_ref,schema_version,booking_ref,tenant_id,
        calendesk_account_ref,location_id,service_location_id,service_id,service_type_id,
        care_employee_id,subject_binding,purpose,notice_version,processing_decision,
        email_results_decision,care_cc_decision,guest_recipient_ref,care_recipient_ref,
        source_surface,verification_checked_at,verification_policy_version,
        retention_policy_version,recorded_at,delete_after)
      values(v_attempt_id,v_day_ref,v_intent->>'schemaVersion',v_intent->>'bookingRef',v_intent->>'tenantId',
        v_intent->>'calendeskAccountRef',(v_intent->>'locationId')::numeric::bigint,(v_intent->>'serviceLocationId')::numeric::bigint,
        (v_intent->>'serviceId')::numeric::bigint,(v_intent->>'serviceTypeId')::numeric::bigint,(v_intent->>'careEmployeeId')::numeric::bigint,
        v_intent->>'subjectBinding',v_intent->>'purpose',v_intent->>'noticeVersion',
        v_intent->>'processingDecision',v_intent->>'emailResultsDecision',v_intent->>'careCcDecision',
        v_intent->>'guestRecipientRef',null,v_intent->>'sourceSurface',v_verified_at,
        v_intent->>'verificationPolicyVersion',v_intent->>'retentionPolicyVersion',
        v_now,v_now + interval '720 hours');
    end if;
    update kiosk.wellness_attempt set status = 'reserved', owner = v_owner,
      seen_owners = pg_catalog.array_append(seen_owners, v_owner), updated_at = v_now where attempt_id = v_attempt_id;
    update kiosk.wellness_day set checks_spent = checks_spent + 1,
      active_attempt_id = v_attempt_id, active_owner = v_owner, updated_at = v_now where day_ref = v_day_ref;
    return '{"kind":"granted"}'::jsonb;
  end if;

  if v_a.owner is distinct from v_owner then return '{"kind":"stale"}'::jsonb; end if;
  if v_kind = 'finish_check' and v_a.status in ('terminal','unknown') then
    if v_a.outcome = v_outcome and v_a.delivery = v_delivery then
      return '{"kind":"finished"}'::jsonb;
    end if;
    return '{"kind":"stale"}'::jsonb;
  end if;
  if v_d.active_attempt_id is distinct from v_attempt_id or v_d.active_owner is distinct from v_owner then
    return '{"kind":"stale"}'::jsonb;
  end if;
  if v_kind = 'authorize_process' then
    if v_a.status <> 'reserved' or v_a.ready_expires_at <= v_now
      or v_d.booking_day <> (v_now at time zone 'Asia/Kuala_Lumpur')::date then
      return '{"kind":"stale"}'::jsonb;
    end if;
    update kiosk.wellness_attempt set status = 'processing', updated_at = v_now where attempt_id = v_attempt_id;
    return '{"kind":"authorized"}'::jsonb;
  end if;
  if v_kind = 'release_check' then
    if v_a.status <> 'reserved' then return '{"kind":"stale"}'::jsonb; end if;
    update kiosk.wellness_attempt set status = 'ready', owner = null, updated_at = v_now where attempt_id = v_attempt_id;
    update kiosk.wellness_day set checks_spent = checks_spent - 1,
      active_attempt_id = null, active_owner = null, updated_at = v_now where day_ref = v_day_ref;
    update kiosk.consent_record set outcome = 'not_submitted', delivery = 'not_attempted' where attempt_id = v_attempt_id;
    return '{"kind":"released"}'::jsonb;
  end if;
  if v_a.status <> 'processing' then return '{"kind":"stale"}'::jsonb; end if;
  update kiosk.wellness_attempt set status = case when v_outcome = 'unknown_outcome' then 'unknown' else 'terminal' end,
    outcome = v_outcome, delivery = v_delivery, updated_at = v_now where attempt_id = v_attempt_id;
  update kiosk.consent_record set outcome = v_outcome, delivery = v_delivery where attempt_id = v_attempt_id;
  if v_outcome <> 'unknown_outcome' then
    update kiosk.wellness_day set active_attempt_id = null, active_owner = null,
      updated_at = v_now where day_ref = v_day_ref;
  end if;
  return '{"kind":"finished"}'::jsonb;
end
$function$;
revoke all on function public.kiosk_wellness_transition(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.kiosk_wellness_transition(jsonb) to kiosk_wellness;
grant kiosk_wellness to authenticator;

create function kiosk.wellness_cleanup()
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day_ref text;
begin
  delete from kiosk.consent_record where delete_after <= v_now;
  -- Same day-before-child lock order as transitions; skip contended/active days.
  for v_day_ref in select d.day_ref from kiosk.wellness_day d
    where d.active_attempt_id is null
      and d.booking_day < (v_now at time zone 'Asia/Kuala_Lumpur')::date
      and d.updated_at <= v_now - interval '48 hours'
    for update skip locked
  loop
    delete from kiosk.wellness_attempt a where a.day_ref = v_day_ref
      and a.created_at <= v_now - interval '48 hours' and a.ready_expires_at <= v_now;
    delete from kiosk.wellness_challenge c where c.day_ref = v_day_ref
      and c.created_at <= v_now - interval '48 hours' and c.expires_at <= v_now
      and not exists (select 1 from kiosk.wellness_attempt a where a.challenge_id = c.challenge_id);
    delete from kiosk.wellness_day d where d.day_ref = v_day_ref
      and not exists (select 1 from kiosk.wellness_challenge c where c.day_ref = d.day_ref)
      and not exists (select 1 from kiosk.wellness_attempt a where a.day_ref = d.day_ref);
  end loop;
end
$function$;
revoke all on function kiosk.wellness_cleanup()
  from public, anon, authenticated, service_role, kiosk_wellness;
-- The approved migration owner owns this cron job; kiosk_wellness cannot run it.
select cron.schedule('kiosk-wellness-retention-v1', '* * * * *', 'select kiosk.wellness_cleanup()');

commit;
