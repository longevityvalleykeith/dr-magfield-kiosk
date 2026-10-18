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

1. **Enrolment.** A staff member enrols the tablet once at `/scan/enroll`. The set-up code sets an HttpOnly `__Host-dmk-device` cookie, valid for 30 days.
2. **Booking.** The guest enters the booking number and the booking email. The server reads `GET /admin/bookings/{id}` from Calendesk and applies the entity match:
   - the booking is at location 6 (KRPM);
   - the service is 13 or 14;
   - the date is today in Kuala Lumpur;
   - the status is approved or done;
   - the typed email is the booking's email.

   A booking that is not found and a booking that does not match get the same generic answer. The reason is logged server-side only.
3. **Consent, in English or Bahasa Melayu.** There are three separate choices:
   - processing by FacePhys, possibly outside Malaysia;
   - email delivery to the booking address;
   - an optional CC to the booking's own CARE employee. It is unticked, offered only if that employee is on the active KRPM roster, and the reply-all consequence is shown.
4. **Camera.** The camera opens (front, no audio), then the guest taps **Start my scan**. That tap is the charge confirmation. The clip is an mp4 of `SCAN_SECONDS` (default 20). The camera closes as soon as the clip exists.
5. **Server.** The server:
   - re-checks the booking, the email binding and the recipient at the point of charge;
   - presigns;
   - PUTs the exact bytes to the presigned host, which must be https and on `FACEPHYS_UPLOAD_HOSTS` when that is set;
   - calls `POST /api/v3/video/process` with `{objectKey, capability:"rppg", confirmCharge:true, idempotencyKey:"dmk-<attemptId>", videoSha256}`.
6. **Result.**
   - Only heart rate, RMSSD, SDNN and breathing rate survive, after a quality gate and plausibility ranges. Everything else FacePhys returns is dropped.
   - The values are shown on screen and sent as one email to the booking address, plus the CC if ticked.
   - The screen resets on Done, after 45 s, on inactivity, or when the tab is hidden.
7. **Outcomes.** The possible outcomes are completed, insufficient quality, failed and **outcome unknown**. A lost process response is never resubmitted under a fresh key. Retrying the same attempt sends the same key and video digest, and FacePhys replays the result rather than charging again (`agent.md`).

## Data map: who holds what

| Data | Where it goes | LV keeps |
|---|---|---|
| Face video | Browser memory → `/api/wellness/scan` (Vercel `sin1`, in transit only) → FacePhys object storage. The storage region is **UNMEASURED**; the `vendor_upload_host` log line names the host on the first real scan. | Nothing |
| Readings (4) | Kiosk screen until reset; the results email | Nothing |
| Guest email | Typed on the kiosk, compared with Calendesk, used as the email recipient | Nothing (only a keyed hash inside the 15-minute attempt token) |
| CARE employee email | Server-side roster only; masked on screen; CC recipient | Nothing new |
| Consent record | One runtime log line, plus an email to `CONSENT_RECORD_TO` if that is set | version · time · attempt ID · keyed booking hash · outlet · share flag · outcome codes |

"LV stores nothing" does not mean nothing is stored anywhere. FacePhys, Resend and every mailbox on the email keep their own copies. Counsel has not reviewed this.

Routing the consent record into Foundry's receipts is **deferred** (Keith). Until then the record is only as durable as the Vercel log retention, or the `CONSENT_RECORD_TO` mailbox.

## Environment variables (Vercel → `dr-magfield-kiosk-krpm` → Settings → Environment Variables)

Mark every secret **Sensitive**. Set them on **Preview** first, for the own-face test, and on **Production** only after the grades. **Never use a `NEXT_PUBLIC_` prefix.**

