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
import {
  MapPin, MessageCircle, Send, Clock,
  Heart, Zap,
  CheckCircle, ChevronRight, Menu, X
} from 'lucide-react'
import QRCode from 'qrcode'

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
const ARIE_WHATSAPP = '60126595319'
const TELEGRAM_BOT = '@DrMAGfield_Bot'
const QI_MASTER_IMG = 'https://wlwzfjlvwaosonorsvyf.supabase.co/storage/v1/object/public/brand-assets/dr-magfield/qi-master.jpg'
const QI_MINI_IMG = 'https://wlwzfjlvwaosonorsvyf.supabase.co/storage/v1/object/public/brand-assets/dr-magfield/qi-mini-correct.jpg'
// Official DR MAGfield logo (Keith's archive — transparent PNG)
const LOGO_URL = 'https://wlwzfjlvwaosonorsvyf.supabase.co/storage/v1/object/public/brand-assets/dr-magfield/logo-nav-400.png'

// ─── STATIC PRODUCT DATA (seeded from Brand DNA) ─────────────────────
const PRODUCTS = [
  {
    id: 'qi-master',
    name: 'Qi Master',
    nameZh: '气血大师',
    tagline: 'Full-body rotational magnetic therapy bed',
    tag: 'Flagship',
    icon: 'qi-master',
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
    tagline: 'Portable targeted therapy for muscle & joint recovery',
    tag: 'Portable',
    icon: 'qi-mini',
    stats: [
      { val: '15min', lbl: 'Daily' },
      { val: 'Portable', lbl: 'Take Anywhere' },
      { val: 'Core', lbl: 'Foundation' },
    ],
    desc: 'Targeted pelvic floor and core wellness technology. The circulating energy waves strengthen your body\'s foundation — ideal for golfers who sit long hours between rounds.',
  },
]

// ─── INITIAL CONVERSATION (onboarding script) ──────────────────────────
const ONBOARDING: Message[] = [
  { role: 'agent', text: 'Welcome to DR MAGfield — Malaysia\'s First Golf Club Bio-Energetic Therapy Lounge.', time: '' },
  { role: 'agent', text: 'I\'m your AI recovery guide. Tell me — what brings you in today?', time: '' },
  { role: 'agent', text: 'Back pain from golf? Hip tightness? Recovery from a tournament? Let me help you find the right therapy.', time: '' },
]

// ─── MOCK AGENT RESPONSES (when MCP offline) ─────────────────────────
const MOCK_RESPONSES: Record<string, string> = {
  default: 'Our Qi Master therapy bed is perfect for golfers — 30 minutes on the bed and most clients feel measurable relief in back and shoulder tension. Would you like me to check availability with Arie?',
  price: 'Sessions start from RM 50 for members of KRPM. Your first session includes a complimentary consultation. Would you like to book with Arie via WhatsApp?',
  location: 'We\'re at the KRPM Experience Lounge, Kelab Rahman Putra Malaysia, Sungai Buloh. Members and guests are welcome by appointment.',
  booking: 'Great! Arie Ong is our Experience Coordinator. You can WhatsApp him directly at +6012-659 5319 — he\'ll set up your first session.',
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
  const [telegramQr, setTelegramQr] = useState<string | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Auto-scroll conversation ─────────────────────────────────────
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }, [messages, isTyping])

  // ── Generate Telegram QR on mount ─────────────────────────────────
  useEffect(() => {
    QRCode.toDataURL('https://t.me/DrMAGfield_Bot?start=krpm', {
      width: 200,
      margin: 2,
      color: { dark: '#2D3748', light: '#F5F0E8' },
    }).then(setTelegramQr).catch(() => {})
  }, [])

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_URL} alt="DR MAGfield" style={{ width: 44, height: 44, objectFit: 'contain' }} />
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
            <div className="agent-header-row">
              <div className="agent-avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO_URL} alt="DR MAGfield" style={{ width: 52, height: 52, objectFit: 'contain' }} />
              </div>
              <div className="agent-info">
                <div className="agent-name">{AGENT_NAME}</div>
                <div className="agent-title">{AGENT_TITLE} — Kelab Rahman Putra Malaysia</div>
              </div>
              {telegramQr && (
                <div className="telegram-qr">
                  <img src={telegramQr} alt="Telegram QR" width={64} height={64} style={{ borderRadius: 8 }} />
                  <span style={{ fontSize: 10, color: 'rgba(201,169,110,0.6)', marginTop: 4 }}>Scan to Chat</span>
                </div>
              )}
            </div>
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
                <div className="product-img" style={{ position: 'relative', overflow: 'hidden' }}>
                  {product.id === 'qi-master' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={QI_MASTER_IMG} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : product.id === 'qi-mini' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={QI_MINI_IMG} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Heart size={56} strokeWidth={1.5} color="#C9A96E" />
                  )}
                </div>
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
            {selectedProduct && (() => {
              const sp = PRODUCTS.find(p => p.id === selectedProduct)
              return (
              <div className="product-card selected" style={{ cursor: 'default' }}>
                <div className="product-img" style={{ height: 160, position: 'relative', overflow: 'hidden' }}>
                  {sp?.id === 'qi-master' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={QI_MASTER_IMG} alt={sp?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : sp?.id === 'qi-mini' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={QI_MINI_IMG} alt={sp?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Heart size={48} strokeWidth={1.5} color="#C9A96E" />
                  )}
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
                      <MessageCircle size={16} strokeWidth={2} /> WhatsApp Arie
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
                      <Send size={16} strokeWidth={2} /> Chat with AI Agent
                    </a>
                  </div>
                </div>
              </div>
            );
          })()}
          </div>
        </div>
      </div>

      {/* ── BOTTOM BAR ──────────────────────────────────────────── */}
      <div className="bottombar">
        <div className="bottombar-item">
          <MapPin size={22} strokeWidth={1.5} />
          <div>Location</div>
          <div className="val">KRPM</div>
        </div>
        <div className="bottombar-item">
          <MessageCircle size={22} strokeWidth={1.5} />
          <div>WhatsApp</div>
          <div className="val">+6012-659 5319</div>
        </div>
        <div className="bottombar-item">
          <Send size={22} strokeWidth={1.5} />
          <div>Telegram</div>
          <div className="val">@DrMAGfield_Bot</div>
        </div>
        <div className="bottombar-item">
          <Clock size={22} strokeWidth={1.5} />
          <div>Hours</div>
          <div className="val">By Appt</div>
        </div>
      </div>

      {/* ── PRODUCT MODAL (fullscreen on tap) ───────────────── */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 24, aspectRatio: '16/9', background: 'rgba(201,169,110,0.06)' }}>
              {selectedProduct === 'qi-master' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={QI_MASTER_IMG} alt="Qi Master" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : selectedProduct === 'qi-mini' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={QI_MINI_IMG} alt="Qi Mini" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
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
                <MessageCircle size={16} strokeWidth={2} /> Book with Arie Ong &#8594;
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
                <Send size={16} strokeWidth={2} /> Chat with AI Agent
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
