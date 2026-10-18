# Local runtime drive for `/scan`

This drive needs a real browser, which CI does not have. It runs headless Google Chrome with a fake camera (`--use-fake-device-for-media-stream`) against the production build, which talks to mock vendors on loopback. Nothing reaches FacePhys, Calendesk or Resend, so there is no charge and no email.

```
npm ci && npm run build
node scripts/wellness-drive/mock-vendors.mjs &
SCANS_ENABLED=1 FACEPHYS_BASE_URL=http://127.0.0.1:4810 FACEPHYS_KEY_ID=drive-kid FACEPHYS_SECRET_KEY=drive-fp-secret \
  CALENDESK_API_BASE=http://127.0.0.1:4810/api CALENDESK_API_KEY=drive-cd-key CALENDESK_TENANT=drive-tenant \
  RESEND_API_KEY=drive-rs-key EMAIL_API_BASE=http://127.0.0.1:4810 EMAIL_FROM='DR MAGfield <kiosk@drmagfield.test>' \
  KIOSK_ENROLL_CODE=drive-enroll-code-0001 KIOSK_COOKIE_SECRET=drive-cookie-secret-0123456789abcdef0123 SCAN_SECONDS=10 \
  CARE_ROSTER_JSON='[{"calendeskEmployeeId":12,"name":"Aisyah","email":"aisyah@example.com","outlets":["krpm"],"active":true}]' \
  npx next start -H 127.0.0.1 -p 3107 &
PLAYWRIGHT_FROM=/path/to/a/checkout/with/playwright-core/package.json node scripts/wellness-drive/drive.mjs
```

**The drive:**
1. Refuses an unenrolled tablet.
2. Enrols a tablet and checks the `__Host-` cookie flags and the `/scan` security headers.
3. Confirms booking 501 and walks consent, checking that sharing starts unticked.
4. Records a real Chrome mp4, then shows the result screen with the CC line.
5. Checks that the camera turns off and that Done resets the screen.

At the end it prints every call the mocks saw: booking reads, one presign, one PUT (with `%2F` normalised), one process (`confirmCharge`, `dmk-<uuid>`, SHA-256) and one email.

Set `CHROME_PATH` if Chrome is not at its default macOS path. The vendor secrets above are fakes used by the mock only.
