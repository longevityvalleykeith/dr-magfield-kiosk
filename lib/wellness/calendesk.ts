/**
 * One read-only Calendesk call: GET /admin/bookings/{id}, with the same auth headers Foundry's
 * client uses (`X-Api-Key` + `X-Tenant`). This module never writes to Calendesk.
 *
 * Only the fields the entity match needs are kept. The nested `user` object is reduced to its
 * email, and `control` (a cancel credential), phones, names and free text are dropped on parse.
 */
import type { WellnessConfig } from './config.ts'

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
}

export type BookingRead = { ok: true; booking: BookingFacts } | { ok: false; reason: 'BOOKING_NOT_FOUND' | 'BOOKING_UNAVAILABLE' }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const int = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^\d{1,12}$/.test(v)) return Number(v)
  return null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

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
  }
}

export async function readBooking(cfg: NonNullable<WellnessConfig['calendesk']>, bookingId: number, fetchImpl: typeof fetch): Promise<BookingRead> {
  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/admin/bookings/${bookingId}`, {
      method: 'GET',
      headers: { 'X-Api-Key': cfg.apiKey, 'X-Tenant': cfg.tenant, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
  } catch { return { ok: false, reason: 'BOOKING_UNAVAILABLE' } }
  if (res.status === 404) return { ok: false, reason: 'BOOKING_NOT_FOUND' }
  if (!res.ok) return { ok: false, reason: 'BOOKING_UNAVAILABLE' }
  let body: unknown
  try { body = await res.json() } catch { return { ok: false, reason: 'BOOKING_UNAVAILABLE' } }
  const booking = parseBooking(body)
  return booking && booking.id === bookingId ? { ok: true, booking } : { ok: false, reason: 'BOOKING_UNAVAILABLE' }
}
