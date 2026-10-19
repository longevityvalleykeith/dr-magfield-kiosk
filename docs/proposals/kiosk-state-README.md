# Kiosk state SQL source proposal

Status: **NOT_EXECUTED**. These files are source proposals in the isolated packet.
They are not installed, applied, reachable, or accepted production evidence.

`kiosk_wellness_state.sql` is deliberately a raw filename. Supabase CLI was absent;
no canonical Foundry timestamp, migration-history entry, or placement is invented.
Main A1–A7 and the retention ruling in `authority/MAIN-ADMISSION.json` remain the
authority. The public RPC transport and four typed tables amend the admitted
private-RPC/single-row design and still require Main's separate grade.

The proposal follows `architecture/CONTRACT.md` and the fixed `StateCommand` /
`ConsentIntent` wire shape in `candidate/lib/wellness/state.ts`. The response is one
JSON object with `kind`; no rows, bookings, or arbitrary payloads are returned.

The caller role is `kiosk_wellness`: NOLOGIN, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS. Only `authenticator` gets its
membership. It gets public-schema USAGE and facade EXECUTE, with no private-schema
USAGE, table, helper or cleanup rights. The definer is the approved migration
owner, which must be read back separately. PUBLIC, anon, authenticated and
service_role get no grants to these objects. Private tables have RLS and no public
policies. No broad privilege change to the existing public schema is proposed.
If PUBLIC already grants CREATE there, this proposal aborts for owner review.
Role/schema collisions likewise abort; existing objects are never overwritten.

`public.kiosk_wellness_transition(p_command jsonb)` is SECURITY DEFINER with an
empty search_path and qualified object/function references. The function checks
the assumed request role and trusted PostgREST role claims rather than the
definer's current_user. It also checks unexpired integer iat/exp and at most 90
days. This is defense in depth: SQL cannot verify a JWT signature from the claims
GUC. Supabase/PostgREST must authenticate the request before setting that GUC.
The separate publishable apikey/custom-role Authorization transport still needs
admission and exposure readback. Neither the SQL nor these probes mint credentials.

Every command has exact required keys. IDs are canonical lowercase UUID strings;
day/booking/account/recipient references are lowercase 64-hex HMAC references.
`tenantId` is a lowercase slug of at most 64 characters. Numeric Calendesk IDs
are positive safe integers, with the three nullable numeric fields enforced individually.
Consent enums, v3 notice, disabled CC, null care recipient and the 30-day policy
are fixed. `verificationCheckedAt` accepts an ISO UTC timestamp and is a supplied
verification assertion; DB time controls admission, expiry and retention.
No raw booking ID, name, email, video, reading, signed URL or JSON dump is stored.

Day-row locks serialize same-day admission before child-row locks. Database time
sets 10-minute challenges, 15-minute ready attempts and the current MYT day.
Three codes are issued per booking-day; five wrong guesses lock a challenge.
Atomic claim uses a fresh invocation owner. Consuming it creates one attempt for
the registered challenge-day only. A known transient read failure may release
only the current code owner and never resets wrong guesses.

`begin_check` inserts the typed consent intent, reserves one of two slots and
sets the exclusive day hold in one transaction. Existing grants never regrant.
`authorize_process` changes reserved to processing once for that owner, before
the vendor call; it checks ready expiry and MYT day again. A lost acknowledgment
does not authorize replay. `release_check` works only before that barrier and
refunds the slot. A fresh owner may retry a released ready attempt before expiry;
only verification time may refresh, while every other intent field and original
recorded_at/delete_after remain fixed. Up to 64 granted owners per resource are
remembered permanently within its safety lifetime; old owners never regrant.

A known finish clears the matching active hold and retains its spent slot, so
two sequential known checks can succeed. Unknown outcomes retain the active
owner/slot indefinitely. Identical duplicate finishes may acknowledge `finished`
but cannot authorize another provider or mail operation. Changed terminal values,
wrong owners and releases after processing return stale. There is no kiosk
reconciliation command and no automatic expiry or takeover of an active hold.
Staff reconciliation is absent until a separately reviewed staff tool exists;
the kiosk cannot clear the hold even after 48 hours or on a new invocation.

The maintenance function deletes consent at its immutable DB-recorded timestamp
plus 720 hours (30 days). The proposed existing-pg_cron job runs every minute;
actual deletion depends on a healthy scheduler and is not measured here. No
pg_cron installation or platform setting change is included. Old inactive safety
metadata becomes eligible after 48 hours and an older MYT day, under day locks.
Active holds are skipped. Current-day/token checks still reject old signed days
after cleanup, so deletion cannot reopen an old valid token. Consent has no FK to
safety metadata and survives it until its own deadline. The kiosk cannot call
maintenance. Full retention behavior, cron owner and execution health are owed.

`kiosk_wellness_state.probes.sql` prepares role/ACL/RLS and real negative-permission
checks, exact-shape and claim failures, code/attempt replay fencing, wrong-count
preservation, two sequential known outcomes, caps, safe retry, stale release and
unknown-hold checks. Its main fixture block rolls back. Commented two-connection
recipes cover contested code caps, fifth wrong guess, exclusive begins, the
one-time process barrier, owner-history bounds, clocks, cleanup and consent-error
rollback. Those recipes need an approved disposable database and committed
synthetic setup; they are not runtime or JWT-signature evidence.

No SQL, role, privilege, cron, function MD5 or concurrency probe was executed.
No application import, build, network call, DB query, apply or provider operation
was run by this SQL author. A CLI-generated Foundry migration, exact function
MD5 readback, approved negative/concurrency probes, Main/Astra regrades, counsel,
named apply authority and Keith's own-face test remain separate admission gates.
