/**
 * A minimal Gherkin runner on node:test, so `features/*.feature` is the spec AND the test.
 *
 * Every scenario in the feature becomes one node:test case. Each step must match exactly one
 * registered definition. An UNDEFINED or AMBIGUOUS step fails its scenario, so the feature text
 * cannot drift away from what runs. Scenario Outlines expand per Examples row.
 * Supported: Feature, Background, Scenario, Scenario Outline + Examples, Given/When/Then/And/But.
 */
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const STEP = /^(Given|When|Then|And|But)\s+(.+)$/

export function parseFeature(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const feature = { name: '', background: [], scenarios: [] }
  let current = null
  let outline = null
  let header = null
  for (const line of lines) {
    if (!line || line.startsWith('#') || line.startsWith('@')) continue
    if (line.startsWith('Feature:')) { feature.name = line.slice(8).trim(); current = null; continue }
    if (line.startsWith('Background:')) { current = feature.background; outline = null; continue }
    if (line.startsWith('Scenario Outline:')) {
      outline = { name: line.slice(17).trim(), steps: [], rows: [] }
      feature.scenarios.push({ outline })
      current = outline.steps; header = null; continue
    }
    if (line.startsWith('Scenario:')) {
      const scenario = { name: line.slice(9).trim(), steps: [] }
      feature.scenarios.push(scenario)
      current = scenario.steps; outline = null; continue
    }
    if (line.startsWith('Examples:')) { current = null; header = null; continue }
    if (line.startsWith('|') && outline) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim())
      if (!header) header = cells
      else outline.rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i]])))
      continue
    }
    const m = STEP.exec(line)
    if (m && current) { current.push({ keyword: m[1], text: m[2] }); continue }
    // Free text under Feature: is narrative and ignored.
  }
  const scenarios = []
  for (const s of feature.scenarios) {
    if (!s.outline) { scenarios.push(s); continue }
    s.outline.rows.forEach((row, i) => {
      const fill = (t) => t.replace(/<([^>]+)>/g, (_, k) => {
        if (!(k in row)) throw new Error(`Examples has no column <${k}> for "${s.outline.name}"`)
        return row[k]
      })
      scenarios.push({ name: `${s.outline.name} [${i + 1}: ${Object.values(row).join(' | ')}]`, steps: s.outline.steps.map((st) => ({ ...st, text: fill(st.text) })) })
    })
  }
  return { name: feature.name, background: feature.background, scenarios }
}

export function createRegistry() {
  const defs = []
  const define = (pattern, fn) => { defs.push({ pattern, fn }) }
  const find = (text) => {
    const hits = defs.map((d) => ({ d, m: d.pattern.exec(text) })).filter((h) => h.m && h.m[0] === text)
    if (hits.length === 0) throw new Error(`UNDEFINED STEP: "${text}"`)
    if (hits.length > 1) throw new Error(`AMBIGUOUS STEP: "${text}" matches ${hits.map((h) => h.d.pattern).join(' and ')}`)
    return hits[0]
  }
  return { Given: define, When: define, Then: define, find }
}

/** Run every scenario of `featurePath` as a node:test case with a fresh world from `makeWorld`. */
export function runFeature(featurePath, registry, makeWorld) {
  const feature = parseFeature(readFileSync(featurePath, 'utf8'))
  if (feature.scenarios.length === 0) throw new Error(`no scenarios in ${featurePath}`)
  for (const scenario of feature.scenarios) {
    test(scenario.name, async () => {
      const world = await makeWorld()
      try {
        for (const step of [...feature.background, ...scenario.steps]) {
          const { d, m } = registry.find(step.text)
          try { await d.fn(world, ...m.slice(1)) }
          catch (error) { error.message = `${step.keyword} ${step.text}\n  → ${error.message}`; throw error }
        }
      } finally { await world.dispose?.() }
    })
  }
  return feature
}
