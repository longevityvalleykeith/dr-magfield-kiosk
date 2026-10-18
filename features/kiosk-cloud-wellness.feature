@cloud_v3 @fake_provider @fake_mail
Feature: DR MAGfield KRPM kiosk: an optional, booking-matched Cloud wellness check
  The guest's booking is matched before the camera opens. FacePhys v3 processes a
  short face video and the results go to the guest by email, with an optional CC
  to the booking's CARE employee, and on screen until reset. LV keeps only a
  minimal consent record: never video, readings or email addresses.

  Trace: T1 #164 (CLOUD-01..18, O2O-01..12). Keith's 10-19 choices are the
  kiosk reading Calendesk, the minimal consent record, one email with CC, and
  guests only after his own-face test plus Main's and Astra's grades.

  Background:
    Given the wellness check is enabled for outlet "krpm" at Calendesk location 6
    And this kiosk tablet is enrolled
    And today in Kuala Lumpur is "2026-10-20"
    And Calendesk has booking 501 at location 6 for service 13 on "2026-10-20" with status "approved" for "guest@example.com" and employee 12
    And the CARE roster lists employee 12 "Aisyah" with "aisyah@example.com" as active at "krpm"

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
      | 6        | 13      | 2026-10-19 | approved  | guest@example.com   | NOT_TODAY          |
      | 6        | 13      | 2026-10-20 | cancelled | guest@example.com   | BOOKING_NOT_ACTIVE |
      | 6        | 14      | 2026-10-20 | approved  | someone@example.com | EMAIL_MISMATCH     |

  Scenario: K-04 An unknown booking number is refused the same way as a mismatch
    When the guest confirms booking 999 with "guest@example.com"
    Then the booking is refused with "BOOKING_NOT_FOUND"
    And the kiosk shows the same message as for a mismatched booking

  Scenario: K-05 One email to the guest with a CC to the booking's CARE employee (O2O-04, O2O-05)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the consent screen shows the exact To address "guest@example.com" and CC address "aisyah@example.com"
    And the guest agreed to processing and email delivery
    And the guest ticked CC to "Aisyah"
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then FacePhys received exactly 1 presign, 1 upload and 1 process request
    And every outbound request refused redirects
    And the process request carried confirmCharge true, the attempt's idempotency key and the video's SHA-256
    And exactly 1 email was sent to "guest@example.com" with CC "aisyah@example.com"
    And the email says "wellness indicator, not a medical measurement"
    And the kiosk shows the "result" screen with heart rate 72 bpm and the email as sent
    And the consent record holds only the admitted fields, with Calendesk location 6, CARE employee 12, the CC agreed and no email address or reading

  Scenario: K-06 Sharing starts unticked, so without the guest's tick there is no CC (O2O-05)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 70, RMSSD 40, SDNN 50 and breathing rate 15 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the consent record keeps CARE employee 12 with the CC "declined"

  Scenario: K-07 An inactive CARE employee is never CC'd, never replaced, and never blocks the guest's check (O2O-04)
    Given the CARE roster lists employee 12 "Aisyah" with "aisyah@example.com" as inactive at "krpm"
    And the CARE roster lists employee 13 "Ben" with "ben@example.com" as active at "krpm"
    And FacePhys will return heart rate 70, RMSSD 40, SDNN 50 and breathing rate 15 with signal quality 0.9
    When the guest confirms booking 501 with "guest@example.com"
    Then no CARE recipient is offered
    When the guest forces a CC on the scan request
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the scan reply reports the CC as "unavailable"

  Scenario: K-17 A CARE employee who leaves the roster after the match is dropped from the CC, and the check still runs (O2O-04, O2O-05)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And the guest ticked CC to "Aisyah"
    And the CARE roster lists employee 12 "Aisyah" with "aisyah@example.com" as inactive at "krpm"
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the scan reply reports the CC as "unavailable"
    And the kiosk shows the "result" screen

  Scenario: K-08 A double tap never creates a second charge (O2O-06)
    Given same-key retry is switched on
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan twice for the same attempt
    Then every process request carried the same idempotency key and the same video SHA-256

  Scenario: K-09 A lost FacePhys response stays unknown, and a retry reuses the same key (O2O-07)
    Given same-key retry is switched on
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys accepts the process request but its response is lost
    When the guest starts the scan
    Then the kiosk shows the "unknown" screen
    And no email was sent
    When FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    And the guest retries the same attempt
    Then every process request carried the same idempotency key and the same video SHA-256
    And exactly 1 email was sent to "guest@example.com" with no CC

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
    And the guest ticked CC to "Aisyah"
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

  Scenario: K-19 With no static pin, the free preflight names the upload host and the dynamic rule that admits it (CLOUD-04)
    Given no upload host is pinned
    When staff run the free FacePhys preflight on this tablet
    Then the preflight names the upload host "facephys-kiosk.oss-ap-southeast-1.aliyuncs.com" as allowed by the "dynamic" rule
    And no video was uploaded and no process request was sent
    When the guest confirms booking 501 with "guest@example.com"
    Then the kiosk shows the "consent" screen

  Scenario: K-20 Consent records can also go to an LV mailbox, carrying no address or reading
    Given consent records are also mailed to "records@lv.test"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 consent-record email went to "records@lv.test" with no other email address or reading in it

  Scenario: K-21 A slow scan never overruns the function: the optional record email is skipped near the deadline
    Given consent records are also mailed to "records@lv.test"
    And the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And FacePhys takes 52 seconds and then returns heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And no consent-record email went to "records@lv.test"
    And the consent record line is still written

  Scenario: K-22 A CARE address that changes after the match drops the CC instead of following it (O2O-05)
    Given the guest confirmed booking 501 with "guest@example.com"
    And the guest agreed to processing and email delivery
    And the guest ticked CC to "Aisyah"
    And the CARE roster lists employee 12 "Aisyah" with "aisyah.new@example.com" as active at "krpm"
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with no CC
    And the scan reply reports the CC as "unavailable"

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
    Then the scan is refused with "ATTEMPT_ALREADY_SUBMITTED"
    And FacePhys received exactly 1 presign, 1 upload and 1 process request

  Scenario: K-24 Production simplicity: no enrolment, roster, cookie secret or host pin, and the CC comes from Calendesk
    Given production simplicity: no enrolment code, cookie secret, CARE roster or upload pin is configured
    And Calendesk names employee 12 as "Aisyah" with "aisyah@example.com"
    And this kiosk tablet is not enrolled
    When the guest confirms booking 501 with "guest@example.com"
    Then the consent screen shows the exact To address "guest@example.com" and CC address "aisyah@example.com"
    Given the guest agreed to processing and email delivery
    And the guest ticked CC to "Aisyah"
    And FacePhys will return heart rate 72, RMSSD 41, SDNN 55 and breathing rate 14 with signal quality 0.9
    When the guest starts the scan
    Then exactly 1 email was sent to "guest@example.com" with CC "aisyah@example.com"
    And every outbound request refused redirects

  Scenario: K-25 The dynamic rule refuses an upload host outside FacePhys and the known storage providers (CLOUD-04)
    Given no upload host is pinned
    And FacePhys presigns uploads to "uploads.evil.example"
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
