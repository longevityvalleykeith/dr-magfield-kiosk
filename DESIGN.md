# DR MAGfield Design System

## Overview
DR MAGfield is Malaysia's first golf club bio-energetic therapy lounge at Kelab Rahman Putra Malaysia (KRPM). Premium wellness brand for athletes and golfers. Visual identity: premium sports club meets clinical wellness — clean, warm, confident. Turn Pain into Pure Performance.

---

## Colors

```
--brand-slate:    #2D3748   /* Primary text, headings */
--brand-gold:     #C9A96E   /* CTAs, accents, highlights */
--brand-sage:     #7A9A7E   /* Secondary accent, health signals */
--brand-paper:     #FFFDF9   /* Light backgrounds */
--brand-cream:     #F5F0E8   /* Warm neutral surfaces */
--brand-whatsapp:  #25D366   /* WhatsApp CTAs only */
--brand-dark:      #1A1A1A   /* Primary dark background */
--brand-white:     #FFFFFF
```

**Usage:**
- Gold `#C9A96E` → CTAs, logo wordmark, key highlights
- Slate `#2D3748` → Primary text, navigation
- Sage `#7A9A7E` → Secondary UI, health indicators
- Paper/Cream → Backgrounds, cards
- Dark `#1A1A1A` → Primary dark backgrounds

---

## Typography

**Google Fonts URL:**
```
https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Manrope:wght@300;400;500;700&family=Montserrat:wght@400;800&family=Noto+Sans+SC:wght@400;500;700&display=swap
```

| Role | Font | Weight | Size |
|-------|------|--------|------|
| Wordmark/Logo | Montserrat | 800 | 18-22px |
| Headings (h1-h4) | Cormorant Garamond | 600 | 28-48px |
| Body text | Manrope | 300-400 | 14-16px |
| Chinese text | Noto Sans SC | 400-500 | 14-16px |
| Labels/captions | Manrope | 500 | 10-12px |

**Heading usage:** h1 = 48px, h2 = 36px, h3 = 24px. Always Cormorant Garamond serif.

---

## Logo

**Rule:** ALWAYS spiral vortex SVG mark + "DR MAGfield" wordmark. NEVER emoji.

**Correct usage:**
- Spiral vortex: concentric circles (3 rings) with center dot — in brand-gold on dark, brand-slate on light
- Wordmark: Montserrat 800, "DR" weight 800, "MAGfield" weight 400

**Wrong:** Circle-M emoji, gold-circle M, generic medical cross

---

## Iconography

- NO emoji in any brand surface
- Use SVG icons or Lucide React icon set
- Stroke style: 1.5px stroke, rounded caps
- Colors: brand-gold, brand-sage, brand-slate only

**Product icons (Kiosk):**
- Qi Master: Real product photo (brand-guideline-product.png)
- Qi Mini: Custom sage-colored SVG chevron/diamond motif
- Liver Detox: Custom gold-colored SVG liver silhouette

---

## Motion & Animation

- Message slide-in: `opacity 0→1, translateY 10px→0, 400ms ease-out`
- Typing dots: staggered bounce, 8px translateY, 1.2s infinite
- Status dot: pulse opacity 1→0.4→1, 2s infinite
- Product card hover: scale 1.01, border-color brand-gold, 200ms
- Modal: fadeIn 300ms + slideUp translateY 20px→0, 300ms
- Kiosk banner auto-rotate: 8000ms interval, crossfade transition

---

## Spacing System

- Base unit: 8px
- Container max-width: 1100px (landing), 430px (PWA/mobile), fullscreen (kiosk)
- Section padding: 80px vertical desktop, 48px mobile
- Card padding: 16-20px
- Grid gap: 16-24px

---

## Components

### Buttons (Primary)
```css
background: #C9A96E;
color: #1A1A1A;
border-radius: 12px;
padding: 14px 24px;
font-family: 'Manrope', sans-serif;
font-weight: 700;
font-size: 15px;
```
Hover: background #E8D5A3 (gold-light), transform scale(1.02)

### Cards
```css
background: rgba(255,255,255,0.03);
border: 1px solid rgba(255,255,255,0.07);
border-radius: 16px;
```
Selected state: border-color #C9A96E, box-shadow 0 0 30px rgba(201,169,110,0.1)

### Input Fields
```css
background: rgba(255,255,255,0.06);
border: 1px solid rgba(255,255,255,0.10);
border-radius: 12px;
color: #FFFFFF;
padding: 14px 18px;
```
Focus: border-color rgba(201,169,110,0.4)

---

## Kiosk Display (1920×1080 LED)

- Layout: 3-row grid (72px topbar | 1fr content | 100px bottombar)
- Agent panel (left): avatar, conversation, quick-actions, input
- Product panel (right): carousel with product cards
- Status dot: pulsing green = online, amber = offline
- Auto-rotate banners: 8000ms interval
- Touch-interactive: tap product → modal with WhatsApp + Telegram CTAs
- No-scale viewport: userScalable: false

---

## Telegram Assets

### Banner Spec
- Width: 1200px max
- Format: PNG or HTML rendered to PNG
- Mobile-first: 420px width minimum
- Font: Cormorant Garamond headings, Manrope body
- Language: Bilingual EN/ZH (Simplified Chinese)
- Include: Tagline "Turn Pain into Pure Performance", KRPM logo, QR code

### Telegram Message Format
```
🎬 DR MAGfield — [Title]
[1-line description]

Turn Pain into Pure Performance
📍 Experience Lounge, Rahman Putra Golf Club
```

---

## Product Branding

| Product | Chinese | Icon | Color Accent |
|---------|---------|------|-------------|
| Qi Master (bed) | 气血大师 | Real product photo | Gold #C9A96E |
| Qi Mini | 气血mini | SVG diamond/chevron | Sage #7A9A7E |
| Liver Detox | 清肝胆排毒 | SVG liver silhouette | Gold #C9A96E |

---

## Do's and Don'ts

**DO:**
- Use "DR MAGfield" — exact casing, always with "DR"
- Use spiral vortex SVG logo mark
- Use Cormorant Garamond for headings
- Use Manrope for body text
- Use gold for CTAs and highlights
- Use real product photography
- Bilingual content (EN + ZH)

**DON'T:**
- ❌ "Dr. MAGField" / "DR MAGField" / "MAGFIELD" / "Dr MAGfield"
- ❌ Emoji icons (🛏️⚡🌿🥇)
- ❌ Generic medical/wellness stock photos
- ❌ Space Grotesk / Inter / Roboto fonts
- ❌ Clinical jargon in copy
- ❌ Medical claims ("treats", "cures", "heals")
- ❌ Light-on-light or dark-on-dark insufficient contrast

---

## Event Branding Overlays

For golf events, overlay event name on brand template:
- Event badge: Montserrat 800, brand-gold
- Event date: Manrope 400, white
- Background: brand-dark with subtle radial gradient
- Logo: always present, top-right corner
- Tagline: always present, bottom
