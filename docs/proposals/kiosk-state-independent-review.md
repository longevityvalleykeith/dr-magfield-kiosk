# Independent state and integration review

Final disposition: **CONCUR with the bounded frozen source proposal; HOLD runtime proof, Main admission, database application and production.** No unresolved concrete P1/P2 implementation finding was found after the root amendments below.

This is an independent, author-barred static review. The reviewer made no implementation edits and ran no tests, builds, runtime imports, network requests, SQL, provider calls, or credential/configuration reads. Static test definitions and root-reported parse-only checks are not executed behavior evidence. This reviewer is not Main and cannot grant production authority.

## Scope and custody

Reviewed: selected contract and Main admission record; state protocol/validation/memory/RPC; HTTP/configuration/live/consent/record/provider integration; token comments; original RT02; root durable tests/fixture; raw SQL, prepared probes and SQL README. Unchanged match.ts and calendesk.ts compare equal to baseline; relevant matching, route and dependency timeout source was inspected. The final snapshots below supersede the initial five-second adapter, pre-amendment fixture and null-unsafe SQL-probe snapshots.

| File | Final SHA-256 |
| --- | --- |
| architecture/CONTRACT.md | `896c0284b5c8db1adbfc70768702e091423d8483c4eb0ae3a28a4dc2a4b926aa` |
| authority/MAIN-ADMISSION.json | `9632abc5641eec2d818cefc6131e3c3937250f0d7f254289731f222f51d0545a` |
| candidate/lib/wellness/state.ts | `cf429efb5237cd67eb923580aa1f3ac1780649853faa02180838af6bce573a9a` |
| candidate/lib/wellness/state-validation.ts | `a8f774c279c390245207c4874334dcb9dcde4ee8fbfd14fd5a7188888fdd3ff9` |
| candidate/lib/wellness/state-memory.ts | `1d0cdfa5aea855af1bf85e8bfa1e445f940a89b97489a6ac3c33f49cc000155e` |
| candidate/lib/wellness/state-rpc.ts | `1a8e5d46e6b2541fcb80f56a579f4b7bed69c9636023e488961adffb1714eebb` |
| candidate/lib/wellness/http.ts | `8b56ca693a1021ee8a365a01ee516a79e49758b370ad3519196c7b5a20325fae` |
| candidate/lib/wellness/config.ts | `b4e05b69e6e9a943299d1198b41d99cb34c40e0424167e8b5a29270801418088` |
| candidate/lib/wellness/live.ts | `af748403e69c055e83be724177cb91efcdd87600aae03dda647e1175cd4ae422` |
| candidate/lib/wellness/record.ts | `0dd71caf385284d4a1f68a38b748d6b9a043b5146630e27d6eae0ce934ca453a` |
| candidate/lib/wellness/consent.ts | `f8dd174e341149eec007d8a705c624f6a375ff0f51003614255ae372842c51ba` |
| candidate/lib/wellness/facephys.ts | `4bcde64a5974d0ecb088ec65081a5f38ee6edb2e08e84e78c3150295ee8404c0` |
| candidate/lib/wellness/tokens.ts | `a4d4e9623c6292a0d626822d3657f7ee7d6878cc8250bd5fff6d9cb62f846507` |
| candidate/tests/state-durable.test.mjs | `a2373ad5375c942fc30abb54b28c7ff0a285edbe93dd0151294dbc5dc7c9e040` |
| candidate/tests/state-world.mjs | `99601443fa638ecb47f841c157614ff9601c1c87393b227c6412cf3510d6c11b` |
| migration/kiosk_wellness_state.sql | `0b5a0481bb5204bdd4e89c98e43ff7f2e508703d067e32ba899bbc78674ef5cf` |
| migration/kiosk_wellness_state.probes.sql | `656c5e3f3900ffdbac96ccd38b66e85d72e56d2031b6e043c487f7a9d724629f` |
| migration/README.md | `5ce9e57f7dac4b6845b2ba13be6c95a9ea515323d1ba924145fe65510a9b7865` |

## IS-02: registered-versus-decoy wrong-code oracle

**Original grade: P1 / AMEND. Final source status: REMEDIATED; behavior NOT_EXECUTED.**

The earlier http.ts:207-210 mapped claim_code/wrong to HTTP 400 but locked to 429. An unmatched lookup issues an unregistered signed decoy; state-memory.ts:64-65 and SQL:320-322 return locked for it. A fresh matched challenge returned wrong for an incorrect guess. Lookup plus one guessed six-digit code therefore distinguished a matched booking from a decoy without inbox control.

The frozen cure at http.ts:208-217 returns identical HTTP 400 / CODE_WRONG for every incorrect code on a valid, unexpired signed challenge, before interpreting the state reply. It also refuses to mint an attempt if an unexpected store reply grants an incorrect code. A 2500 ms reply floor begins before the claim, with a 2000 ms RPC abort deadline. This is a configured floor, not measured constant-time behavior. Correct consumed/locked codes retain 429, preserving RT02; durable fifth-guess locking remains unchanged.

