import { handleHealth } from '@/lib/wellness/http.ts'
import { liveDeps } from '@/lib/wellness/live.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 20

export function GET(request: Request): Promise<Response> {
  return handleHealth(request, liveDeps())
}
