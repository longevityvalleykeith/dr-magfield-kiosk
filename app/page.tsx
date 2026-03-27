/**
 * DR MAGfield Kiosk — Living Agent 0 Web MCP Widget
 *
 * Architecture:
 * - Fullscreen LED display at KRPM Experience Lounge
 * - Connects to DR MAGfield Agent 0 via MCP over Tailscale
 * - Displays Agent 0 generated banners (bilingual animated HTML)
 * - Touch-interactive for walk-in customers
 * - QR → Telegram onboarding for layman users
 *
 * Connection: Tailscale → Mac Mini NanoClaw MCP proxy
 * Fallback: Mothership MCP (requires internet)
 */

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── TYPES ──────────────────────────────────────────────────────────────
type Message = { role: 'agent' | 'user'; text: string; time: string }
type ConnectionStatus = 'online' | 'offline' | 'connecting'

// ─── MCP CONFIG ────────────────────────────────────────────────────────
// Mac Mini NanoClaw MCP proxy — serves Agent 0 over Tailscale
// Set VERCEL_URL or use Tailscale IP:PORT for local
const MCP_ENDPOINT = process.env.NEXT_PUBLIC_MCP_ENDPOINT ?? 'http://localhost:3100'

// ─── BRAND CONSTANTS ───────────────────────────────────────────────────
const AGENT_NAME = 'DR MAGfield AI'
const AGENT_TITLE = 'Your Recovery Guide'
const ARIE_WHATSAPP = '60123770011'
const TELEGRAM_BOT = '@DrMAGfield_Bot'

// ─── STATIC PRODUCT DATA (seeded from Brand DNA) ─────────────────────
const PRODUCTS = [
  {
    id: 'qi-master',
    name: 'Qi Master',
    nameZh: '气血大师',
    tagline: 'Full-body rotational magnetic therapy bed',
    tag: 'Flagship',
    icon: '🛏️',
    stats: [
      { val: '45min', lbl: 'Per Session' },
      { val: '3-in-1', lbl: 'Heat+Mag+Vib' },
      { val: '2-3x', lbl: 'Weekly' },
    ],
    desc: 'The flagship DR MAGfield experience. Lie down fully clothed — the rotating magnetic field, therapeutic heat, and acoustic vibration work together to address back pain, improve circulation, and accelerate post-round recovery.',
  },
  {
    id: 'qi-mini',
    name: 'Qi Mini',
    nameZh: '气血mini',
    tagline: 'Portable pelvic floor & core wellness device',
    tag: 'Portable',
    icon: '⚡',
    stats: [
      { val: '15min', lbl: 'Daily' },
      { val: 'Portable', lbl: 'Take Anywhere' },
      { val: 'Core', lbl: 'Foundation' },
    ],
    desc: 'Targeted pelvic floor and core wellness technology. The circulating energy waves strengthen your body\'s foundation — ideal for golfers who sit long hours between rounds.',
  },
  {
    id: 'liver-detox',
    name: 'Liver Detox',
    nameZh: '清肝胆排毒',
    tagline: '18-hour guided liver & gallbladder cleanse',
    tag: 'Programme',
    icon: '🌿',
    stats: [
      { val: '18hrs', lbl: 'Programme' },
      { val: '5', lbl: 'Benefits' },
      { val: 'RM50', lbl: 'Members' },
    ],
    desc: 'European-formulated liver and gallbladder detoxification programme. DR MAGfield\'s guided 2-day protocol helps flush accumulated toxins, restore liver function, and improve energy and mental clarity.',
  },
]

// ─── INITIAL CONVERSATION (onboarding script) ──────────────────────────
const ONBOARDING: Message[] = [
  { role: 'agent', text: '👋 Welcome to DR MAGfield — Malaysia\'s First Golf Club Bio-Energetic Therapy Lounge.', time: '' },
  { role: 'agent', text: 'I\'m your AI recovery guide. Tell me — what brings you in today?', time: '' },
  { role: 'agent', text: '🏌️ Back pain from golf? 🦵 Hip tightness? 😴 Recovery from a tournament? Let me help you find the right therapy.', time: '' },
]

// ─── MOCK AGENT RESPONSES (when MCP offline) ─────────────────────────
const MOCK_RESPONSES: Record<string, string> = {
  default: 'Our Qi Master therapy bed is perfect for golfers — 30 minutes on the bed and most clients feel measurable relief in back and shoulder tension. Would you like me to check availability with Arie?',
  price: 'Sessions start from RM 50 for members of KRPM. Your first session includes a complimentary consultation. Would you like to book with Arie via WhatsApp?',
  location: 'We\'re at the KRPM Experience Lounge, Kelab Rahman Putra Malaysia, Sungai Buloh. Members and guests are welcome by appointment.',
  booking: 'Great! Arie Ong is our Experience Coordinator. You can WhatsApp him directly at +6012-377 0011 — he\'ll set up your first session.',
  golf: 'Golfers love the Qi Master! The rotating magnetic field addresses exactly what repetitive swings do to your back and shoulders. Most KRPM members come 2-3 times per week.',
  time: 'Sessions are 30-45 minutes. Many golfers do a pre-round session (20 min) 1-2 hours before teeing off, and a longer recovery session after the round.',
}

