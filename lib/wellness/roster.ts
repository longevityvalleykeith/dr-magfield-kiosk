/**
 * The CARE roster: who may be copied on a guest's results, by their Calendesk employee ID.
 *
 * T1 #164 CLOUD-03: a Calendesk employee ID alone grants nothing. A recipient must be on this
 * server-side roster, active, and at this outlet. Staff email addresses never reach the browser.
 */
export interface RosterEntry { calendeskEmployeeId: number; name: string; email: string; outlets: string[]; active: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Parses CARE_ROSTER_JSON. Malformed input yields an empty roster, which disables the CC. */
export function parseRoster(raw: string | undefined): RosterEntry[] {
  if (!raw || !raw.trim()) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: RosterEntry[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const id = Number(e.calendeskEmployeeId)
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : ''
    const outlets = Array.isArray(e.outlets) ? e.outlets.filter((o): o is string => typeof o === 'string' && o.length > 0) : []
    if (!Number.isSafeInteger(id) || id <= 0 || !name || !EMAIL.test(email) || outlets.length === 0) continue
    out.push({ calendeskEmployeeId: id, name, email, outlets, active: e.active === true })
  }
  return out
}

/** The booking's own employee, only if listed once, active and at this outlet. Never a substitute. */
export function careRecipientFor(roster: RosterEntry[], employeeId: number | null, outlet: string): RosterEntry | null {
  if (employeeId === null) return null
  const hits = roster.filter((r) => r.calendeskEmployeeId === employeeId)
  if (hits.length !== 1) return null
  const r = hits[0]
  return r.active && r.outlets.includes(outlet) ? r : null
}
