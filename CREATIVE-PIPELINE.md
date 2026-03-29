# DR MAGfield Golf Event — Creative Pipeline Spec

## Overview

STITCH reads DESIGN.md → generates banner concept → REMOTION renders motion MP4 → Keith reviews in Telegram → output ships to Telegram group + Kiosk auto-rotate.

**Keith's role:** Human-in-the-loop approver — rapid fire preview → feedback → final output.
**Arie's 7 events:** Apr–Jun 2026. Each event = one banner + one motion video.

---

## Creative Pipeline Flow

```
EVENT BRIEF (Arie's WhatsApp → Keith forwards to Telegram)
    │
    ▼
Agent 0 /event command
    │  Parses: {event_name, date, audience, offer}
    ▼
┌─────────────────────────────────────────────────────────┐
│ STITCH reads DESIGN.md                                  │
│  → Banner concept (1200×628 PNG, bilingual EN/ZH)       │
│  → Motion storyboard (JSON, 6-frame beat structure)    │
│  → Kiosk frame (1920×1080 PNG)                          │
└─────────────────────────────────────────────────────────┘
    │
    ▼
Keith receives preview in Telegram DM
    │
    ├─ /approve [asset_id]  → proceeds to render
    ├─ /revise [asset_id] [feedback]  → back to Stitch with notes
    └─ /reject [reason]  → regenerate from scratch
    │
    ▼
REMOTION renders MP4 (Mac Mini GPU, ~30-60s)
    │
    ▼
Final output:
  • MP4 → Telegram group @DrMAGfield_Group
  • PNG → Kiosk auto-rotate banner[slot]
  • Link → drmagfield.vercel.app/events/[slug]
```

---

## STITCH Design Prompts

### Banner Concept (Stitch `design` tool)

**Input:** Event brief + DESIGN.md
**Output:** 1200×628 PNG, bilingual EN/ZH

```
Prompt:
"Design a DR MAGfield golf event banner for [EVENT NAME] on [DATE].
Audience: [AUDIENCE e.g. All Members / Ladies / Junior]
Offer: RM50 membership trial — Qi Master bed + Qi Mini portable

BRAND RULES from DESIGN.md:
- Colors: brand-dark #1A1A1A bg, brand-gold #C9A96E accents, brand-sage #7A9A7E secondary
- Typography: Cormorant Garamond headings, Manrope body, Montserrat wordmark
- Logo: spiral vortex SVG (concentric rings + center dot), NEVER emoji
- Tagline: 'Turn Pain into Pure Performance'
- Language: Bilingual EN + ZH (Simplified Chinese)
- NO medical claims, NO emoji icons

Layout:
- Top: Event badge (Montserrat 800, gold) + date
- Center: [EVENT NAME] in large Cormorant Garamond
- Bottom: Tagline + KRPM logo + QR code placeholder
- Background: brand-dark with subtle radial gradient
- Gold accent lines / borders

Output: 1200×628 PNG, compressed <200KB"
```

### Motion Storyboard (Stitch `design` tool)

**Output:** JSON storyboard, 6 frames, each ~4s at 30fps = 24s video

