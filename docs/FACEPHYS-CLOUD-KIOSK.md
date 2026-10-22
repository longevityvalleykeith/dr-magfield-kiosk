# FacePhys Cloud v3 wellness check: DR MAGfield KRPM kiosk (`/scan`)

**Status:** candidate on a draft PR. **No guest use** until all three of these are done:
1. Keith runs his own-face test on the Preview.
2. Main grades the exact commit.
3. Astra grades the exact commit (Keith, 10-19).

The spec is `features/kiosk-cloud-wellness.feature`, which runs as tests. It traces to T1 #164 (CLOUD-01..18, O2O-01..12; PROPOSED, a Codex lane).

## Keith's words (10-19, verbatim)

| Question | Answer |
|---|---|
| Path | "guest kiosk on v3, LV stores nothing, data sent to guest's email address [CC able to CARE employee] , just like calendesk employee ID to choose from" |
| Surface | "build fresh on [vercel dr-magfield-kiosk-krpm] or Build on Vedo Vercel [surprise me!]". This repo is the one that deploys to `dr-magfield-kiosk-krpm`, and the standee at `/` is untouched. |
| Charge confirmation | "follow recommended...with entity matching guardrails". The guest's Start tap confirms the charge for one attempt. |
| Results | "Email and screen" |
| Booking confirmation | "Kiosk reads Calendesk" |
| Storage | "Minimal consent record as per 2 : defer intent object routing for now" |
| Delivery | "One email with CC" |
| Pilot | "After your test + grades (recommended)...implemented by drmagfield.keithkoo@gmail.com account via claude api" |

These choices override parts of Main's 10-18 desk-edge plan and of #164 for this surface:
- **Main's plan:** EDGE-BDD-12 (no Cloud) and B3 ("not a kiosk").
- **#164:** separate deliveries, results on a private surface, and strict-zero storage.

The pilot gate in #164 (CLOUD-17) still stands until Keith lifts it.

## Flow

0. **Entry: the guest's own phone** (Keith 10-19: "Make it SIMPLE & SURPRISE ME… resolve [QR path can never reach the check]", then "go"). The standee QR opens `https://dr-magfield-kiosk-krpm.vercel.app/scan?src=qr`, and `/scan` logs `qr_open` as a count. This supersedes 09-02 EV-1 and 08-29 KD-F4 **for this QR only**; LV's doorway is unchanged.
1. **Enrolment (tablet mode only).** With `KIOSK_ENROLL_CODE` set, a staff member enrols a tablet once at `/scan/enroll` (an HttpOnly `__Host-dmk-device` cookie, valid for 30 days). **Guests' phones can't be enrolled, so phone-first needs `KIOSK_ENROLL_CODE` unset.**
2. **Booking email, then the code.** The guest types their email; any booking number sent with the request is ignored. The server lists today's bookings (`GET /admin/bookings/v2` with day filters only, as Foundry's production reader calls it; status and email are matched on the server, so the email is never put in a URL), keeps those at the outlet, and reads a booking in full only when its list row has no email. If one matches, a 6-digit code goes to the booking's own inbox (the address Calendesk holds). Either way the page gets the same `code_sent` reply, so it can't be used to learn who is booked. The code (`POST /api/wellness/verify`) works for 10 minutes, once; 5 wrong entries lock it; at most 3 codes per booking a day. The challenge carries only a keyed hash of the code, so LV stores nothing. On the right code, the booking is re-read and the entity match applied:
   - the booking is at location 6 (KRPM);
   - any service there (Keith 10-19: "Any service at KRPM"; location 6 offers services 8, 13 and 14), unless `KIOSK_SERVICE_IDS` restricts it;
   - the date is today in Kuala Lumpur;
   - the status is approved or done;
   - the typed email is the booking's email.

   A booking that is not found and a booking that does not match get the same generic answer. The reason is logged server-side only.
3. **Consent, in English or Bahasa Melayu.** There are three separate choices:
   - processing by FacePhys, possibly outside Malaysia;
   - email delivery to the booking address;
   - an optional CC to the booking's own CARE employee. It is unticked, offered only if that employee is on the active KRPM roster, and the reply-all consequence is shown.

   If that employee becomes unavailable before the scan, only the CC is dropped. It is never replaced, and the guest's own check still runs (T1 #164 v1.7, O2O-04).
