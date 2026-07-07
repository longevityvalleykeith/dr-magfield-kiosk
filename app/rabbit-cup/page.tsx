/**
 * DR MAGfield · Rabbit Cup — frictionless recovery registration
 *
 * 3-tap flow (variant B per design system DR-MAGfield-Rabbit-Cup.html):
 *   1. Identity (name + WhatsApp + email)
 *   2. Zone (where it hurts — body region picker, vertebra-free)
 *   3. Confirm + pay (RM325 5+1 on-demand pack, slot TBC) — the consent
 *      checkbox CONSTRUCTS the pay CTA (unconsented submission is
 *      unrepresentable), and the returned provisional_id is persisted to
 *      sessionStorage so /rabbit-cup/success renders the Receipt Block
 *      after the Stripe round-trip.
 *
 * Wired services:
 *   - POST /api/register  (proxied to LV main /api/tenants/dr-magfield/rabbit-cup/register)
 *     → writes agent_task_outcomes (R-23 Path B: status enum reuse + outcome_data JSONB)
 *     → creates Stripe Checkout Session (LV existing Stripe via product-checkout pattern)
 *     → emits Telegram alert to Arie's chat (1318296717) for 1h HITL slot confirmation
 *     → returns Stripe checkout URL
 *
 * Brand canon: design system v0.5.0 (paper cream, Cormorant Garamond + Manrope, gold accent).
 * NO Montserrat. NO dark backgrounds.
 */

'use client';

import { useState } from 'react';

// ─── BRAND CONSTANTS ───────────────────────────────────────────────────
const ARIE_WHATSAPP = '60126595319';
const PRICE_PACK_LABEL = 'RM325';
const PRICE_PACK_DESC = '5 + 1 on-demand sessions · Early Bird';

// LV registration endpoint (cross-origin from kiosk to LV main)
const REGISTER_ENDPOINT =
  process.env.NEXT_PUBLIC_LV_REGISTER_URL ??
  'https://app.longevityvalley.ai/api/tenants/dr-magfield/rabbit-cup/register';

// ─── ZONE TAXONOMY (vertebra-free, body region only) ──────────────────
const ZONES = [
  { id: 'neck-shoulder', label: 'Neck / Shoulder', seg: 'C-region', tag: 'Cervical' },
  { id: 'mid-back', label: 'Mid Back', seg: 'T-region', tag: 'Thoracic' },
  { id: 'low-back', label: 'Low Back', seg: 'L-region', tag: 'Lumbar' },
  { id: 'hip-glute', label: 'Hip / Glute', seg: 'L4-S1', tag: 'Lumbar+SI' },
  { id: 'knee-leg', label: 'Knee / Leg', seg: 'L3-L5', tag: 'Lower limb' },
  { id: 'whole-body', label: 'Whole body', seg: 'Full Qi Master cycle', tag: 'Recovery' },
] as const;

type ZoneId = (typeof ZONES)[number]['id'];

