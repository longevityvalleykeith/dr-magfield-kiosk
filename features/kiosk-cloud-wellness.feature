@cloud_v3 @fake_provider @fake_mail
Feature: DR MAGfield KRPM kiosk: an optional, booking-matched Cloud wellness check
  The guest's booking is matched before the camera opens. FacePhys v3 processes a
  short face video and the results go to the guest by email only, and on screen
  until reset. LV keeps only a minimal consent record for 30 days, committed to
  durable state before FacePhys is called: never video, readings or email addresses.

  Trace: T1 #164 (CLOUD-01..18, O2O-01..12). Keith's 10-19 §8 rulings bind this
  world: 30-day retention, one exact upload-host pin (Alibaba OSS admitted 10-22,
  beside R2/S3/GCS), staff copies (CC) off until a KRPM-only roster exists, and
  durable shared state (PR #10). Guests only after his own-face test, Main's and
  Astra's grades, and his re-open word.

  Background:
    Given the wellness check is enabled for outlet "krpm" at Calendesk location 6
    And this kiosk tablet is enrolled
    And today in Kuala Lumpur is "2026-10-20"
    And Calendesk has booking 501 at location 6 for service 13 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12

  Scenario: K-01 Declining keeps the camera closed and the visit unchanged (O2O-01)
    When the guest declines the wellness check
    Then the camera was never opened
    And no request reached FacePhys, Calendesk or the mail provider
    And the kiosk shows the "welcome" screen

  Scenario: K-02 A tablet that is not enrolled cannot start a check
    Given this kiosk tablet is not enrolled
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "DEVICE_NOT_ENROLLED"
    And no request reached FacePhys, Calendesk or the mail provider

  Scenario Outline: K-03 Entity matching refuses a booking that is not this guest's KRPM wellness session today
    Given Calendesk has booking 502 at location <location> for service <service> on "<date>" with status "<status>" for "<owner>" and employee 12
    When the guest confirms booking 502 with "guest@example.com"
    Then the booking is refused with "<reason>"
    And the camera was never opened
    And no request reached FacePhys or the mail provider

    Examples:
      | location | service | date       | status    | owner               | reason             |
      | 7        | 13      | 2026-10-20 | approved  | guest@example.com   | WRONG_OUTLET       |
      | 6        | 13      | 2026-10-19 | approved  | guest@example.com   | BOOKING_NOT_FOUND  |
      | 6        | 13      | 2026-10-20 | cancelled | guest@example.com   | BOOKING_NOT_ACTIVE |
      | 6        | 14      | 2026-10-20 | approved  | someone@example.com | BOOKING_NOT_FOUND  |

  Scenario: K-04 An unknown booking number is refused the same way as a mismatch
    When the guest confirms booking 999 with "guest@example.com"
    Then the booking is refused with "BOOKING_NOT_FOUND"
    And the kiosk shows the same message as for a mismatched booking

  Scenario: K-05 One email to the guest only, with staff copies off (O2O-04, Keith 10-19 §8)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the consent screen shows the exact To address "guest@example.com" and no CC address
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then FacePhys received exactly 1 presign, 1 upload and 1 process request
    And every outbound request refused redirects
    And the process request carried confirmCharge true, the attempt's idempotency key and the video's SHA-256
    And exactly 1 email was sent to "guest@example.com" with no CC
    And the email says "wellness indicator, not a medical measurement"
    And the kiosk shows the "result" screen with heart rate 72 bpm and the email as sent
    And the consent record holds only the admitted fields, with Calendesk location 6, CARE employee 12, the CC "declined" and no email address or reading
    And the consent record was finished as "completed" with the email "sent"
  Scenario: K-06 No CC is offered while staff copies are off, so the guest has nothing to tick (O2O-05)
    When the guest confirms booking 501 with "guest@example.com"
    Then no CARE recipient is offered
    Given the guest agreed to processing and email delivery
    And FacePhys will return heart rate 70, RMSSD 40, SDNN 50 and breathing rate 15 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the consent record keeps CARE employee 12 with the CC "declined"
  Scenario: K-07 A forged CC on the scan request is never honoured, and never blocks the guest's check (O2O-04)
    Given FacePhys will return heart rate 70, RMSSD 40, SDNN 50 and breathing rate 15 with signal quality 0.9
    When the guest confirms booking 501 with "guest@example.com"
    Then no CARE recipient is offered
    When the guest forces a CC on the scan request
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the scan reply reports the CC as "unavailable"
    And the consent record keeps CARE employee 12 with the CC "unavailable"
  Scenario: K-17 A configured CARE roster keeps the check off until a KRPM-only roster is admitted (Keith 10-19 §8)
    Given the CARE roster lists employee 12 "Aisyah" with "aisyah@example.com" as active at "krpm"
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "CHECK_DISABLED"
    And no request reached FacePhys, Calendesk or the mail provider
  Scenario: K-08 A double tap or a network resend never creates a second charge (O2O-06)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan twice for the same attempt
    Then FacePhys received exactly 1 presign, 1 upload and 1 process request
    And the scan is refused with "ATTEMPT_ALREADY_SUBMITTED"
    And exactly 1 email was sent to "guest@example.com" with no CC
  Scenario: K-09 A lost FacePhys response holds the booking until it is reconciled: no retry, no second charge (O2O-07)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys accepts the process request but its response is lost
    When the guest starts the scan
    Then the kiosk shows the "unknown" screen
    And no email was sent
    And the consent record was finished as "unknown_outcome" with the email "not_attempted"
    When the guest completes another check for booking 501
    Then the scan is refused with "CHECK_PENDING"
    And FacePhys received exactly 1 presign, 1 upload and 1 process request
  Scenario: K-10 A poor signal shows no invented values and sends no email (O2O-11)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72 with signal quality 0.2
    When the guest starts the scan
    Then the kiosk shows the "insufficient" screen with no values
    And no email was sent

  Scenario: K-11 A late result never reaches the next guest (O2O-02, O2O-08)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will answer the process request only when released
    When the guest starts the scan without waiting
    And the kiosk is reset for the next guest
    And FacePhys releases a result of heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    Then the kiosk shows the "welcome" screen with no result, email or recipient
    And the camera is closed

  Scenario: K-12 Cancelling stops the camera and discards the recording
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    When the guest cancels while the camera is on
    Then the camera is closed
    And no recording is held
    And no request reached FacePhys or the mail provider

  Scenario: K-13 A sent email is not CARE acceptance (O2O-09)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then the kiosk reports the email as "sent"
    And nothing the kiosk shows or returns says the CARE team accepted or fulfilled anything
  Scenario: K-14 The kill switch refuses before any vendor call (O2O-11)
    Given the wellness check is switched off
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "CHECK_DISABLED"
    And no request reached FacePhys, Calendesk or the mail provider

  Scenario: K-15 A FacePhys refusal fails honestly and the visit continues
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys refuses the process request with HTTP 403
    When the guest starts the scan
    Then the kiosk shows the "failed" screen
    And no email was sent

  Scenario: K-16 Nothing about a check is cached, stored or leaked (O2O-10)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then every wellness response carried "Cache-Control: no-store"
    And no wellness response contains the FacePhys secret or the Calendesk key
    And no log line contains the FacePhys secret, the Calendesk key, the guest's email or a reading
    And the kiosk code uses no localStorage, sessionStorage, IndexedDB or service worker

  Scenario: K-18 A result without any signal-quality field is not a reading (O2O-11)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with no signal quality field
    When the guest starts the scan
    Then the kiosk shows the "insufficient" screen with no values
    And no email was sent

  Scenario: K-19 With no upload pin the check stays off, and the free preflight names the host to pin (CLOUD-04, K2)
    Given no upload host is pinned
    When staff run the free FacePhys preflight on this tablet
    Then the preflight names the upload host "facephys-kiosk.oss-ap-southeast-1.aliyuncs.com" as not allowed by the "dynamic" rule
    And no video was uploaded and no process request was sent
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "CHECK_DISABLED"
    Given the upload host "facephys-kiosk.oss-ap-southeast-1.aliyuncs.com" is pinned
    When staff run the free FacePhys preflight on this tablet
    Then the preflight names the upload host "facephys-kiosk.oss-ap-southeast-1.aliyuncs.com" as allowed by the "pinned" rule
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk shows the "consent" screen
  Scenario: K-20 The consent record is committed before the first FacePhys call, and LV mails no record copy
    Given consent records are also mailed to "records@lv.test"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then the consent record was committed before the first FacePhys request
    And no consent-record email went to "records@lv.test"
  Scenario: K-21 A slow FacePhys reply still finishes the check and its consent record
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys takes 52 seconds and then returns heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the consent record was finished as "completed" with the email "sent"
  Scenario: K-22 The booking's Calendesk employee is never used as a CC, even when Calendesk names them (O2O-05)
    Given Calendesk names employee 12 as "Aisyah" with "aisyah@example.com"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And no Calendesk employee was read
  Scenario: K-23 By default an unknown outcome stops: no retry, and a reference to reconcile (O2O-07)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys accepts the process request but its response is lost
    When the guest starts the scan
    Then the kiosk shows the "unknown" screen
    And the kiosk offers no retry and shows the reference of the consent record's attempt
    When the guest retries the same attempt
    Then FacePhys received exactly 1 presign, 1 upload and 1 process request
    When the same attempt is resent at the network level
    Then the scan is refused with "CHECK_PENDING"
    And FacePhys received exactly 1 presign, 1 upload and 1 process request

  Scenario: K-24 Production minimum: open mode, four vendor secrets, one exact upload pin, 30-day retention and durable state
    Given production minimum: no enrolment code, cookie secret or CARE roster is configured
    And Calendesk names employee 12 as "Aisyah" with "aisyah@example.com"
    And this kiosk tablet is not enrolled
    When the guest confirms booking 501 with "guest@example.com"
    Then the consent screen shows the exact To address "guest@example.com" and no CC address
    Given the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And every outbound request refused redirects
  Scenario: K-25 An upload host other than the exact pin is refused before any upload (CLOUD-04)
    Given FacePhys presigns uploads to "uploads.evil.example"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    When the guest starts the scan
    Then the kiosk shows the "failed" screen
    And no video was uploaded and no process request was sent
  Scenario: K-26 Any service at KRPM counts (Keith 10-19), so a service-8 booking at location 6 is accepted
    Given Calendesk has booking 503 at location 6 for service 8 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12
    When the guest confirms booking 503 with "guest@example.com"
    Then the kiosk shows the "consent" screen

  Scenario: K-27 A booking at another outlet is refused, and the refusal log names its location and service IDs
    Given Calendesk has booking 504 at location 9 for service 21 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12
    When the guest confirms booking 504 with "guest@example.com"
    Then the booking is refused with "WRONG_OUTLET"
    And the refusal log names location 9 and service 21 and no email address

  Scenario: K-28 An optional service restriction still refuses other services
    Given the check is restricted to services 13 and 14
    And Calendesk has booking 505 at location 6 for service 8 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12
    When the guest confirms booking 505 with "guest@example.com"
    Then the booking is refused with "WRONG_SERVICE"

  # Brakes (adversarial dogfood 10-19, A1/A4/A2). In-process: each serverless instance keeps its own counts.

  # PR #10: the durable begin_check alone owns the cap, so a third check is refused at submit, before any FacePhys call.
  Scenario: K-29 One booking gets at most 2 charged checks a day: a retry after a poor reading, never a third
    # Main 10-23 (T1 #175 §11.3): refused at code entry by a read-only eligibility check, before consent and camera.
    Given the guest already completed 2 checks for booking 501 today
    When the guest enters the code for another check for booking 501
    Then the kiosk is refused with "BOOKING_ALREADY_CHECKED"
    And the kiosk shows the "code" screen
    And the camera was not opened again
    And no further presign, upload or process request reached FacePhys

  Scenario: K-30 An attempt matched before the cap was reached is refused at the point of charge
    Given the guest holds a matched attempt for booking 501 from earlier
    And the guest already completed 2 checks for booking 501 today
    When the held attempt is submitted
    Then the scan is refused with "BOOKING_ALREADY_CHECKED"
    And no further process request reached FacePhys

  Scenario: K-31 In open mode one booking's checks never use up another guest's
    Given production minimum: no enrolment code, cookie secret or CARE roster is configured
    And Calendesk names employee 12 as "Aisyah" with "aisyah@example.com"
    And this kiosk tablet is not enrolled
    And 30 other bookings each completed a check on this kiosk in the last hour
    When the guest confirms booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    And the guest starts the scan
    Then the kiosk shows the "result" screen

  Scenario: K-32 A client with 10 refused lookups in 10 minutes is slowed down before Calendesk is read
    Given the client "203.0.113.9" had 10 booking lookups refused in the last 10 minutes
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "TOO_MANY_LOOKUPS"
    And no further request reached Calendesk
    When the kiosk is reset for the next guest
    And the client is "198.51.100.4"
    And the guest confirms booking 501 with "guest@example.com"
    Then the kiosk shows the "consent" screen

  Scenario: K-33 At most 60 Calendesk booking reads a minute per instance, whoever asks
    Given 60 booking lookups from different clients reached Calendesk in the last minute
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk is refused with "TOO_MANY_LOOKUPS"
    And no further request reached Calendesk

  # Phone-first, inbox key (Keith 10-19: "Make it SIMPLE & SURPRISE ME", then "go"). The standee QR opens this check on
  # the guest's own phone. A 6-digit code emailed to the booking's inbox proves control of that inbox before consent.
  # It does not prove who the person is, and the consent screen says so.

  Scenario: K-34 On their own phone a guest needs only their email: a code goes to the booking's inbox, and entering it opens consent
    When the guest asks for a code with "guest@example.com"
    Then the kiosk shows the "code" screen
    And a 6-digit code was emailed to "guest@example.com" and to no one else
    And Calendesk's booking list was read with today's date filters only, as Foundry reads it in production
    When the guest enters the emailed code
    Then the kiosk shows the "consent" screen
    When the same code is entered again
    Then the reply is refused with "CODE_LOCKED"

  Scenario: K-35 Knowing the email is not enough: wrong codes never open consent, and the fifth locks the code
    When the guest asks for a code with "guest@example.com"
    And the guest enters a wrong code 5 times
    # PR #10 closes the guessing oracle: every wrong code gets one reply, so the lock is seen only on the right code.
    Then the kiosk is refused with "CODE_WRONG"
    When the guest enters the emailed code
    Then the kiosk is refused with "CODE_LOCKED"
    And the camera was never opened

  Scenario: K-36 An email with no KRPM booking today gets the same reply as one that has, and no code is sent
    When the guest asks for a code with "nobody@example.com"
    Then the kiosk shows the "code" screen
    And no code email was sent
    And the reply has the same shape as the reply for "guest@example.com"

  Scenario: K-37 A code expires after 10 minutes
    When the guest asks for a code with "guest@example.com"
    And 11 minutes pass
    And the guest enters the emailed code
    Then the kiosk is refused with "CODE_EXPIRED"

  Scenario: K-38 At most 3 codes per booking a day
    Given the guest asked for a code with "guest@example.com" 3 times
    When the guest asks for a code with "guest@example.com"
    Then no further code email was sent

  Scenario: K-39 A list without customer emails cannot authorize mail or unrelated detail reads
    Given Calendesk lists bookings without customer emails
    And Calendesk has booking 512 at location 7 for service 13 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12
    When the guest asks for a code with "guest@example.com"
    Then no code email was sent
    And no Calendesk booking was read in full
    And booking 512 at another outlet was never read in full

  Scenario: K-40 Matching by email counts only today's active KRPM bookings
    Given Calendesk has booking 510 at location 7 for service 13 on "2026-10-20" with status "approved" for "other@example.com" and employee 12
    And Calendesk has booking 511 at location 6 for service 13 on "2026-10-19" with status "approved" for "other@example.com" and employee 12
    When the guest asks for a code with "other@example.com"
    Then no code email was sent
    When the guest asks for a code with "guest@example.com"
    Then a 6-digit code was emailed to "guest@example.com" and to no one else

  Scenario: K-41 Leaving the page to read the code keeps the check; leaving with the camera on stops it
    When the guest asks for a code with "guest@example.com"
    And the phone hides the page
    Then the kiosk shows the "code" screen
    When the guest enters the emailed code
    And the guest agreed to processing and email delivery
    And the phone hides the page
    Then the camera is closed
    And the kiosk shows the "welcome" screen

  Scenario: K-42 The consent screen says the code proves the inbox, not the person
    When the guest asks for a code with "guest@example.com"
    And the guest enters the emailed code
    Then the consent text says the check is for the person who received the code

  # No-store cures (Main REFUTE + Astra AMEND/HOLD of 340d1bbb, T1 #164; booking 21 trace 10-19). Astra's RT01–RT06
  # run unchanged in tests/astra-rt*.test.mjs. The emailed code proves the inbox, not the person.

  Scenario: K-43 A booking whose list row carries no location is still found by reading it in full
    Given Calendesk lists bookings without their location
    When the guest asks for a code with "guest@example.com"
    Then a 6-digit code was emailed to "guest@example.com" and to no one else

  Scenario: K-44 A booking number sent with the lookup is ignored: only the typed email's own bookings count
    Given Calendesk has booking 502 at location 6 for service 13 on "2026-10-20" with status "approved" for "someone@example.com" and employee 12
    When a lookup names booking 502 with "guest@example.com"
    Then a 6-digit code was emailed to "guest@example.com" and to no one else
    And booking 502 at another outlet was never read in full

  Scenario: K-45 A lookup takes the same time whether or not the email has a booking today
    When the guest asks for a code with "guest@example.com"
    And the guest asks for a code with "nobody@example.com"
    Then both lookups were held to the same reply time

  Scenario: K-46 A code email the mail provider refuses still answers "code sent", like any other lookup
    Given the mail provider refuses messages
    When the guest asks for a code with "guest@example.com"
    Then the kiosk shows the "code" screen
    And the reply has the same shape as the reply for "nobody@example.com"

  Scenario: K-47 Lookups close together read today's Calendesk list once, and the list's shape is logged as field names only
    When the guest asks for a code with "nobody@example.com"
    And the guest asks for a code with "guest@example.com"
    Then Calendesk's booking list was read 1 time
    And the booking list shape was logged with field names and no values

  Scenario: K-48 A check that never reached FacePhys doesn't use up the booking's two checks
    Given the guest already completed 1 checks for booking 501 today
    And FacePhys presigns uploads to "uploads.evil.example"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    When the guest starts the scan
    Then the kiosk shows the "failed" screen
    When FacePhys presigns uploads to its own storage again
    And the guest completes another check for booking 501
    Then the kiosk shows the "result" screen