| Name | Value | Secret? |
|---|---|---|
| `SCANS_ENABLED` | `1` to switch the check on; anything else turns it off immediately | no |
| `FACEPHYS_BASE_URL` | `https://www.facephys.com` | no |
| `FACEPHYS_KEY_ID` | the Agent Key ID from the FacePhys console (an identifier the API echoes back, not a secret) | no |
| `FACEPHYS_SECRET_KEY` | the Agent Key secret from the FacePhys console. Paste it into Vercel only: never into chat, the repo or a committed `.env` | **yes** |
| `FACEPHYS_UPLOAD_HOSTS` | optional, comma-separated host suffixes (for example `aliyuncs.com`). Fill it in after the first scan logs `vendor_upload_host`. | no |
| `CALENDESK_API_KEY` | a Calendesk API key; a separate key from Foundry's if Calendesk allows one. This code only ever sends a GET for one booking. | **yes** |
| `CALENDESK_TENANT` | the Calendesk tenant, the same value as Foundry's `CALENDESK_TENANT` | no |
| `RESEND_API_KEY` | a Resend key with **sending access only** | **yes** |
| `EMAIL_FROM` | for example `DR MAGfield <kiosk@your-verified-domain>`, on a domain verified in Resend | no |
| `CARE_ROSTER_JSON` | `[{"calendeskEmployeeId":12,"name":"…","email":"…","outlets":["krpm"],"active":true}]`, using the Calendesk employee IDs of services 13/14 | **yes** (staff emails) |
| `KIOSK_ENROLL_CODE` | 16 or more random characters, typed once per tablet at `/scan/enroll` | **yes** |
| `KIOSK_COOKIE_SECRET` | 32 or more random characters. Changing it un-enrols every tablet and voids open attempts. | **yes** |
| `CONSENT_RECORD_TO` | optional: an LV mailbox for the minimal consent records | no |
| `SCAN_SECONDS`, `MIN_SIGNAL_QUALITY`, `KIOSK_LOCATION_ID`, `KIOSK_SERVICE_IDS`, `KIOSK_OUTLET`, `KIOSK_OUTLET_NAME`, `KIOSK_TIME_ZONE` | optional overrides; the defaults are 20 · 0.5 · 6 · 13,14 · krpm · DR MAGfield KRPM · Asia/Kuala_Lumpur | no |

**Check the setup without a charge:** open `/api/wellness/health?probe=facephys` on an enrolled tablet. It returns booleans plus FacePhys `auth/test`, never a value.

## Clause map against T1 #164

| #164 | This build | Evidence |
|---|---|---|
| CLOUD-01 scope | Optional check in a separate preview; the standee is kept; Vedo can later be a configured tenant | K-01; `/` unchanged |
| CLOUD-02 data promise | A minimal consent record, by Keith's decision | K-05 |
| CLOUD-03 sharing | The booking's own employee, roster-checked and never substituted | K-05, K-07 |
| CLOUD-04 one contract | A server-owned adapter, with the upload origin validated and no CORS assumed | unit tests; census |
| CLOUD-04 shared with the PWA | **GAP**: the adapter lives in this repo only | — |
| CLOUD-05 orchestration | No LV outbox. Recovery uses the vendor's same-key replay. | K-09 |
| CLOUD-06 retries | A stable key plus the video digest; never a fresh key | K-08, K-09 |
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

## Known unknowns

- **The v3 result schema is unspecified.** The field map is calibrated from the vendor's public Playground. `vendor_result_shape` logs key paths, never values, so the map can be checked against the first real result.
- **Storage region, retention and deletion at FacePhys are unknown**, and so is whether Agent Keys may back a guest-facing server. These go to counsel and the vendor.
- **Resend's honouring of `Idempotency-Key` is unmeasured.** If it is ignored, a replayed attempt could send a duplicate email.
- **The device matrix is unmeasured.** Chrome 155 on macOS records mp4. Every tablet must pass `MediaRecorder.isTypeSupported('video/mp4')`; otherwise the kiosk says so and the visit continues.
- **The brakes are per serverless instance.** The hard spend cap is the FacePhys balance (a 403 is shown honestly).

## Verify

```
npm ci && npm run build && npm test      # 62 tests: Gherkin + unit + censuses
npx tsc --noEmit
```
