// G4 / K4-4 (T1 #188 c.6721710602): no kiosk product file writes a staff or employee
// identifier into a consent or attempt record. Keith's R1.5 rule: no staff id in any
// consent record, on every surface. A source guard with planted controls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const PRODUCT_DIRS = ['lib', 'app']
/** The files that build or carry a consent or attempt record. */
const RECORD_FILES = ['lib/wellness/record.ts', 'lib/wellness/tokens.ts', 'lib/wellness/http.ts',
  'lib/wellness/state.ts', 'lib/wellness/state-validation.ts', 'lib/wellness/state-memory.ts', 'lib/wellness/state-rpc.ts']

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(relative(ROOT, p))
  }
  return out
}
export function productFiles() {
  return PRODUCT_DIRS.flatMap((d) => walk(join(ROOT, d))).sort()
}

// A staff-id key given any value other than null: `careEmployeeId: x`, `staffId = x`, `c: a.careEmployeeId`.
const STAFF_KEY_WRITE = /\b(careEmployeeId|staffId)\s*[:=]\s*(?!null\b)(?!number\b)(?!string\b)\S/
const STAFF_VALUE_READ = /\.\s*(careEmployeeId|staffId)\b(?!\s*(!==|===)\s*null)/
// In a record file, the booking's employee is never read at all.
const EMPLOYEE_READ = /\bemployeeId\b|\bemployee_id\b/

/** Returns the offending `file:line: text` entries for one file's source. */
export function violations(file, src) {
  const record = RECORD_FILES.includes(file)
  const hits = []
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '')
    if (/^\s*(\*|\/\*)/.test(code)) return
    if (STAFF_KEY_WRITE.test(code) || STAFF_VALUE_READ.test(code) || (record && EMPLOYEE_READ.test(code))) {
      hits.push(`${file}:${i + 1}: ${line.trim()}`)
    }
  })
  return hits
}

test('K4-4 the guard scans every product file, including each record file', () => {
  const files = productFiles()
  for (const f of RECORD_FILES) assert.ok(files.includes(f), `the guard does not scan ${f}`)
  const independent = PRODUCT_DIRS.flatMap((d) => walk(join(ROOT, d))).length
  assert.equal(files.length, independent)
  assert.ok(files.length >= 20, `only ${files.length} product files scanned`)
})

test('K4-4 planted controls: each staff-id write is caught; null and type declarations are not', () => {
  const planted = [
    ['lib/wellness/record.ts', '    careEmployeeId: f.booking.employeeId,'],
    ['lib/wellness/tokens.ts', '  return { c: a.careEmployeeId }'],
    ['lib/wellness/http.ts', '    careEmployeeId: found.booking.employeeId, careEmailHash: null,'],
    ['app/api/x/route.ts', '  const rec = { staffId: staff.id }'],
    ['lib/wellness/state.ts', '  ownerRef = booking.employee_id'],
  ]
  for (const [file, line] of planted) assert.equal(violations(file, line).length, 1, `planted write not caught: ${line}`)
  const clean = [
    ['lib/wellness/record.ts', '    careEmployeeId: null,'],
    ['lib/wellness/state.ts', '  careEmployeeId: null'],
    ['lib/wellness/state-validation.ts', "  'serviceId', 'careEmployeeId', 'subjectBinding',"],
    ['lib/wellness/state-validation.ts', '    || value.careEmployeeId !== null'],
    ['lib/wellness/calendesk.ts', '  employeeId: number | null'],
  ]
  for (const [file, line] of clean) assert.deepEqual(violations(file, line), [], `false positive: ${line}`)
})

test('K4-4 no kiosk product file writes a staff or employee id into a consent or attempt record', () => {
  const hits = productFiles().flatMap((f) => violations(f, readFileSync(join(ROOT, f), 'utf8')))
  assert.deepEqual(hits, [])
})