// ─── HELPERS ──────────────────────────────────────────────────────────
function getMockResponse(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('price') || t.includes('cost') || t.includes('rm') || t.includes('fee')) return MOCK_RESPONSES.price
  if (t.includes('where') || t.includes('location') || t.includes('address') || t.includes('find')) return MOCK_RESPONSES.location
  if (t.includes('book') || t.includes('appointment') || t.includes('schedule')) return MOCK_RESPONSES.booking
  if (t.includes('golf') || t.includes('swing') || t.includes('back') || t.includes('shoulder')) return MOCK_RESPONSES.golf
  if (t.includes('how long') || t.includes('time') || t.includes('session')) return MOCK_RESPONSES.time
  return MOCK_RESPONSES.default
}

function formatTime(): string {
  const now = new Date()
  return now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────
export default function KioskPage() {
  const [messages, setMessages] = useState<Message[]>(ONBOARDING)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [activeBanner, setActiveBanner] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const [bannerHtml, setBannerHtml] = useState<string | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Auto-scroll conversation ─────────────────────────────────────
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }, [messages, isTyping])

  // ── Auto-rotate banners every 8 seconds ────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveBanner(prev => (prev + 1) % PRODUCTS.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  // ── Fetch generated banner from Agent 0 (via local MCP proxy) ─────
  const fetchBanner = useCallback(async (productId: string) => {
    try {
      const res = await fetch(`${MCP_ENDPOINT}/api/banner/${productId}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const html = await res.text()
        setBannerHtml(html)
      }
    } catch {
      // Fallback: show product card instead
      setBannerHtml(null)
    }
  }, [])

  // ── Send message ─────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return

    const userMsg: Message = { role: 'user', text, time: formatTime() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    // Simulate Agent 0 thinking (when MCP offline, use mock)
    setTimeout(() => {
      setIsTyping(false)
      const response = getMockResponse(text)
      const agentMsg: Message = { role: 'agent', text: response, time: formatTime() }
      setMessages(prev => [...prev, agentMsg])
    }, 1200 + Math.random() * 800)
  }, [input])

  // ── Quick action shortcuts ─────────────────────────────────────────
  const quickActions = [
    { label: 'What is 旋磁疗法?', action: 'What is rotational magnetic therapy?' },
    { label: 'Book a Session', action: 'I want to book a session' },
    { label: 'Golf Recovery', action: 'I have back pain from golf' },
    { label: 'Pricing', action: 'How much does it cost?' },
  ]

  return (
    <div className="kiosk">
      {/* ── TOP BAR ──────────────────────────────────────────────── */}
      <div className="topbar">
        <div className="topbar-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A96E"/>
            <text x="20" y="27" textAnchor="middle" fontSize="20" fontWeight="bold" fill="#1A1A1A">M</text>
          </svg>
          DR MAGfield Experience Lounge
        </div>
        <div className="topbar-status">
          <div className={`status-dot ${status === 'offline' ? 'offline' : ''}`} />
          <span>
            {status === 'online' ? 'Agent 0 Connected' : status === 'connecting' ? 'Connecting...' : 'Demo Mode'}
          </span>
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────── */}
      <div className="content">

        {/* ── AGENT PANEL (LEFT) ──────────────────────────────── */}
        <div className="agent-panel">
          <div className="agent-header">
            <div className="agent-avatar">AI</div>
            <div className="agent-name">{AGENT_NAME}</div>
            <div className="agent-title">{AGENT_TITLE} — Kelab Rahman Putra Malaysia</div>
          </div>

          {/* Conversation */}
          <div className="conversation" ref={conversationRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`msg ${msg.role}`}>
                {msg.text}
                {msg.time && <div className="msg-time">{msg.time}</div>}
              </div>
            ))}
            {isTyping && (
              <div className="typing">
                <span /><span /><span />
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="quick-actions">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                className="quick-btn"
                onClick={() => setInput(qa.action)}
              >
                {qa.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="agent-input-area">
            <div className="input-hint">Tap to chat with Agent 0 — or tap quick actions above</div>
            <div className="input-row">
              <input
                ref={inputRef}
                className="kiosk-input"
                placeholder="Ask about therapy, booking, pricing..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
              />
              <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
                &#10148;
              </button>
            </div>
          </div>
        </div>

        {/* ── PRODUCT / BANNER PANEL (RIGHT) ────────────────────── */}
        <div className="product-panel">
          <div className="product-header">
            <h2>DR MAGfield Services</h2>
            <p>Tap a service to learn more — Agent 0 will guide you</p>
          </div>

          <div className="product-carousel">
            {PRODUCTS.map(product => (
              <div
                key={product.id}
                className={`product-card ${selectedProduct === product.id ? 'selected' : ''}`}
                onClick={() => setSelectedProduct(selectedProduct === product.id ? null : product.id)}
              >
                <div className="product-img">{product.icon}</div>
                <div className="product-body">
                  <span className="product-tag">{product.tag}</span>
                  <div className="product-name">{product.name} <span style={{ color: 'var(--gold)', fontSize: 13 }}>{product.nameZh}</span></div>
                  <div className="product-desc">{product.tagline}</div>
                  <div className="product-stats">
                    {product.stats.map(s => (
                      <div key={s.lbl} className="product-stat">
                        <span className="val">{s.val}</span>
                        <span className="lbl">{s.lbl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {/* ── BANNER DISPLAY ─────────────────────────── */}
            {selectedProduct && (
              <div className="product-card selected" style={{ cursor: 'default' }}>
                <div className="product-img" style={{ height: 120, fontSize: 32 }}>
                  {PRODUCTS.find(p => p.id === selectedProduct)?.icon}
                </div>
                <div className="product-body">
                  <div className="product-name" style={{ fontSize: 15 }}>
                    {PRODUCTS.find(p => p.id === selectedProduct)?.name}
                  </div>
                  <div className="product-desc" style={{ fontSize: 12 }}>
                    {PRODUCTS.find(p => p.id === selectedProduct)?.desc}
                  </div>
                  <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <a
                      href={`https://wa.me/${ARIE_WHATSAPP}?text=Hi Arie, I am interested in ${PRODUCTS.find(p => p.id === selectedProduct)?.name} at DR MAGfield KRPM`}
                      target="_blank"
                      rel="noopener"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: '#25D366', color: 'white', padding: '10px 16px',
                        borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                      }}
                    >
                      &#128172; WhatsApp Arie
                    </a>
                    <a
                      href="https://t.me/DrMAGfield_Bot"
                      target="_blank"
                      rel="noopener"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'rgba(201,169,110,0.15)', color: 'var(--gold)', padding: '10px 16px',
                        borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none',
                        border: '1px solid rgba(201,169,110,0.3)',
                      }}
                    >
                      &#128722; Chat with AI Agent
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM BAR ──────────────────────────────────────────── */}
      <div className="bottombar">
        <div className="bottombar-item">
          <div className="icon">&#128205;</div>
          <div>Location</div>
          <div className="val">KRPM</div>
        </div>
        <div className="bottombar-item">
          <div className="icon">&#128172;</div>
          <div>WhatsApp</div>
          <div className="val">+6012-377 0011</div>
        </div>
        <div className="bottombar-item">
          <div className="icon">&#128722;</div>
          <div>Telegram</div>
          <div className="val">@DrMAGfield_Bot</div>
        </div>
        <div className="bottombar-item">
          <div className="icon">&#128339;</div>
          <div>Hours</div>
          <div className="val">By Appt</div>
        </div>
      </div>

      {/* ── PRODUCT MODAL (fullscreen on tap) ───────────────── */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              {PRODUCTS.find(p => p.id === selectedProduct)?.icon}
            </div>
            <div className="modal-product-name">
              {PRODUCTS.find(p => p.id === selectedProduct)?.name}
              {' '}
              <span style={{ color: 'var(--gold)' }}>
                {PRODUCTS.find(p => p.id === selectedProduct)?.nameZh}
              </span>
            </div>
            <div className="modal-product-desc">
              {PRODUCTS.find(p => p.id === selectedProduct)?.desc}
            </div>
            <div className="modal-specs">
              {PRODUCTS.find(p => p.id === selectedProduct)?.stats.map(s => (
                <div key={s.lbl} className="modal-spec">
                  <div className="val">{s.val}</div>
                  <div className="lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a
                href={`https://wa.me/${ARIE_WHATSAPP}?text=Hi Arie, I am interested in ${PRODUCTS.find(p => p.id === selectedProduct)?.name} at DR MAGfield KRPM`}
                target="_blank"
                rel="noopener"
                className="modal-cta"
              >
                &#128172; Book with Arie Ong &#8594;
              </a>
              <a
                href="https://t.me/DrMAGfield_Bot"
                target="_blank"
                rel="noopener"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '16px 24px', borderRadius: 12,
                  background: 'rgba(201,169,110,0.1)', color: 'var(--gold)',
                  border: '1px solid rgba(201,169,110,0.3)',
                  fontWeight: 700, fontSize: 15, textDecoration: 'none',
                }}
              >
                &#128722; Chat with AI Agent
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