// ─── COMPONENT ─────────────────────────────────────────────────────────
export default function RabbitCupPage() {
  const [step, setStep] = useState<'identity' | 'zone' | 'confirm' | 'submitting' | 'success' | 'error'>('identity');
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Consent Gate: the checkbox CONSTRUCTS the pay CTA — unconsented submission
  // is unrepresentable (button disabled AND handleSubmit refuses).
  const [consented, setConsented] = useState(false);
  const [provisionalId, setProvisionalId] = useState<string | null>(null);

  const identityValid = name.trim().length > 1 && /^\+?60\d{8,}$/.test(whatsapp.replace(/[\s-]/g, '')) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const activeZone = zone ? ZONES.find((z) => z.id === zone) : null;

  async function handleSubmit() {
    if (!consented) return; // Consent Gate — unrepresentable without the checkbox
    setStep('submitting');
    setErrorMsg('');
    try {
      const res = await fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'rabbit-cup-2026',
          venue: 'venue:rahman-putra-golf-club',
          name: name.trim(),
          whatsapp: whatsapp.replace(/[\s-]/g, ''),
          email: email.trim().toLowerCase(),
          zone: zone,
          zone_label: activeZone?.label,
          zone_segment: activeZone?.seg,
          package: 'rm325-5plus1-on-demand',
          slot: 'tbc',
          consent_acknowledged: consented,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Registration failed (${res.status}): ${txt.slice(0, 200) || 'no detail'}`);
      }
      const data = (await res.json()) as { checkout_url?: string; provisional_id?: string };
      if (data.provisional_id) {
        setProvisionalId(data.provisional_id);
        // Receipt survives the Stripe round-trip so /rabbit-cup/success can
        // render the registration code (Receipt Block law).
        try {
          sessionStorage.setItem(
            'drmf_rc_receipt',
            JSON.stringify({
              provisional_id: data.provisional_id,
              name: name.trim(),
              zone_label: activeZone?.label ?? null,
              at: new Date().toISOString(),
            }),
          );
        } catch {
          /* storage unavailable — success page shows its honest UNMEASURED state */
        }
      }
      if (data.checkout_url) {
        // Stripe Checkout — full-page redirect
        window.location.assign(data.checkout_url);
        return;
      }
      // No checkout URL = registered but payment deferred. Show success anyway.
      setStep('success');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  const waConfirmLink = `https://wa.me/${ARIE_WHATSAPP}?text=${encodeURIComponent(
    `Hi Arie 👋 Just registered for Rabbit Cup recovery — ${name.trim()}, hurts at ${activeZone?.label || 'TBC'}, ${PRICE_PACK_LABEL} pack. Slot to be confirmed. Available windows?`,
  )}`;

  // ─── RENDER ──────────────────────────────────────────────────────────
  return (
    <main style={S.body}>
      <div style={S.frame}>
        {/* Header */}
        <header style={S.head}>
          <div style={S.eyebrow}>RABBIT CUP · 25–26 APR 2026</div>
          <h1 style={S.h1}>
            Recovery in <em style={S.italic}>three taps.</em>
          </h1>
          <p style={S.lead}>
            Pre- or post-round Qi Master at the Experience Lounge, KRPM. {PRICE_PACK_LABEL} {PRICE_PACK_DESC}.
          </p>
        </header>

        {/* Stepper */}
        <div style={S.stepRow}>
          <Pip on={['identity', 'zone', 'confirm', 'submitting', 'success'].indexOf(step) >= 0} label="1" />
          <Pip on={['zone', 'confirm', 'submitting', 'success'].indexOf(step) >= 0} label="2" />
          <Pip on={['confirm', 'submitting', 'success'].indexOf(step) >= 0} label="3" />
        </div>

        {/* STEP 1 — Identity */}
        {step === 'identity' && (
          <section style={S.card}>
            <h3 style={S.stepH}>Tell us who you are.</h3>
            <Field label="Full name" value={name} onChange={setName} autoComplete="name" placeholder="e.g. Lim Wei" />
            <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} autoComplete="tel" placeholder="+60 12 345 6789" type="tel" hint="Arie will confirm your slot here." />
            <Field label="Email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@golfer.my" type="email" hint="For Stripe receipt + magic link." />
            <button
              style={{ ...S.btn, ...(identityValid ? S.btnPrimary : S.btnDisabled) }}
              onClick={() => identityValid && setStep('zone')}
              disabled={!identityValid}
            >
              Continue →
            </button>
          </section>
        )}

        {/* STEP 2 — Zone */}
        {step === 'zone' && (
          <section style={S.card}>
            <h3 style={S.stepH}>Where did the round hurt?</h3>
            <p style={S.cardSub}>Tap the body region. We'll programme the Qi Master accordingly.</p>
            <div style={S.zoneGrid}>
              {ZONES.map((z) => (
                <button key={z.id} onClick={() => setZone(z.id)} style={{ ...S.zoneTile, ...(zone === z.id ? S.zoneTileOn : {}) }}>
                  <div style={S.zoneLabel}>{z.label}</div>
                  <div style={S.zoneSeg}>{z.seg}</div>
                </button>
              ))}
            </div>
            <div style={S.btnRow}>
              <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => setStep('identity')}>← Back</button>
              <button
                style={{ ...S.btn, ...(zone ? S.btnPrimary : S.btnDisabled) }}
                onClick={() => zone && setStep('confirm')}
                disabled={!zone}
              >
                Continue →
              </button>
            </div>
          </section>
        )}

        {/* STEP 3 — Confirm */}
        {step === 'confirm' && (
          <section style={S.card}>
            <h3 style={S.stepH}>Confirm your trial.</h3>
            <div style={S.summary}>
              <SummaryRow label="Name" value={name.trim()} />
              <SummaryRow label="WhatsApp" value={whatsapp} />
              <SummaryRow label="Email" value={email.trim().toLowerCase()} />
              <SummaryRow label="Recovery zone" value={activeZone?.label ?? '—'} />
              <SummaryRow label="Package" value={`${PRICE_PACK_LABEL} · 5 + 1 on-demand`} />
              <SummaryRow label="Slot" value="reserved · later — Arie confirms within 1 hour" pending />
            </div>
            {/* Consent Gate — the checkbox constructs the CTA */}
            <label style={S.consentRow}>
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                style={S.consentBox}
              />
              <span style={S.consentText}>
                I authorise a one-time {PRICE_PACK_LABEL} charge via Stripe and agree DR MAGfield may
                hold my contact details to arrange sessions at the KRPM Experience Lounge.
                Sports-recovery service, not medical. Cancellable per terms.
              </span>
            </label>
            <div style={S.btnRow}>
              <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => setStep('zone')}>← Back</button>
              <button
                style={{ ...S.btn, ...(consented ? S.btnPrimary : S.btnDisabled) }}
                onClick={handleSubmit}
                disabled={!consented}
              >
                Pay {PRICE_PACK_LABEL} →
              </button>
            </div>
          </section>
        )}

        {/* STEP 4 — Submitting */}
        {step === 'submitting' && (
          <section style={S.card}>
            <h3 style={S.stepH}>Securing your spot…</h3>
            <p style={S.cardSub}>Redirecting to Stripe.</p>
          </section>
        )}

        {/* STEP 5 — Success (only reached if no checkout URL — fallback path) */}
        {step === 'success' && (
          <section style={S.card}>
            <h3 style={S.stepH}>See you at the lounge, {name.split(' ')[0] || 'champion'}.</h3>
            <p style={S.cardSub}>
              Registration recorded. Payment is <em style={S.pendingWord}>settled · later</em> — Arie will
              confirm your slot within 1 hour via WhatsApp.
            </p>
            {provisionalId && (
              <div style={S.receiptBlock}>
                <div style={S.receiptLabel}>Registration receipt</div>
                <div style={S.receiptCode}>{provisionalId}</div>
                <p style={S.receiptNote}>
                  This record cannot be quietly edited. Quote this code to Arie — or to any
                  assistant — and the engine will confirm it happened.
                </p>
              </div>
            )}
            <a href={waConfirmLink} style={{ ...S.btn, ...S.btnWa }} target="_blank" rel="noreferrer">Message Arie on WhatsApp →</a>
          </section>
        )}

        {/* STEP 5b — Error */}
        {step === 'error' && (
          <section style={S.card}>
            <h3 style={{ ...S.stepH, color: '#C24E3B' }}>Couldn't register.</h3>
            <p style={S.cardSub}>{errorMsg}</p>
            <p style={S.fineprint}>Please WhatsApp Arie directly to confirm your spot.</p>
            <a href={waConfirmLink} style={{ ...S.btn, ...S.btnWa }} target="_blank" rel="noreferrer">Message Arie on WhatsApp →</a>
            <button style={{ ...S.btn, ...S.btnGhost, marginTop: 8 }} onClick={() => setStep('confirm')}>← Try again</button>
          </section>
        )}

        {/* Footer */}
        <footer style={S.foot}>
          <div>Experience Lounge · KRPM Golf Club · Practitioner: Arie Ong</div>
          <div style={S.footQuiet}>Turn Pain into Pure Performance.</div>
        </footer>
      </div>
    </main>
  );
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text', hint, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; autoComplete?: string;
}) {
  return (
    <div style={S.fld}>
      <label style={S.fldLabel}>{label}</label>
      <input
        style={S.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
      />
      {hint && <span style={S.fldHint}>{hint}</span>}
    </div>
  );
}

function Pip({ on, label }: { on: boolean; label: string }) {
  return <div style={{ ...S.pip, ...(on ? S.pipOn : {}) }}>{label}</div>;
}

function SummaryRow({ label, value, pending }: { label: string; value: string; pending?: boolean }) {
  // Color law: pending renders italic and UNCOLORED — never the verified tone.
  return (
    <div style={S.sumRow}>
      <span style={S.sumLabel}>{label}</span>
      <span style={{ ...S.sumValue, ...(pending ? S.sumValuePending : {}) }}>{value}</span>
    </div>
  );
}

// ─── STYLES (design system v0.5.0 tokens, light-only) ─────────────────
const PAPER = '#F9F7F2';
const PAPER_SOFT = '#F5F0E8';
const PAPER_DEEP = '#EDE6D8';
const INK_700 = '#2D3748';
const INK_500 = '#4A5568';
const INK_400 = '#718096';
const INK_100 = '#E2E8F0';
const GOLD = '#C9A96E';
const GOLD_DEEP = '#A8864C';
const GOLD_SOFT = '#E6D4A8';
const GOLD_WASH = '#F5ECD4';
const WA = '#25D366';
const WA_DEEP = '#1DA851';

const F_DISPLAY = "'Cormorant Garamond', 'Times New Roman', serif";
const F_SANS = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif";

const S: Record<string, React.CSSProperties> = {
  body: { background: PAPER_SOFT, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', fontFamily: F_SANS, color: INK_700 },
  frame: { width: '100%', maxWidth: 460, background: PAPER, borderRadius: 24, boxShadow: '0 20px 48px rgba(31,39,51,.12),0 4px 12px rgba(31,39,51,.06)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  head: { padding: '28px 24px 16px' },
  eyebrow: { fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD_DEEP, marginBottom: 8 },
  h1: { fontFamily: F_DISPLAY, fontSize: 34, fontWeight: 600, letterSpacing: '-0.01em', color: INK_700, margin: '0 0 10px', lineHeight: 1.08 },
  italic: { fontStyle: 'italic', color: GOLD_DEEP, fontWeight: 500 },
  lead: { fontSize: 14, lineHeight: 1.55, color: INK_500, margin: 0 },
  stepRow: { display: 'flex', gap: 8, padding: '4px 24px 16px' },
  pip: { width: 28, height: 28, borderRadius: 999, background: PAPER_DEEP, color: INK_400, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  pipOn: { background: GOLD, color: '#fff' },
  card: { padding: '20px 24px 24px', borderTop: `1px solid ${PAPER_DEEP}` },
  stepH: { fontFamily: F_DISPLAY, fontSize: 22, fontWeight: 600, color: INK_700, margin: '0 0 14px' },
  cardSub: { fontSize: 13, color: INK_500, margin: '0 0 14px' },
  fld: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  fldLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD_DEEP },
  input: { padding: '13px 14px', fontSize: 15, fontWeight: 500, color: INK_700, background: '#fff', border: `1.5px solid ${INK_100}`, borderRadius: 10, outline: 'none', fontFamily: F_SANS },
  fldHint: { fontSize: 11, color: INK_400 },
  btn: { padding: '14px 18px', fontSize: 15, fontWeight: 700, borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: F_SANS, width: '100%', textAlign: 'center' as const, textDecoration: 'none', display: 'inline-block' },
  btnPrimary: { background: GOLD, color: '#fff', boxShadow: '0 12px 32px rgba(201,169,110,.28)' },
  btnDisabled: { background: PAPER_DEEP, color: INK_400, cursor: 'not-allowed' as const },
  btnGhost: { background: 'transparent', color: INK_500, border: `1.5px solid ${INK_100}` },
  btnWa: { background: WA, color: '#fff', marginTop: 12 },
  btnRow: { display: 'flex', gap: 8, marginTop: 16 },
  zoneGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, margin: '8px 0 4px' },
  zoneTile: { padding: '14px 12px', background: PAPER_SOFT, border: `1.5px solid ${PAPER_DEEP}`, borderRadius: 10, cursor: 'pointer', textAlign: 'left' as const, fontFamily: F_SANS },
  zoneTileOn: { background: GOLD_WASH, borderColor: GOLD, boxShadow: '0 2px 6px rgba(31,39,51,.06)' },
  zoneLabel: { fontSize: 13, fontWeight: 600, color: INK_700, marginBottom: 3 },
  zoneSeg: { fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: GOLD_DEEP },
  summary: { background: PAPER_SOFT, border: `1px solid ${PAPER_DEEP}`, borderRadius: 12, padding: 16, marginBottom: 14 },
  sumRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px dashed ${PAPER_DEEP}`, gap: 12 },
  sumLabel: { fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD_DEEP },
  sumValue: { fontSize: 13, color: INK_700, textAlign: 'right' as const, maxWidth: '60%' },
  sumValuePending: { fontStyle: 'italic' as const, color: INK_500, fontWeight: 400 },
  pendingWord: { fontStyle: 'italic' as const, color: INK_500, fontWeight: 500 },
  fineprint: { fontSize: 11, lineHeight: 1.5, color: INK_400, margin: '0 0 16px' },
  consentRow: { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '0 0 16px', cursor: 'pointer' },
  consentBox: { width: 18, height: 18, marginTop: 2, accentColor: GOLD, flexShrink: 0, cursor: 'pointer' },
  consentText: { fontSize: 11, lineHeight: 1.5, color: INK_500 },
  receiptBlock: { background: PAPER_SOFT, border: `1.5px solid ${GOLD_SOFT}`, borderRadius: 12, padding: 16, margin: '0 0 14px' },
  receiptLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' as const, color: GOLD_DEEP, marginBottom: 6 },
  receiptCode: { fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", fontSize: 14, fontWeight: 600, color: INK_700, wordBreak: 'break-all' as const, marginBottom: 8 },
  receiptNote: { fontSize: 11, lineHeight: 1.5, color: INK_400, margin: 0 },
  foot: { padding: '20px 24px', borderTop: `1px solid ${PAPER_DEEP}`, fontSize: 11, color: INK_400, textAlign: 'center' as const },
  footQuiet: { fontFamily: F_DISPLAY, fontStyle: 'italic', color: GOLD_DEEP, marginTop: 4 },
};
