---
name: verify
description: Drive the kiosk PWA end-to-end (consent gate, receipt block, success honesty states) against a local Foundry route or stub — build/launch/drive recipe for runtime verification of this repo.
---

# Verify — dr-magfield-kiosk

Plain Next.js 14 app, no test infra by design. Verification = run it and drive pixels.

## Launch

```bash
npm ci
# Point the register call at a local Foundry (its CORS allowlist includes localhost:3001)
NEXT_PUBLIC_LV_REGISTER_URL=http://localhost:3000/api/tenants/dr-magfield/rabbit-cup/register \
  npx next dev -p 3001
```

Gates: `npx tsc --noEmit` + `npx next build` (fonts load via `<link>`, no build-time fetch).

## Drive (Playwright)

Use the sibling Foundry checkout's `node_modules` (`NODE_PATH=<foundry>/frontend/node_modules`)
and the pre-installed browser: `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`
— never `playwright install`.

Flows worth driving on `/rabbit-cup`:
1. Identity → zone → confirm; **Pay must be disabled until the consent checkbox is checked**
   (force-click must not submit — the Consent Gate constructs the CTA).
2. Submit → register responds `{ provisional_id, checkout_url }`; `sessionStorage.drmf_rc_receipt`
   must hold the provisional id before any redirect.
3. `/rabbit-cup/success?id=cs_test_x` in the same context → Receipt Block (code +
   "cannot be quietly edited") + `Payment — settled` + slot `reserved · later` (italic, uncolored).
4. Fresh context, bare `/rabbit-cup/success` → honest UNMEASURED receipt fallback and payment
   rendered `settled · later` — never claim settled without the `?id` evidence ref.
5. Invalid `+60` phone keeps Continue disabled.

## Gotchas

- The register endpoint defaults to prod (`app.longevityvalley.ai`) when
  `NEXT_PUBLIC_LV_REGISTER_URL` is unset — never drive the flow against prod.
- Foundry-side DB can be faked at the network boundary (see the Foundry repo's
  `frontend/.claude/skills/verify/SKILL.md` fake-Supabase recipe) so the full
  browser → route → DB chain runs with zero prod writes.
