#!/usr/bin/env node
// Doc-consistency check for the attractorify skill's reference material and the
// attractor-expert agent -- p6-02/p6-03/p6-04/p6-05's own acceptance criteria.
// Run from the repo root: node plugins/attractor/skills/attractorify/reference/check-consistency.mjs
//
// This is NOT a substitute for reading the files -- it catches the specific,
// named regressions FR-14/FR-15 exist to prevent (an unregistered handler
// presented as usable; a non-gate node implied to receive a routing verdict;
// a stray amplifier-only concept left in ported material), grep-cheap enough
// to run on every edit rather than trusted to a one-time manual review.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(HERE, '..')
const REPO_ROOT = resolve(SKILL_DIR, '..', '..', '..', '..')
const EXAMPLES_DIR = join(SKILL_DIR, 'examples')

const exampleMdFiles = existsSync(EXAMPLES_DIR)
  ? readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(EXAMPLES_DIR, f))
  : []

const FILES = [
  join(HERE, 'dot-reference.md'),
  join(HERE, 'routing-reference.md'),
  join(HERE, 'engine-semantics.md'),
  join(HERE, 'pipeline-design-principles.md'),
  join(HERE, 'pipeline-patterns.md'),
  join(SKILL_DIR, 'SKILL.md'),
  join(SKILL_DIR, '..', '..', 'agents', 'attractor-expert.md'),
  ...exampleMdFiles,
].filter(existsSync)

let failures = 0
function fail(msg) {
  failures++
  console.error(`FAIL: ${msg}`)
}

// A shape/term is "presented as usable" if it appears NOT immediately
// alongside one of these markers -- every legitimate mention in this
// project's own material uses one of these when naming something
// unregistered, refused, unsupported, or out of scope, even in a
// comparative/historical aside (e.g. "amplifier's own example used X").
const SAFE_MARKERS =
  /refus|unregist|HAND-001|not (?:regist|support)|does not exist|out of scope|amplifier(?:'s|'| itself)|adapted|instead|no equivalent|non-goal/i

for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  for (const shape of ['hexagon', 'tripleoctagon', 'house']) {
    const idx = text.toLowerCase().indexOf(shape)
    if (idx === -1) continue
    // Check a window around every occurrence, not just the first.
    let pos = 0
    let sawUnmarked = false
    const lower = text.toLowerCase()
    while (true) {
      const i = lower.indexOf(shape, pos)
      if (i === -1) break
      const window = text.slice(Math.max(0, i - 200), i + 200)
      if (!SAFE_MARKERS.test(window)) sawUnmarked = true
      pos = i + shape.length
    }
    if (sawUnmarked) {
      fail(`${file}: "${shape}" appears without a nearby refusal/unregistered marker`)
    }
  }
}

// routing-reference.md must state the goal_gate=true-only rule and must not
// imply a broader verdict-eligible node set.
const routingRef = join(HERE, 'routing-reference.md')
if (existsSync(routingRef)) {
  const text = readFileSync(routingRef, 'utf8')
  if (!/goal_gate\s*=\s*['"]?true/.test(text) && !text.includes('goal_gate=true')) {
    fail(`${routingRef}: does not state the goal_gate=true verdict-eligibility rule`)
  }
  if (!text.includes('argv.ts')) {
    fail(`${routingRef}: does not cite argv.ts (wantsVerdict) for the verdict rule`)
  }
  // Flag only an UNQUALIFIED claim that every node gets a verdict/report_outcome
  // -- a claim explaining amplifier's own (different) model, correctly marked
  // as amplifier's, is exactly what this file is supposed to say.
  const badClaim = /every node (?:gets|receives|has) a (?:structured )?(?:verdict|report_outcome)/i
  const m = text.match(badClaim)
  if (m) {
    const i = text.indexOf(m[0])
    const window = text.slice(Math.max(0, i - 150), i)
    if (!/amplifier/i.test(window)) {
      fail(`${routingRef}: unqualified claim "${m[0]}" not attributed to amplifier's (different) model`)
    }
  }
}

// No reference file may restate what a lint code number means -- link to
// README.md#lint-rules instead. Heuristic: a lint-code-shaped token followed
// closely by "means"/"is a"/"fires when" without a link to README.md nearby
// is treated as a restatement.
const LINT_CODE = /\b(TOPO|COND|TYPE|HITL|CMD|RUNS|DATA|GATE|HAND|PAR)-\d{3}\b/g
for (const file of [join(HERE, 'dot-reference.md'), join(HERE, 'routing-reference.md')]) {
  if (!existsSync(file)) continue
  const text = readFileSync(file, 'utf8')
  const matches = [...text.matchAll(LINT_CODE)]
  if (matches.length > 0 && !text.includes('README.md') && !text.includes('Lint rules')) {
    fail(`${file}: mentions a lint code (${matches[0][0]}) but never links to README.md's Lint rules section`)
  }
}

// model_stylesheet/llm_model/llm_provider/DirectProviderBackend/AmplifierBackend/
// PreparedBundle are amplifier-specific and out of scope or nonexistent here --
// naming them to say so (SAFE_MARKERS nearby) is fine; recommending them as if
// they were usable on this engine is not.
const BANNED_TERMS = [
  'model_stylesheet',
  'llm_model',
  'llm_provider',
  'DirectProviderBackend',
  'AmplifierBackend',
  'PreparedBundle',
]
for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  for (const term of BANNED_TERMS) {
    let pos = 0
    let sawUnmarked = false
    while (true) {
      const i = text.indexOf(term, pos)
      if (i === -1) break
      const window = text.slice(Math.max(0, i - 200), i + 200)
      if (!SAFE_MARKERS.test(window)) sawUnmarked = true
      pos = i + term.length
    }
    if (sawUnmarked) fail(`${file}: "${term}" appears without a nearby out-of-scope/nonexistent marker`)
  }
}

// Every relative markdown link ([text](path)) in a checked file must resolve
// to a real path in this repo. Skips absolute URLs (http(s)://, github.com
// citations written as bare text) and anchors (#foo). Links into ../examples/
// are checked separately and only reported as a warning, not a failure --
// p6-02/p6-03 (reference material) intentionally cite example filenames
// p6-07 (worked examples) has not created yet; ADR-019's table is the
// authority on which filenames are the right ones to cite in advance.
const MD_LINK = /\]\(([^)]+)\)/g
const pendingExampleRefs = []
for (const file of FILES) {
  const text = readFileSync(file, 'utf8')
  const dir = dirname(file)
  for (const m of text.matchAll(MD_LINK)) {
    const target = m[1].split('#')[0]
    if (target === '' || /^https?:\/\//.test(target)) continue
    const resolved = resolve(dir, target)
    if (existsSync(resolved)) continue
    if (target.startsWith('../examples/') || target.startsWith('examples/')) {
      pendingExampleRefs.push(`${file} -> ${target}`)
      continue
    }
    fail(`${file}: relative link target does not exist: ${target} (resolved ${resolved})`)
  }
}
if (pendingExampleRefs.length > 0) {
  console.log(
    `NOTE: ${pendingExampleRefs.length} reference-material link(s) point at example files not yet shipped (p6-07's job, tracked against ADR-019's table, not a failure here):`,
  )
  for (const r of pendingExampleRefs) console.log(`  - ${r}`)
}

if (failures > 0) {
  console.error(`\n${failures} consistency check(s) failed.`)
  process.exit(1)
}
console.log(`OK: ${FILES.length} file(s) checked, 0 consistency failures.`)
