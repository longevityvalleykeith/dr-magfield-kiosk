/**
 * Production wiring for the route handlers: the real environment, fetch and clock, plus a log
 * that writes one JSON line per event. Handlers pass only codes, counts and key paths to it.
 * No synthetic state is injected here: each handler resolves the admitted durable RPC configuration.
 * An absent/malformed configuration disables the lane; there is no production memory-store fallback.
 */
import type { Deps } from './http.ts'

export function liveDeps(): Deps {
  return {
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    log: (event, fields) => { console.info(JSON.stringify({ scope: 'wellness', event, ...fields })) },
  }
}