```json
{
  "event": "[EVENT NAME]",
  "date": "[DATE]",
  "frames": [
    {
      "time": "0-4s",
      "scene": "intro",
      "en": "DR MAGfield — [EVENT NAME]",
      "zh": "[EVENT CHINESE NAME]",
      "visual": "Logo spiral vortex spins in from center, gold on dark",
      "audio": "subtle whoosh + heartbeat"
    },
    {
      "time": "4-8s",
      "scene": "event_reveal",
      "en": "[DATE] • [AUDIENCE]",
      "zh": "[DATE] • [AUDIENCE CHINESE]",
      "visual": "Event name fades up, gold Cormorant Garamond, sage underline sweeps in",
      "audio": "tension build"
    },
    {
      "time": "8-14s",
      "scene": "offer",
      "en": "RM50 Member Trial — Qi Master + Qi Mini",
      "zh": "RM50 会员体验 — 气血大师 + 气血mini",
      "visual": "Product showcase: Qi Master bed left, Qi Mini right, gold borders",
      "audio": "positive confirmation tone"
    },
    {
      "time": "14-18s",
      "scene": "tagline",
      "en": "Turn Pain into Pure Performance",
      "zh": "将疼痛转化为纯粹表现",
      "visual": "Full-width tagline, italic Cormorant Garamond, gold text",
      "audio": "warm reverb"
    },
    {
      "time": "18-22s",
      "scene": "cta",
      "en": "Scan QR • Start Chatting • Book Your Session",
      "zh": "扫描二维码 • 开始对话 • 预约体验",
      "visual": "3-step icons (scan, chat, checkmark) with sage color",
      "audio": "digital confirmation chime"
    },
    {
      "time": "22-24s",
      "scene": "outro",
      "en": "Rahman Putra Golf Club • Sungai Buloh",
      "zh": "拉赫曼·普特拉高尔夫俱乐部",
      "visual": "KRPM logo + vortex logo, fade to dark",
      "audio": "fade out"
    }
  ],
  "total_duration": "24s",
  "fps": 30,
  "resolution": "1200×628"
}
```

---

## REMOTION Render Spec

### Input to Remotion `render_video` tool

```
Tag: golf-event-[slug]-[date]
Duration: 24s (6 scenes × 4s)
Resolution: 1200×628 (Telegram optimal)
FPS: 30
Audio: Yes (Narration + SFX per frame spec)

Brand Assets:
- Logo SVG: spiral vortex (concentric rings + center dot) — embed as React component
- Font: Cormorant Garamond 600 for headings, Manrope 400 for body
- Colors: brand-dark #1A1A1A, brand-gold #C9A96E, brand-sage #7A9A7E

Content for each frame: (from storyboard above)
```

### Remotion Component Structure

```
src/
  compositions/
    GolfEventBanner.tsx   ← main 24s timeline composition
  components/
    SpiralVortex.tsx      ← animated logo (3 rings + center dot)
    EventBadge.tsx        ← Montserrat 800, gold, top-left
    ProductShowcase.tsx   ← Qi Master + Qi Mini with gold borders
    TaglineText.tsx       ← italic Cormorant Garamond, gold
    ThreeStepIcons.tsx    ← scan/chat/checkmark with sage color
    KRPMLogo.tsx          ← club logo bottom-right
  audio/
    whoosh.mp3
    heartbeat.mp3
    confirmation.mp3
```

---

## Keith Telegram Review Loop

### Agent 0 Commands

| Command | Who | Action |
|---------|-----|--------|
| `/event [name] [date] [audience]` | Keith | Triggers full pipeline |
| `/preview [asset_id]` | Keith | Resends preview to Telegram DM |
| `/approve [asset_id]` | Keith | Triggers Remotion render |
| `/revise [asset_id] [notes]` | Keith | Returns to Stitch with feedback |
| `/reject [reason]` | Keith | Full regenerate |
| `/kiosk push [asset_id]` | Keith | Pushes approved PNG to kiosk |
| `/status` | Keith | Shows pending events + asset status |

### Telegram Message Format (Agent 0 → Keith DM)

```
🎬 PREVIEW — [EVENT NAME] (Monthly Medal)

[PNG PREVIEW IMAGE]

━━━━━━━━━━━━━━━━━━━━
📋 ASSET: banner_v1
📅 EVENT: Monthly Medal — 5 April 2026
👥 AUDIENCE: All Members
💰 OFFER: RM50 Trial (Qi Master + Qi Mini)
━━━━━━━━━━━━━━━━━━━━

✅ Looks good? /approve banner_v1
✏️ Changes needed? /revise banner_v1 [your feedback]
❌ Start over? /reject [reason]
```

### Telegram Message Format (Final Delivery → Group)

