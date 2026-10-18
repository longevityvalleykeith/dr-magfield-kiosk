import { handleVerify } from '@/lib/wellness/http.ts'
import { liveDeps } from '@/lib/wellness/live.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 20

export function POST(request: Request): Promise<Response> {
  return handleVerify(request, liveDeps())
}
