# Independent SQL/security source review

Disposition: **CONCUR — bounded SQL source proposal; HOLD — runtime and Main admission.** No concrete P1/P2 SQL transition or privilege defect was established by this static review. This grants no permission to apply or arm.

Scope: frozen `migration/kiosk_wellness_state.sql`, its probes/README, `architecture/CONTRACT.md`, `authority/MAIN-ADMISSION.json`, and the exact `state.ts`, `state-memory.ts`, and `state-validation.ts` protocol. The reviewer authored none of those files and read no other review.

## Probe finding and source recheck

The initial prepared probes used `<>` for expected replies. A SQL NULL reply, JSON null, or missing `kind` then skipped PL/pgSQL failures. Root replaced the expected-value comparisons with `IS DISTINCT FROM`; this reviewer reread that cure and found no remaining `<>` in the probe file. The migration SQL was unchanged. This is a source correction, not an executed probe result.

The residual duplicate-begin oracle at `migration/kiosk_wellness_state.probes.sql:143` initially only rejected `granted`. Root changed it to the exact null-safe expectation `IS DISTINCT FROM 'pending'`; this reviewer reread the final line. No unresolved concrete finding remains. Probe execution is still `NOT_EXECUTED`.

## Nonblocking memory distinctions

- SQL `404–406` refreshes `verification_checked_at` on a safe released-attempt retry. `state-memory.ts:98–101` keeps the first frozen intent and thus its first verification timestamp. The contract permits refresh; it does not require it. Original retention timestamps remain fixed in both. The stored consent records are not identical audit models.
- For an unexpired, current-day consumed challenge, SQL `355–357` returns `stale`; memory `84` returns `locked`. A new claimed challenge colliding with an existing attempt ID likewise returns SQL `stale` (`359–362`) versus memory `locked` (`87`). Both are allowed rejection kinds in `state-validation.ts:105`; neither grants permission. The SQL probe's exact consumed-replay expectation is `stale` (`135`).

## Static observations

- The facade rejects unknown commands/extra or missing keys before mutation, validates typed identifiers/intent/enums, and uses no dynamic SQL. Nullable numeric consent fields are individually checked before numeric casts.
- The source declares restrictive caller-role attributes, revokes private-schema/table/helper/cleanup access, and adds only the public facade grant. The facade pins an empty `search_path` and qualifies stored objects. Effective privileges in the existing project need readback. Claims checking is not signature verification; it depends on the separately admitted PostgREST boundary.
- Same-day transitions lock the day before the relevant challenge/attempt. `checks_spent` changes under that lock; known finishes clear only the matching hold without refunding spent capacity, and unknown outcomes retain it. The reviewed paths preserve a two-check cap and one active booking-day hold.
- Granted owner history survives release and is bounded at 64. Neither an existing owner nor duplicate process authorization regrants. Identical terminal finish acknowledgement cannot change terminal values. No kiosk reconciliation or automatic active-owner takeover exists.
- Consent insert/update precedes the reservation writes in one SQL function invocation. An uncaught consent error aborts the invocation transaction; runtime rollback remains unmeasured. Retention timestamps are DB-derived and not extended on retry. Cleanup deletes consent separately, skips active safety metadata, and cannot authorize an old day.

## Limits and unchanged gates

No SQL parser/database, role/ACL/RLS readback, JWT signature, exposure, pg_cron owner/health, concurrency, rollback, or cleanup execution was performed. SQL syntax was inspected only. No application import, test, build, network, credential, provider, booking, OTP, mail, or video operation occurred.

The public-only facade, four-table shape, and separate publishable apikey remain proposed Main amendments. The SQL is a raw source proposal, not a CLI-generated Foundry migration. Main A1–A7, exact migration/function readbacks, negative and concurrency probes, counsel, named apply authority, and Keith's own-face admission remain owed. Guest production stays paused; #225 executor remains keithkoo-84. Stopped lease probe, sealed R3, memory automation, and unrelated lanes are unchanged.

Metadata refresh: reread `state-memory.ts:48` using `Array.from(this.attempts.values())` and the compiler-compatibility note at `architecture/CONTRACT.md:31`. The loop body is unchanged; this does not alter the SQL source grade. Current memory SHA-256 already matched the value recorded below. Migration SQL/probe hashes remain unchanged. No compiler or runtime was executed for this refresh.

Reviewed SHA-256:

```text
0b5a0481bb5204bdd4e89c98e43ff7f2e508703d067e32ba899bbc78674ef5cf  migration/kiosk_wellness_state.sql
656c5e3f3900ffdbac96ccd38b66e85d72e56d2031b6e043c487f7a9d724629f  migration/kiosk_wellness_state.probes.sql
1458283b0085bce5b0ffe926a65938c5d25b6cfa013bbba2987c172490985aa1  architecture/CONTRACT.md
cf429efb5237cd67eb923580aa1f3ac1780649853faa02180838af6bce573a9a  candidate/lib/wellness/state.ts
1d0cdfa5aea855af1bf85e8bfa1e445f940a89b97489a6ac3c33f49cc000155e  candidate/lib/wellness/state-memory.ts
a8f774c279c390245207c4874334dcb9dcde4ee8fbfd14fd5a7188888fdd3ff9  candidate/lib/wellness/state-validation.ts
```