```
🏌️ [EVENT NAME] — [DATE]

Experience bio-energetic therapy at Rahman Putra Golf Club.
Turn Pain into Pure Performance.

[MP4 VIDEO ATTACHMENT]

📍 KRPM Experience Lounge | Scan QR on kiosk
💬 Chat now: @DrMAGfield_Bot
```

---

## Event Calendar (Arie's 7 KRPM Golf Events)

| # | Date | Event | Slug | Audience |
|---|------|-------|------|----------|
| 1 | 5 Apr 2026 | Monthly Medal | `monthly-medal-apr-05` | All Members |
| 2 | 25-26 Apr 2026 | Rabbit Cup | `rabbit-cup-apr-25` | All Members |
| 3 | 9 May 2026 | Monthly Medal | `monthly-medal-may-09` | All Members |
| 4 | 17 May 2026 | VP Trophy | `vp-trophy-may-17` | All Members |
| 5 | 23 May 2026 | Ladies Social | `ladies-social-may-23` | Ladies |
| 6 | 20-21 Jun 2026 | Annual Club Championship (S/L/J) | `acc-senior-jun-20` | Senior/Ladies/Junior |
| 7 | 26-28 Jun 2026 | Annual Club Championship (Men) | `acc-men-jun-26` | Men |

---

## Rapid Fire Preview → Feedback → Output Cadence

**Target timing per event:**
1. Brief received (Keith forwards Arie's WhatsApp) → 5 min
2. Stitch banner concept generated → 2 min
3. Keith preview in Telegram DM → instant
4. Keith feedback loop (avg) → 10-30 min
5. Revision or approval → 2 min
6. Remotion render → 30-60s
7. Final output to Telegram Group + Kiosk → instant

**Total: ~20-45 min from brief to live**

### Fast Path (no revisions):
```
0:00  Keith /event Monthly Medal 5Apr AllMembers
0:02  Agent 0 → Stitch generates banner
0:04  Banner preview in Telegram DM
0:06  Keith /approve banner_v1
0:08  Agent 0 → Remotion render starts
0:38  MP4 delivered to Telegram Group
0:40  PNG pushed to Kiosk auto-rotate
```

---

## Product Icons (SVG, not emoji)

Per DESIGN.md — NEVER emoji:

| Product | SVG Design | Color |
|---------|-----------|-------|
| Qi Master | Real product photo (`product-qi-master.png`) | Gold border |
| Qi Mini | Diamond/chevron chevrons pointing up | Sage #7A9A7E |
| Liver Detox | Stylized liver silhouette | Gold #C9A96E |

---

## Kiosk Auto-Rotate Banners

**Storage:** `public/banners/` on kiosk repo
**Naming:** `event-[slug]-v[N].png`
**Max banners:** 10 active in rotation (8000ms interval)

```
banners/
  onboarding-v3.png        ← always in rotation
  liver-detox-v2.png       ← always in rotation
  event-monthly-medal-apr-05-v1.png
  event-rabbit-cup-apr-25-v1.png
  ...
```

**Rotation priority:**
1. Event-active: show event banner every 3rd rotation
2. Always-on: onboarding + liver detox fill remaining slots
3. Keith can `/kiosk push [asset_id]` to inject new banner immediately

---

## Quality Checklist (Keith reviews before /approve)

- [ ] Event name correct spelling
- [ ] Date correct (MYT timezone)
- [ ] Audience correct (All Members / Ladies / Junior / Men)
- [ ] RM50 offer clearly stated
- [ ] QR code present and valid (links to @DrMAGfield_Bot)
- [ ] Bilingual EN/ZH content accurate
- [ ] No medical claims ("treats", "cures", "heals")
- [ ] Brand colors correct (gold #C9A96E accents, dark #1A1A1A bg)
- [ ] Typography: Cormorant Garamond headings, Manrope body
- [ ] Logo: spiral vortex SVG, NOT emoji
- [ ] Tagline present: "Turn Pain into Pure Performance"
- [ ] KRPM logo present