4. **Camera.** The camera opens (front, no audio), then the guest taps **Start my scan**. That tap is the charge confirmation. The clip is an mp4 of `SCAN_SECONDS` (default 20). The camera closes as soon as the clip exists.
5. **Server.** The server:
   - re-checks the booking, the email binding and the recipient at the point of charge;
   - presigns;
   - PUTs the exact bytes to the presigned host, which must be https and on `FACEPHYS_UPLOAD_HOSTS` (required). No outbound call follows a redirect;
   - calls `POST /api/v3/video/process` with `{objectKey, capability:"rppg", confirmCharge:true, idempotencyKey:"dmk-<attemptId>", videoSha256}`.
6. **Result.**
   - Only heart rate, RMSSD, SDNN and breathing rate survive, after a quality gate and plausibility ranges. Everything else FacePhys returns is dropped.
   - The values are shown on screen and sent as one email to the booking address, plus the CC if ticked.
   - The screen resets on Done, after 45 s, on inactivity, or when the tab is hidden.
7. **Outcomes.** The possible outcomes are completed, insufficient quality, failed and **outcome unknown**. A lost process response is never resubmitted under a fresh key.
   - **By default an unknown outcome stops.** There is no retry, the clip is dropped, and the screen shows a reference (the first 8 characters of the attempt ID in the consent record) for staff to reconcile.
   - With `SAME_KEY_RETRY=1`, a retry sends the same key and video digest, and FacePhys says it replays rather than charging again (`agent.md`). That claim is unmeasured.
   - A retry after a failed presign or upload is always allowed, because nothing was charged.

**Time budget:** Calendesk 4 s, presign 5 s, upload 13 s, process 25 s and email 4 s add up to 51 s, under the 60 s function limit. The optional consent-record email is sent only if at most 48 s have elapsed; otherwise it is skipped and logged, and the record line is still written.

**The consent screen** shows the exact To address and the exact CC address. If the CC's roster address changes after the match, the CC is dropped and never re-pointed.

## Data map: who holds what

| Data | Where it goes | LV keeps |
|---|---|---|
| Face video | Browser memory → `/api/wellness/scan` (Vercel `sin1`, in transit only) → FacePhys object storage. The storage region is **UNMEASURED**; the `vendor_upload_host` log line names the host on the first real scan. | Nothing |
| Readings (4) | Kiosk screen until reset; the results email | Nothing |
| Guest email | Typed on the kiosk, compared with Calendesk, used as the email recipient | Nothing (only a keyed hash inside the 15-minute attempt token) |
| CARE employee email | Server-side roster only; masked on screen; CC recipient | Nothing new |
| Consent record | One runtime log line, plus an email to `CONSENT_RECORD_TO` if that is set | Fields per T1 #164 `CALENDESK-CONSENT-FIELDS` (Keith: "must include key Calendesk context, explicitly location and CARE employee ID"); see below |

"LV stores nothing" does not mean nothing is stored anywhere. FacePhys, Resend and every mailbox on the email keep their own copies. Counsel has not reviewed this.

Routing the consent record into Foundry's receipts is **deferred** (Keith). Until then the record is only as durable as the Vercel log retention, or the `CONSENT_RECORD_TO` mailbox.

## The consent record (`dmk-consent-v2`)

