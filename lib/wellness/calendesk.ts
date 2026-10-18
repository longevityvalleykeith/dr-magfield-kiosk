/**
 * One read-only Calendesk call: GET /admin/bookings/{id}, with the same auth headers Foundry's
 * client uses (`X-Api-Key` + `X-Tenant`). This module never writes to Calendesk.
 *
 * Only the fields the entity match needs are kept. The nested `user` object is reduced to its
 * email, and `control` (a cancel credential), phones, names and free text are dropped on parse.
 */
import type { WellnessConfig } from './config.ts'

/** The booking's own Calendesk employee, read only to resolve the guest's optional CC. Never logged or recorded. */
export interface EmployeeFacts { id: number; name: string | null; email: string | null; status: string | null }

export interface BookingFacts {
  id: number
  status: string
  locationId: number | null
  serviceLocationId: number | null
  serviceId: number | null
  serviceTypeId: number | null
  employeeId: number | null
  startDate: string | null
  startsAt: string | null
  customerEmail: string | null
  employee: EmployeeFacts | null
}

export type BookingRead = { ok: true; booking: BookingFacts } | { ok: false; reason: 'BOOKING_NOT_FOUND' | 'BOOKING_UNAVAILABLE' }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const int = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^\d{1,12}$/.test(v)) return Number(v)
  return null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function parseEmployee(raw: unknown): EmployeeFacts | null {
  const top = obj(raw)
  const row = obj(top?.data) ?? top
  const id = int(row?.id)
  if (!row || id === null) return null
  const user = obj(row.user)
  const name = [str(user?.name), str(user?.surname)].filter(Boolean).join(' ') || null
  return { id, name, email: str(user?.email)?.toLowerCase() ?? null, status: str(user?.status)?.toLowerCase() ?? null }
}

export function parseBooking(raw: unknown): BookingFacts | null {
  const top = obj(raw)
  const row = obj(top?.data) ?? top
  if (!row) return null
  const id = int(row.id)
  const status = str(row.status)
  if (id === null || status === null) return null
  const location = obj(row.location)
  const user = obj(row.user)
  return {
    id,
    status: status.toLowerCase(),
    locationId: int(location?.location_id),
    serviceLocationId: int(location?.id),
    serviceId: int(row.service_id),
    serviceTypeId: int(row.service_type_id),
    employeeId: int(row.employee_id),
    startDate: str(row.start_date),
    startsAt: str(row.starts_at),
    customerEmail: str(user?.email)?.toLowerCase() ?? null,
    employee: obj(row.employee) ? parseEmployee(row.employee) : null,
  }
}

export async function readBooking(cfg: NonNullable<WellnessConfig['calendesk']>, bookingId: number, fetchImpl: typeof fetch): Promise<BookingRead> {
  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/admin/bookings/${bookingId}`, {
      method: 'GET',
      headers: { 'X-Api-Key': cfg.apiKey, 'X-Tenant': cfg.tenant, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(4_000),
    })
  } catch { return { ok: false, reason: 'BOOKING_UNAVAILABLE' } }
  if (res.status === 404) return { ok: false, reason: 'BOOKING_NOT_FOUND' }
  if (!res.ok) return { ok: false, reason: 'BOOKING_UNAVAILABLE' }
  let body: unknown
  try { body = await res.json() } catch { return { ok: false, reason: 'BOOKING_UNAVAILABLE' } }
  const booking = parseBooking(body)
  return booking && booking.id === bookingId ? { ok: true, booking } : { ok: false, reason: 'BOOKING_UNAVAILABLE' }
}

export async function readEmployee(cfg: NonNullable<WellnessConfig['calendesk']>, employeeId: number, fetchImpl: typeof fetch): Promise<EmployeeFacts | null> {
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/admin/employees/${employeeId}`, {
      method: 'GET',
      headers: { 'X-Api-Key': cfg.apiKey, 'X-Tenant': cfg.tenant, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const emp = parseEmployee(await res.json())
    return emp && emp.id === employeeId ? emp : null
  } catch { return null }
}

/** Free probe: an authenticated read of /admin/settings (no customer data) proves the key and tenant. */
export async function calendeskReachable(cfg: NonNullable<WellnessConfig['calendesk']>, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/admin/settings`, {
      method: 'GET', headers: { 'X-Api-Key': cfg.apiKey, 'X-Tenant': cfg.tenant, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4_000),
    })
    return res.ok
  } catch { return false }
}

/**
 * Today's active bookings, read with the documented list (GET /admin/bookings/v2, as Foundry's client uses it):
 * day filters only, exactly as Foundry's production reader calls it. Status and email are matched here, on the server,
 * so the email never appears in a URL.
 */
export async function listDayBookings(cfg: NonNullable<WellnessConfig['calendesk']>, day: string, fetchImpl: typeof fetch): Promise<BookingFacts[] | null> {
  const rows: BookingFacts[] = []
  for (let page = 1; page <= 3; page++) {
    const q = new URLSearchParams({ booking_date_from: day, booking_date_to: day, limit: '100', page: String(page) })
    let body: unknown
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/admin/bookings/v2?${q}`, {
        method: 'GET', headers: { 'X-Api-Key': cfg.apiKey, 'X-Tenant': cfg.tenant, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4_000),
      })
      if (!res.ok) return null
      body = await res.json()
    } catch { return null }
    const top = obj(body)
    if (!top || !Array.isArray(top.data)) return null
    for (const raw of top.data) { const b = parseBooking(raw); if (b) rows.push(b) }
    const last = int(top.last_page)
    if (last === null || page >= last) break
  }
  return rows
}