Prepared DI08 (state-durable.test.mjs:171-195) compares status/body and injected wait floor for registered fresh, fifth/sixth wrong, decoy and consumed-wrong paths; a known correct sixth still returns 429. DI06 changes public wrong-code statuses to 400 while DS01 retains durable fifth locking. These are static definitions only.

## IS-01: historical provider permission credit in the fixture

**Original grade: P2 / AMEND test proof. Final source status: REMEDIATED for the suite's separate scan dependency contexts; behavior NOT_EXECUTED.**

The original state-world.mjs:33,38 accepted any historical begin grant and unused global authorization count. Request A could obtain permission and abandon it; faulty request B could consume that apparent credit without its own grant.

The frozen fixture creates isolated dependency closures (state-world.mjs:27-63), clears the closure's claim on any begin, captures granted attemptId/owner, binds authorization to that pair, checks process idempotency key against the claim, and consumes permission once. other() constructs a fresh closure. Scan cases must continue using a fresh dependency context for each simulated request: this is dependency-scoped instrumentation, not a general multi-request execution trace.

## Source conclusions

- **Atomicity and fences:** memory mutations finish synchronously before yielding. SQL locks day before challenge/attempt, remembers up to 64 successful owners, and never regrants a seen owner. Consumption creates one ready attempt. Stale release cannot clear replacement owners. Authorization moves preparing/reserved to processing once; release works only before it. No automatic takeover or kiosk reconciliation command exists.
- **Caps and holds:** three challenges per booking-day and five wrong guesses per challenge persist in the proposed shared store. Two sequential known outcomes retain spent slots and clear their own hold; a third is capped. Unknown, lost-authorize-response and crashed/unfinalized processing retain the active hold. Cleanup skips active days; current-day checks prevent cleanup from reopening an old signed day/token. Real concurrency/clock probes remain owed.
- **HTTP order:** fresh detail matching precedes admission; minimal intent and slot commit together before presign (http.ts:279-298 after the privacy cure shifts). facephys.ts:91-104 requests authorization immediately before process, with no intervening await. Missing/lost authorization never invokes process or releases a hold. Pre-process failure releases only the current owner; post-barrier uncertainty holds. Mail occurs once in the owning path; a terminal acknowledgment does not trigger mail/provider replay.
- **Customer boundaries:** date/outlet/status/email matching is unchanged. Readiness requires MYT, fixed 30-day policy, one exact R2/S3/GCS-family upload hostname, state configuration and staff copies off. Upload requires exact host, HTTPS, no userinfo/custom port and refuses redirects. Code/results use CC null. Forged sharing cannot enable staff copying. liveDeps injects no synthetic state and has no memory fallback.
- **Consent:** exact whitelist excludes raw booking ID, email, video, readings, signed URLs and arbitrary JSON. References are HMAC-coded with fixed domains. Numeric context is positive/safe with typed nullable fields. Safe retry may refresh verification time only; SQL retains recorded_at/delete_after. Consent deletion is proposed at +720 hours with one-minute cron cadence; effective scheduler/deletion behavior is unmeasured.
- **Transport and privileges:** mandatory separate sb_publishable_ apikey and role JWT; per-call role/iat/exp/lifetime hygiene; HTTPS project origin; no redirect; two-second abort; exact command-specific replies; no retry or privileged-key fallback. Claims parsing is not signature authentication. SQL uses closed commands, exact typed input, empty search_path SECDEF facade, NOLOGIN/NOBYPASSRLS role, private schema/table/helper/cleanup revocations, RLS, facade EXECUTE only and authenticator membership. Effective grants, owner, gateway signature enforcement and public exposure still require readback.

The configured scan-dependency deadlines sum to 57 seconds before parsing, CPU, scheduling and platform overhead. This is not measured latency or a guaranteed fit within maxDuration 60; timeout can conservatively leave held state. The explicit memory clock field and Array.from iteration are compatibility source amendments; parse checks do not establish imports, types or behavior. Current SQL-probe reply/readback comparisons use null-safe IS DISTINCT FROM so missing kinds cannot silently pass the prepared oracle.

## Exact RT02 and remaining holds

The RT02 title, body, status assertions and final assertion message remain unchanged: baseline tests/astra-rt01-05.test.mjs:52-58 equals candidate:53-59. Fixture injection shares MemoryStateStore across replacement Brakes. The default package test command was observed skipping RT02; default-suite success cannot discharge it. Root must execute and record the exact baseline RED / candidate GREEN oracle explicitly.

All behavior is **NOT_EXECUTED by this reviewer**. Root owns execution after authors stop. SQL synthetic protocol/negative-permission checks and commented two-connection/clock/cleanup/rollback recipes are prepared evidence, not SQL execution, Data API reachability, or signature proof.

Main must disposition public facade, separate publishable-key/custom-role transport, typed-table/source-shape and public response-shape amendments. CLI-generated Foundry placement, named apply authority, exact function MD5/effective ACL/exposure readback, approved SQL concurrency/negative probes, retention scheduler health, Main/Astra exact-source regrades, counsel and Keith's own-face test remain outstanding. This report authorizes no apply, merge, release, guest reopening, provider/credential action, live booking/mail/OTP/video, stopped lease probe, sealedR3, #225 work, memory update or automation.
