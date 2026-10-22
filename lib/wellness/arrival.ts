/**
 * Which QR brought a guest here, as a count label only (T1 #173 C4; Main 10-19 §7.4). `qr` = the kiosk standee's own
 * QR; `lvqr` = LV's old printed QR, which 308-redirects here. Anything else is not counted. No address, device or person.
 */
export type Arrival = 'qr' | 'lvqr'

export function arrivalSource(src: unknown): Arrival | null {
  return src === 'qr' || src === 'lvqr' ? src : null
}
