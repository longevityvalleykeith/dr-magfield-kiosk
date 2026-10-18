/**
 * The v3 result, reduced to the admitted indicators.
 *
 * The OpenAPI leaves the 200 body unspecified. The field names below come from the vendor's public
 * Playground bundle (heartRate, rmssd, sdnn, breathingRate, sqi/confidence), so they are a
 * calibration, not a contract.
 *
 * v1 admits exactly four indicators: heart rate, RMSSD, SDNN and breathing rate. Anything else
 * FacePhys returns (SpO2, blood pressure, stress, emotion, age, gender) is dropped and never shown,
 * emailed or logged. A value outside its plausible range, a poor signal, or a missing heart rate
 * yields "insufficient quality". A value is never invented.
 */
export type IndicatorKey = 'heart_rate' | 'hrv_rmssd' | 'hrv_sdnn' | 'breathing_rate'
export interface Indicator { key: IndicatorKey; label: string; value: number; unit: string }
export type Reading = { kind: 'completed'; indicators: Indicator[] } | { kind: 'insufficient_quality' }

const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '')

const FIELDS: { key: IndicatorKey; label: string; unit: string; names: string[]; min: number; max: number }[] = [
  { key: 'heart_rate', label: 'Heart rate', unit: 'bpm', names: ['heartrate', 'hr', 'hrbpm', 'pulse', 'pulserate'], min: 35, max: 200 },
  { key: 'hrv_rmssd', label: 'Heart-rate variability (RMSSD)', unit: 'ms', names: ['rmssd', 'hrvrmssd'], min: 5, max: 250 },
  { key: 'hrv_sdnn', label: 'Heart-rate variability (SDNN)', unit: 'ms', names: ['sdnn', 'hrvsdnn'], min: 5, max: 250 },
  { key: 'breathing_rate', label: 'Breathing rate', unit: 'breaths/min', names: ['breathingrate', 'respiratoryrate', 'respirationrate', 'breathrate', 'resprate'], min: 4, max: 40 },
]
const QUALITY = ['sqi', 'signalquality', 'qualityscore', 'quality', 'confidence']

function numberOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner
  }
  return null
}

/** Breadth-first: the shallowest numeric value under any of `names`, at most five levels deep. */
function find(body: unknown, names: string[]): number | null {
  let level: unknown[] = [body]
  for (let depth = 0; depth < 5 && level.length > 0; depth++) {
    const next: unknown[] = []
    for (const node of level) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue
      const entries = Object.entries(node as Record<string, unknown>)
      for (const [k, v] of entries) {
        if (names.includes(norm(k))) {
          const n = numberOf(v)
          if (n !== null) return n
        }
      }
      for (const [, v] of entries) if (v && typeof v === 'object') next.push(v)
    }
    level = next
  }
  return null
}

export function normalizeResult(body: unknown, minQuality: number, allowMissingQuality = false): Reading {
  const q = find(body, QUALITY)
  // With no quality field the reading cannot be shown to be good enough, so it is not one (O2O-11).
  if (q === null && !allowMissingQuality) return { kind: 'insufficient_quality' }
  if (q !== null && (q > 1 ? q / 100 : q) < minQuality) return { kind: 'insufficient_quality' }
  const indicators: Indicator[] = []
  for (const f of FIELDS) {
    const v = find(body, f.names)
    if (v !== null && v >= f.min && v <= f.max) indicators.push({ key: f.key, label: f.label, unit: f.unit, value: Math.round(v) })
  }
  if (!indicators.some((i) => i.key === 'heart_rate')) return { kind: 'insufficient_quality' }
  return { kind: 'completed', indicators }
}

/** Structure only, for calibrating FIELDS from the logs: key paths, never values. */
export function keyPaths(body: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 4 || !body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (out.length >= 80) break
    const path = prefix ? `${prefix}.${k}` : k
    out.push(path)
    keyPaths(v, path, depth + 1, out)
  }
  return out
}
