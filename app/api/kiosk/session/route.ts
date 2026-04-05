/**
 * POST /api/kiosk/session
 *
 * Kiosk chat session endpoint — handles patient greetings and queries.
 * Returns text response + audioUrl (Keith's voice clone via MiniMax T2A).
 *
 * Request body:
 *   tenantId:    string  — DR MAGfield tenant ID
 *   patientName: string  — patient's name (pre-chat input)
 *   query:       string  — chat message
 *   mode:        'greet' | 'respond'
 *
 * Response:
 *   text:       string  — agent response text
 *   audioUrl:   string | null — MiniMax T2A audio URL (Keith's voice)
 *   patient:    { recognized: boolean, name: string }
 */
import { NextRequest, NextResponse } from 'next/server'

const DR_MAGFIELD_TENANT_ID = '3cc281be-aafc-4579-9edf-521659306145'

// MiniMax T2A voice config
const MINIMAX_T2A_URL = 'https://api.minimax.io/v1/t2a_v2'
const VOICE_ID = 'male-qn-qingse' // Keith's voice clone

// Mock responses when no LLM available
const GREETING_RESPONSES = [
  'Welcome to DR MAGfield — Malaysia\'s First Golf Club Bio-Energetic Therapy Lounge. I\'m your AI recovery guide. What brings you in today?',
  'Hello! I\'m your AI guide at the DR MAGfield Experience Lounge. Tell me — are you here for golf recovery, general wellness, or something else?',
  'Welcome! Our rotating magnetic therapy is particularly effective for golfers. Are you dealing with any back, hip, or joint tension today?',
]

const WELLNESS_RESPONSES: Record<string, string> = {
  default: 'Our Qi Master therapy bed is perfect for golfers — 30 minutes on the bed and most clients feel measurable relief in back and shoulder tension. Would you like me to check availability with Arie?',
  price: 'Sessions start from RM 50 for KRPM members. Your first session includes a complimentary consultation. Would you like to book with Arie via WhatsApp?',
  location: 'We\'re at the KRPM Experience Lounge, Kelab Rahman Putra Malaysia, Sungai Buloh. Members and guests are welcome by appointment.',
  booking: 'Great! Arie Ong is our Experience Coordinator. WhatsApp him directly at +6012-659 5319 — he\'ll set up your first session.',
  golf: 'Golfers love the Qi Master! The rotating magnetic field addresses exactly what repetitive swings do to your back and shoulders. Most KRPM members come 2-3 times per week.',
  time: 'Sessions are 30-45 minutes. Many golfers do a pre-round session 1-2 hours before teeing off, and a longer recovery session after the round.',
  qi_master: 'The Qi Master is our flagship rotating magnetic therapy bed. It combines therapeutic heat, acoustic vibration, and a rotating magnetic field to address back pain, improve circulation, and accelerate post-round recovery. Would you like to book a session?',
  qi_mini: 'The Qi Mini is our portable targeted therapy device — perfect for pelvic floor and core wellness. It\'s ideal for golfers who sit long hours between rounds. 15 minutes daily builds a strong foundation. Interested?',
  magnetic: 'Rotational magnetic therapy (旋磁疗法) uses a rotating magnetic field to penetrate deep into tissues, reducing inflammation and promoting circulation. It\'s completely non-invasive — you lie down fully clothed on the Qi Master bed. Very popular with KRPM golfers!',
}

function getMockResponse(query: string, mode: string): string {
  const q = query.toLowerCase()
  if (mode === 'greet') {
    return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)]
  }
  if (q.includes('price') || q.includes('cost') || q.includes('rm') || q.includes('fee')) return WELLNESS_RESPONSES.price
  if (q.includes('where') || q.includes('location') || q.includes('address')) return WELLNESS_RESPONSES.location
  if (q.includes('book') || q.includes('appointment') || q.includes('schedule')) return WELLNESS_RESPONSES.booking
  if (q.includes('golf') || q.includes('swing') || q.includes('back') || q.includes('shoulder')) return WELLNESS_RESPONSES.golf
  if (q.includes('how long') || q.includes('time') || q.includes('session')) return WELLNESS_RESPONSES.time
  if (q.includes('qi master') || q.includes('rotational magnetic') || q.includes('therapy bed')) return WELLNESS_RESPONSES.qi_master
  if (q.includes('qi mini') || q.includes('portable') || q.includes('pelvic')) return WELLNESS_RESPONSES.qi_mini
  if (q.includes('magnetic') || q.includes('旋磁')) return WELLNESS_RESPONSES.magnetic
  return WELLNESS_RESPONSES.default
}

async function generateSpeech(text: string, voiceId: string = VOICE_ID): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(MINIMAX_T2A_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-02-hd',
        text,
        voice_setting: {
          voice_id: voiceId,
          speed: 1.0,
          volume: 1.0,
          pitch: 0,
        },
        resp_audio_bitrate: 128000,
        resp_audio_format: 'mp3',
      }),
    })

    if (!res.ok) {
      console.error('[kiosk/session] T2A error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    // T2A returns { data: { audio: "url" } }
    return data?.data?.audio ?? null
  } catch (err) {
    console.error('[kiosk/session] T2A exception:', err)
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId, patientName, query, mode = 'respond' } = body

    // Validate tenant
    if (tenantId !== DR_MAGFIELD_TENANT_ID) {
      return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 })
    }

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }

    const text = getMockResponse(query, mode)
    const audioUrl = await generateSpeech(text)

    return NextResponse.json({
      text,
      audioUrl,
      patient: {
        recognized: false, // Kiosk doesn't do patient recognition — Telegram does
        name: patientName || 'Guest',
      },
    })
  } catch (err) {
    console.error('[kiosk/session] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
