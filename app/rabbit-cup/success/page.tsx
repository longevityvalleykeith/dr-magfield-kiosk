/**
 * DR MAGfield · Rabbit Cup — post-Stripe success.
 * Stripe Checkout redirects here with ?id={CHECKOUT_SESSION_ID}.
 * Per ADR-005 R-22 / NQ-3: provisional booking confirmed; Arie has 1h to confirm slot.
 */

'use client';

const ARIE_WHATSAPP = '60126595319';

const PAPER = '#F9F7F2';
const PAPER_SOFT = '#F5F0E8';
const PAPER_DEEP = '#EDE6D8';
const INK_700 = '#2D3748';
const INK_500 = '#4A5568';
const INK_400 = '#718096';
const GOLD = '#C9A96E';
const GOLD_DEEP = '#A8864C';
const SAGE = '#7A9A7E';
const WA = '#25D366';

const F_DISPLAY = "'Cormorant Garamond', 'Times New Roman', serif";
const F_SANS = "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif";

export default function RabbitCupSuccess() {
  const waMsg = encodeURIComponent('Hi Arie 👋 Just paid the Rabbit Cup pack. Looking for slot confirmation. Thanks!');
  const waUrl = `https://wa.me/${ARIE_WHATSAPP}?text=${waMsg}`;

  return (
    <main style={{ background: PAPER_SOFT, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', fontFamily: F_SANS, color: INK_700 }}>
      <div style={{ width: '100%', maxWidth: 460, background: PAPER, borderRadius: 24, boxShadow: '0 20px 48px rgba(31,39,51,.12),0 4px 12px rgba(31,39,51,.06)', overflow: 'hidden' }}>
        <header style={{ padding: '28px 24px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD_DEEP, marginBottom: 8 }}>RABBIT CUP · PROVISIONAL</div>
          <h1 style={{ fontFamily: F_DISPLAY, fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', color: INK_700, margin: '0 0 10px', lineHeight: 1.1 }}>
            See you at the <em style={{ fontStyle: 'italic', color: GOLD_DEEP, fontWeight: 500 }}>lounge.</em>
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: INK_500, margin: 0 }}>
            Payment received. Your spot is reserved.
          </p>
        </header>

        <section style={{ padding: '20px 24px 24px', borderTop: `1px solid ${PAPER_DEEP}` }}>
          <div style={{ background: PAPER_SOFT, border: `1px solid ${PAPER_DEEP}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: SAGE, display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: INK_500 }}>Stripe receipt sent to your email</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: GOLD, display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: INK_500 }}>Arie will confirm your slot within 1 hour</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: INK_500, margin: '0 0 16px' }}>
            Your <strong>RM325 · 5 + 1 on-demand</strong> pack is active. Sessions are bookable at the Experience Lounge whenever you arrive — pre-round, post-round, or off-day. Arie will message you on WhatsApp shortly to confirm your first slot.
          </p>

          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', padding: '14px 18px', fontSize: 15, fontWeight: 700, background: WA, color: '#fff', textAlign: 'center', textDecoration: 'none', borderRadius: 999 }}
          >
            Message Arie now →
          </a>

          <p style={{ fontSize: 11, lineHeight: 1.5, color: INK_400, margin: '14px 0 0', textAlign: 'center' }}>
            Need to change anything? Just WhatsApp us — no portal, no forms.
          </p>
        </section>

        <footer style={{ padding: '20px 24px', borderTop: `1px solid ${PAPER_DEEP}`, fontSize: 11, color: INK_400, textAlign: 'center' }}>
          <div>Experience Lounge · KRPM Golf Club · Practitioner: Arie Ong</div>
          <div style={{ fontFamily: F_DISPLAY, fontStyle: 'italic', color: GOLD_DEEP, marginTop: 4 }}>Turn Pain into Pure Performance.</div>
        </footer>
      </div>
    </main>
  );
}