**Fields:**
- **Record and tenant:** `consentRecordId` · `attemptId` (= the FacePhys idempotency key without the `dmk-` prefix) · `tenantId` · `calendeskAccountRef` (the tenant name, not a key).
- **Booking context:** `bookingId` · `locationId` (`location.location_id`) · `serviceLocationId` (`location.id`, kept distinct) · `serviceId` · `serviceTypeId` · `careEmployeeId` (the booking's employee, kept even when the CC is declined; it is not a disclosure grant).
- **Assurance and notice:** `subjectBinding` · `purpose` · `noticeVersion`.
- **Decisions:** `processingDecision` · `careCcDecision` (`agreed` / `declined` / `unavailable`).
- **Recipient bindings:** `guestRecipientRef` and `careRecipientRef`. These are keyed HMACs of the exact destinations shown, never plaintext or an unsalted hash.
- **Times and policy:** `recordedAt` · `sourceSurface` · `verificationCheckedAt` · `verificationPolicyVersion` · `retentionPolicyVersion` and `deleteAfter`. The retention rule stays `unset`/`null` until Keith sets `CONSENT_RETENTION_POLICY` and `CONSENT_RETENTION_DAYS`; no duration is invented.
- **Outcomes:** `outcome` · `delivery`. These are the sent/failed codes from the option Keith chose. The supplement says no delivery history is admitted, so **Main to rule** on the difference.

**Never in the record:** video, readings, names, email addresses, raw booking payloads, signed URLs or secrets.

## Assurance and recovery: stated, not claimed

- **Subject assurance is inbox control (`code-to-booking-inbox`).** The code proves the guest can open the booking's inbox. It does **not** prove who they are, and nothing remote can: a phone, a passkey, an email or a booking number all prove possession, not personhood (Keith 10-19: "same phone… DOESN'T MEAN YOU ARE THE SAME PERSON"). So the design never claims identity. A reading can only reach the inbox the code was sent to, and the consent screen says the check is for the person who received the code. If a booker hands their unlocked phone or inbox to someone else, that is the booker's act.
- **Recovery is limited.** The operation identity (attempt ID = idempotency key) lives in the kiosk's memory for 15 minutes, and in the consent record.
  - After a reset or reload, an *unknown* outcome cannot be recovered by the kiosk. No durable recovery owner is admitted, so that gate stays **held**.
  - The attempt ID in the consent record is what an operator would quote to FacePhys support.
  - Replay behaviour is the vendor's **documented** claim (`agent.md`). It is not yet measured.
- **"Sent" is not "delivered".** It means the mail service took the message. It does not show that both mailboxes received it, and it never means CARE accepted anything.

## Environment variables (Vercel → `dr-magfield-kiosk-krpm` → Settings → Environment Variables)

**Production simplicity (Keith, 10-19).** Production needs only the switch and the four vendor secrets. Everything else is defaulted or derived. Mark secrets **Sensitive**, and never use a `NEXT_PUBLIC_` prefix.

| Name | Value | Secret? |
|---|---|---|
| `SCANS_ENABLED` | `1` switches the check on; anything else turns it off immediately | no |
| `FACEPHYS_KEY_ID` | the Agent Key ID from the FacePhys console (an identifier, not a secret) | no |
| `FACEPHYS_SECRET_KEY` | the Agent Key secret. It also derives the kiosk's signing key when `KIOSK_COOKIE_SECRET` is unset | **yes** |
| `CALENDESK_API_KEY` | a Calendesk API key. The code only ever sends GET requests: a booking, its employee, and `/admin/settings` for the probe | **yes** |
| `RESEND_API_KEY` | a Resend key with sending access | **yes** |

**Defaults, which you can override:**
- `CALENDESK_TENANT` = `zqlc6ablyz`, LV's own tenant behind `book.longevityvalley.ai` (measured in T1);
- `EMAIL_FROM` = `DR MAGfield <noreply@longevityvalley.ai>`, the sender Foundry already uses;
- `FACEPHYS_BASE_URL` = `https://www.facephys.com`.

**Dynamic, so no static setting is needed:**
- **Upload host:** https only, never through a redirect, under FacePhys's own domain or a known object-storage provider (Alibaba OSS, S3, Tencent COS, Cloudflare R2, Google Cloud Storage, Azure Blob). `FACEPHYS_UPLOAD_HOSTS` optionally pins it tighter.
- **CC recipient:** the booking's own Calendesk employee (name and email from Calendesk), never a substitute. `CARE_ROSTER_JSON` optionally restricts it to a roster.

**Optional stricter mode:**
- `KIOSK_ENROLL_CODE` (16+ characters) requires one-time set-up per tablet. Without it, every check is still gated by today's booking match, a typed booking email and the kill switch.
- `KIOSK_COOKIE_SECRET` sets an independent signing key.

**Other optional settings:** `CONSENT_RECORD_TO`, `CONSENT_RETENTION_POLICY`/`CONSENT_RETENTION_DAYS`, `ALLOW_MISSING_QUALITY`, `SAME_KEY_RETRY`, `SCAN_SECONDS`, `MIN_SIGNAL_QUALITY`, `KIOSK_LOCATION_ID`, `KIOSK_SERVICE_IDS`, `KIOSK_OUTLET`, `KIOSK_OUTLET_NAME`, `KIOSK_TIME_ZONE`, `KIOSK_TENANT`, `KIOSK_BOOKING_URL` (the paused page's way back to booking: absolute https on longevityvalley.ai only, default `https://book.longevityvalley.ai`).

**Check the setup without a charge:** open `/api/wellness/health?probe=facephys`. In open mode anyone can run it, at most 10 times a minute per instance; in enrolled mode only an enrolled tablet can. It returns booleans; FacePhys `auth/test`; a free presign preflight giving `uploadHost` (hostname only), `uploadHostAllowed` and `uploadPolicy`; and `calendeskAuth`. It never returns a signed URL or any value.

## Paused state and the re-open checklist (binding order)

**Paused now** (`SCANS_ENABLED=0`; Main 10-19 §6 ruling 1, re-affirmed in #175 A1). `/scan` shows "Wellness check paused", the visit continues as normal, and a **Back to booking** link (BS-00, K1). There is no OTP, consent, camera or result action. Arrivals are counted as `qr_open` with `src` = `qr` (the standee) or `lvqr` (LV's old printed QR, 308-redirected from `app.longevityvalley.ai/scan/dr-magfield/krpm`). When `lvqr` reaches zero, LV's redirect can retire (10-19 §7.4). **A merge does not re-open scans.**

**Re-open, in this order.** This follows the full 10-19 §6–§9 sequence that #175 A1 incorporates. Where #175's compressed list differs, the full order holds (T1 #173 rev 1.9.3; Mini ACK C6). Each step is a separate proof:
1. **Durable state:** kiosk PR #10 (specialist author) is graded and applied by its named authority, with exact-byte, privilege and deletion readbacks and negative probes.
2. **RT02, RT03, RT04 each GREEN** against that store (RT02 is held today: `npm run test:held`).
3. **Consent copy:** "LV keeps a minimal consent record (no video, no readings) for 30 days" (Keith 10-19). Counsel's review of the wording is owed.
4. **Upload host:** Keith admitted **Alibaba Cloud OSS** on 10-22, adding it to R2/S3/GCS. Read the exact presign host with the free preflight, pin that exact host (not `dynamic`), read the pin back, and measure the processing region and the PDPA transfer basis. This all comes **before** the formal grade.
5. **CC off** until a KRPM-only roster exists.
6. **Main and Astra regrade the exact commit**, after Astra's existing queue.
7. **Before any re-open, Keith decides:** cloud or on-device (A3b; Foundry's notice still promises on-device), and the REN→KRPM outlet mapping (A4). With cloud, the Foundry notice amendment ships **in the same release** as the re-open, and the served notice and the served kiosk must agree (BS-13).
8. **Keith's own-face test** on KRPM service 16, 8 or 13, **never 14**.
9. **Keith's re-open word.** Only then is Calendesk's button repointed. Until then it is hidden or relabelled.

## Clause map against T1 #164

| #164 | This build | Evidence |
|---|---|---|
| CLOUD-01 scope | Optional check in a separate preview; the standee is kept; Vedo can later be a configured tenant | K-01; `/` unchanged |
| CLOUD-02/05/14 data promise | A minimal consent record (Keith), with fields per `CALENDESK-CONSENT-FIELDS` and Keith's sent/failed codes | K-05, K-06 |
| CLOUD-03 sharing | The booking's own employee, roster-checked and never substituted. An ineligible CC never blocks the check. | K-05, K-07, K-17 |
| CLOUD-04 one contract | A server-owned adapter, with the upload origin validated and no CORS assumed | unit tests; census |
| CLOUD-04 shared with the PWA | **GAP**: the adapter lives in this repo only | — |
| CLOUD-05 orchestration | No LV outbox. Recovery uses the vendor's same-key replay. | K-09 |
| CLOUD-06 retries | A stable key plus the video digest; never a fresh key. By default an unknown outcome stops and is reconciled. | K-08, K-09, K-23 |
| CLOUD-07 / O2O-03 phone continuation | **GAP**, not built: results show on the kiosk (Keith's choice) | — |
| CLOUD-08 flow | Match → consent → camera → confirm → submit → outcomes → delivery | K-05, K-10, K-15 |
| CLOUD-09 / O2O-12 Edge mode | Not applicable: this surface has no Edge mode, so nothing falls back | — |
| CLOUD-10 consent | Separate choices, sharing unticked, both destinations and reply-all shown | K-05, K-06 |
| CLOUD-11 shared device | Reset on done, idle and hidden. Results stay on screen until reset (Keith's choice). | K-11 |
| CLOUD-12 recovery | No service worker, analytics or storage. "Unknown" is an explicit state. | K-09, K-16 |
| CLOUD-13..15 types and states | Transient `AttemptView`/token types; completed, insufficient, failed and unknown | K-09, K-10, K-15 |
| CLOUD-16 custody | This PR is the exact candidate | PR head |
| CLOUD-17 pilot | **HOLD** until Keith's own-face test plus Main's and Astra's grades | — |
| CLOUD-18 verification | Fake provider and mail first; a RED commit before GREEN | `4256e41` → GREEN |
| O2O-08 events | No event stream in this mode. The client drops stale and late replies. | K-11 |
| O2O-09 delivery ≠ acceptance | The screen only says "Emailed to …" | K-13 |

## Security posture of the framework (measured 2026-10-18, `npm audit --omit=dev`)

`next` 14.2.35 is the newest 14.x, but it still carries advisories that are fixed only on the 15.5/16.x lines:

| Advisory | Severity | Status for this app |
|---|---|---|
| GHSA-2xp9-vwfh-vxw4: RCE via sharp/libheif when AVIF is optimized (`/_next/image`) | Critical | **Mitigated.** `images.unoptimized: true`, and no page uses `next/image`. Probed locally: `/_next/image` returned 200 before and 404 after. |
| GHSA-p293-qw3h-jr36: RCE on Windows-hosted servers | Critical | Not applicable on Vercel's Linux runtime |
| SSRF via rewrites, Pages-Router i18n middleware bypass, WebSocket SSRF, Server Actions SSRF on custom servers | High | This app has no rewrites, middleware, WebSockets, Server Actions or custom server |
| Denial of service in RSC request handling and App Router | High | Applies in principle. A tablet-only kiosk limits exposure; it is not a fix. |

There are also two transitive high advisories (`postcss` via next; `nanoid` and `source-map-js` at build time).

**Recommendation:** before guests, upgrade to `next` ≥ 15.5.24 (15.5.28 is the latest backport) with React 19. Do it as its own unit, because it changes the existing standee app's request APIs and caching defaults.

## Known unknowns

- **The v3 result schema is unspecified.** The field map is calibrated from the vendor's public Playground. `vendor_result_shape` logs key paths, never values, so the map can be checked against the first real result.
- **Storage region, retention and deletion at FacePhys are unknown**, and so is whether Agent Keys may back a guest-facing server. These go to counsel and the vendor.
- **Resend's honouring of `Idempotency-Key` is unmeasured.** If it is ignored, a replayed attempt could send a duplicate email.
- **The device matrix is unmeasured.** Chrome 155 on macOS records mp4. Every tablet must pass `MediaRecorder.isTypeSupported('video/mp4')`; otherwise the kiosk says so and the visit continues.
- **The brakes are per serverless instance.** The hard spend cap is the FacePhys balance (a 403 is shown honestly).
  - **Per booking:** at most 2 charged checks a day (one retry after a poor reading). A third is refused with `BOOKING_ALREADY_CHECKED`, both at the match and at the point of charge (K-29, K-30).
  - **Open mode:** each booking has its own new-attempt bucket, so one guest never uses up another's (K-31).
  - **Booking lookups:** checked before Calendesk is read. At most 10 refused lookups per client (`x-real-ip`) in 10 minutes, and 60 reads a minute per instance; otherwise `TOO_MANY_LOOKUPS` (K-32, K-33). The client address is a brake key only and is never logged.
  - **Before the vendor call:** the per-booking slot is reserved before any await and released only when nothing reached FacePhys; an unknown outcome holds the booking until staff reconcile it (`CHECK_PENDING`).
  - **Codes:** a code is held while its booking is read and released if Calendesk fails. Every lookup answers the same `code_sent` after the same fixed time (`LOOKUP_REPLY_MS`), including a refused code email.
  - **Calendesk:** today's list (day filters only) is kept 30 s per instance and read again when it can't place the email; a list row is only a candidate, and an attempt is issued on a fresh read by ID. `booking_list_shape` logs the list's field names (never values).
  - **Not durable:** a new or second instance starts at zero. Caps, used codes and holds that survive instances need a shared store: that is the next unit, for Main's admission (T1 #164). Until then `npm test` skips Astra's RT02 by name and `npm run test:held` shows it RED.

## Verify

```
npm ci && npm run build && npm test      # 62 tests: Gherkin + unit + censuses
npx tsc --noEmit
```
