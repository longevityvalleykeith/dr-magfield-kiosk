import { handleVerify } from '@/lib/wellness/http.ts'
import { liveDeps } from '@/lib/wellness/live.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
// K12-03: claim + 3 list pages + detail + eligibility + consume|release (22 s) plus VERIFY_HEADROOM_MS.
export const maxDuration = 30

export function POST(request: Request): Promise<Response> {
  return handleVerify(request, liveDeps())
}
