/**
 * The consent and notice text, in English and Bahasa Melayu.
 *
 * Shared by the server, which checks the version, and the kiosk screen. The text is a draft
 * pending counsel: Keith's 10-19 product direction carries it, and no lawyer has reviewed it yet.
 * Changing a word means changing CONSENT_VERSION.
 */
export const CONSENT_VERSION = 'dmk-cloud-v1-2026-10-19'

export type Lang = 'en' | 'ms'

export interface ConsentCopy {
  title: string
  points: string[]
  processing: string
  emailResults: string
  share: (name: string) => string
  ccNotice: string
  start: string
  decline: string
  disclaimer: string
}

export const CONSENT_TEXT: Record<Lang, ConsentCopy> = {
  en: {
    title: 'Optional wellness check',
    points: [
      'A short video of your face is recorded on this tablet and sent to FacePhys, our technology provider, to estimate wellness indicators. FacePhys may process it outside Malaysia.',
      'LV keeps no copy of the video, your readings or your email address. We keep only a minimal consent record: the consent version, the time, a coded booking reference and whether the email was sent.',
      'Your results are shown on this screen until it resets, and emailed to the address on your booking.',
      'These are wellness indicators, not medical measurements, and not a diagnosis.',
      'The check is optional. Saying no changes nothing about your visit. You must be 18 or older.',
    ],
    processing: 'I agree to the video being recorded and sent to FacePhys for processing, which may happen outside Malaysia.',
    emailResults: 'Email my results to the address on my booking.',
    share: (name) => `Also copy (CC) ${name} of the DR MAGfield CARE team on my results email.`,
    ccNotice: 'Everyone on a CC email can see each other’s address, and replies can reach everyone.',
    start: 'Start my scan',
    decline: 'No thanks',
    disclaimer: 'Each value is a wellness indicator, not a medical measurement. It is not a diagnosis. If you feel unwell, speak to a doctor; in an emergency call 999.',
  },
  ms: {
    title: 'Pemeriksaan kesejahteraan pilihan',
    points: [
      'Video ringkas wajah anda dirakam pada tablet ini dan dihantar kepada FacePhys, penyedia teknologi kami, untuk menganggarkan penunjuk kesejahteraan. FacePhys mungkin memprosesnya di luar Malaysia.',
      'LV tidak menyimpan salinan video, bacaan atau alamat e-mel anda. Kami hanya menyimpan rekod persetujuan yang minimum: versi persetujuan, masa, rujukan tempahan berkod dan sama ada e-mel telah dihantar.',
      'Keputusan anda dipaparkan pada skrin ini sehingga ia ditetapkan semula, dan dihantar melalui e-mel ke alamat pada tempahan anda.',
      'Ini ialah penunjuk kesejahteraan, bukan ukuran perubatan, dan bukan diagnosis.',
      'Pemeriksaan ini adalah pilihan. Menolak tidak mengubah apa-apa tentang lawatan anda. Anda mesti berumur 18 tahun ke atas.',
    ],
    processing: 'Saya bersetuju video dirakam dan dihantar kepada FacePhys untuk diproses, yang mungkin berlaku di luar Malaysia.',
    emailResults: 'E-melkan keputusan saya ke alamat pada tempahan saya.',
    share: (name) => `Juga salinkan (CC) e-mel keputusan saya kepada ${name} daripada pasukan CARE DR MAGfield.`,
    ccNotice: 'Semua penerima e-mel CC boleh melihat alamat satu sama lain, dan balasan boleh sampai kepada semua.',
    start: 'Mulakan imbasan saya',
    decline: 'Tidak, terima kasih',
    disclaimer: 'Setiap nilai ialah penunjuk kesejahteraan, bukan ukuran perubatan. Ia bukan diagnosis. Jika anda tidak sihat, berjumpa doktor; dalam kecemasan hubungi 999.',
  },
}
