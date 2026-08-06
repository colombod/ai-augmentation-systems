import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { evaluateCondition } from '../src/core/condition.ts'

const ok: Outcome = { status: Status.SUCCESS, preferredLabel: 'green' }
const bad: Outcome = { status: Status.FAIL }

test('matches outcome status', () => {
  const c = Context.from({})
  assert.equal(evaluateCondition('outcome=success', c, ok), true)
  assert.equal(evaluateCondition('outcome=success', c, bad), false)
  assert.equal(evaluateCondition('outcome=fail', c, bad), true)
})

test('supports negation', () => {
  const c = Context.from({})
  assert.equal(evaluateCondition('outcome!=fail', c, ok), true)
  assert.equal(evaluateCondition('outcome!=fail', c, bad), false)
})

test('matches preferred_label', () => {
  const c = Context.from({})
  assert.equal(evaluateCondition('preferred_label=green', c, ok), true)
  assert.equal(evaluateCondition('preferred_label=red', c, ok), false)
})

test('matches context keys', () => {
  const c = Context.from({ 'tool.last_line': 'green' })
  assert.equal(evaluateCondition('context.tool.last_line=green', c, ok), true)
  assert.equal(evaluateCondition('context.tool.last_line=red', c, ok), false)
})

test('conjunction requires every clause', () => {
  const c = Context.from({ 'tool.last_line': 'green' })
  assert.equal(
    evaluateCondition('context.tool.last_line=green && outcome=success', c, ok),
    true,
  )
  assert.equal(
    evaluateCondition('context.tool.last_line=green && outcome=fail', c, ok),
    false,
  )
})

test('a missing context key compares as an empty string', () => {
  // Spec section 10.3. This is the loop-guard idiom from the spec's own
  // section 10.6 example: true before loop_state is ever set.
  const c = Context.from({})
  assert.equal(evaluateCondition('context.loop_state!=exhausted', c, ok), true)
  assert.equal(evaluateCondition('context.loop_state=exhausted', c, ok), false)
  assert.equal(evaluateCondition('context.missing=', c, ok), true, 'equals empty')
})

test('an unqualified key resolves from context', () => {
  // Spec section 10.4: direct context lookup for unqualified keys.
  const c = Context.from({ tests_passed: 'true' })
  assert.equal(evaluateCondition('tests_passed=true', c, ok), true)
})

test('a context-prefixed key tries the literal key first', () => {
  // Spec section 10.4 tries `context.foo` before falling back to `foo`.
  const c = Context.from({ 'context.weird': 'yes', weird: 'no' })
  assert.equal(evaluateCondition('context.weird=yes', c, ok), true)
})

test('a bare key is a truthiness check', () => {
  // Spec section 10.5.
  assert.equal(evaluateCondition('context.ready', Context.from({ ready: 'x' }), ok), true)
  assert.equal(evaluateCondition('context.ready', Context.from({ ready: '' }), ok), false)
  assert.equal(evaluateCondition('context.ready', Context.from({}), ok), false)
})

test('a quoted literal is unquoted before comparison', () => {
  assert.equal(evaluateCondition('outcome="success"', Context.from({}), ok), true)
})

test('outcome and preferred_label still resolve', () => {
  assert.equal(evaluateCondition('outcome=success', Context.from({}), ok), true)
  assert.equal(evaluateCondition('preferred_label=green', Context.from({}), ok), true)
})

test('there is still no disjunction', () => {
  // Spec section 10.7 asks implementations not to add operators. A `||` is
  // literal text in the value, so the clause simply does not match.
  assert.equal(evaluateCondition('outcome=success || outcome=fail', Context.from({}), ok), false)
})

test('an empty condition is vacuously true', () => {
  assert.equal(evaluateCondition('', Context.from({}), ok), true)
})

test('an unparseable clause with no matching key is a false truthiness check', () => {
  assert.equal(evaluateCondition('garbage', Context.from({}), ok), false)
})

// Whole-branch review: `preferred_label` had two spellings with OPPOSITE
// answers. Spec section 3.2 step 4 writes the context key only when the label
// is non-empty, so it is sticky; the bare spelling read the live Outcome, which
// is empty on a node that offered none. Section 10.4 presents the unprefixed
// form as a convenience alias, so this was a trap: `preferred_label=ship` was
// false at the exact moment `context.preferred_label=ship` was true.
//
// Stickiness is kept -- it is spec-mandated, it is doctrine (the stale-label
// rule), and engine.test.ts pins it end to end. The bare form now applies the
// same "last non-empty wins" rule instead of a different one.
test('both spellings of preferred_label answer the same (sticky, last non-empty)', () => {
  const sticky = Context.from({ preferred_label: 'ship' })
  const quiet: Outcome = { status: Status.SUCCESS }
  for (const spelling of ['preferred_label', 'context.preferred_label']) {
    assert.equal(
      evaluateCondition(`${spelling}=ship`, sticky, quiet),
      true,
      `${spelling} must see the sticky label a node that offered none did not clear`,
    )
    assert.equal(evaluateCondition(`${spelling}=drop`, sticky, quiet), false)
  }
})

// The previous version of this test set the context key and the live label to
// the SAME value, so both sources gave the same answer and the precedence rule
// it claimed to pin was unpinned: inverting the precedence in `resolveKey` left
// the whole suite green. The values differ here, which is what makes it a test.
//
// Only the BARE spelling is asserted, deliberately. `context.preferred_label`
// is governed by section 10.4's literal-first rule and reads the context key,
// so in THIS state -- a sticky value disagreeing with a non-empty live label --
// the two spellings do differ. That state is not reachable through the engine:
// `recordOutcome` writes a non-empty live label to context immediately before
// edge selection, so whenever the live label is non-empty the context key
// already equals it. The agreement claim is scoped to engine-reachable states
// and is pinned end to end by the same-graph-both-spellings test in
// engine.test.ts; this one pins the resolution rule underneath it.
test('a live non-empty preferred_label wins over a disagreeing sticky one', () => {
  const stale = Context.from({ preferred_label: 'stale' })
  const loud: Outcome = { status: Status.SUCCESS, preferredLabel: 'fresh' }
  assert.equal(evaluateCondition('preferred_label=fresh', stale, loud), true, 'live wins')
  assert.equal(evaluateCondition('preferred_label=stale', stale, loud), false, 'not the sticky one')
})

// The `live !== ''` half of the same rule, which was also unpinned. An EMPTY
// live label is not "a label that won"; it is a node that offered none, and
// section 3.2 step 4's stickiness must show through it. This is a producible
// state, not a theoretical one: `backend/result.ts` maps a verdict's
// `preferred_label: ""` straight to `preferredLabel: ''`, so a goal gate
// returning an empty string reaches here.
test('an EMPTY live preferred_label falls through to the sticky one', () => {
  const sticky = Context.from({ preferred_label: 'ship' })
  const empty: Outcome = { status: Status.SUCCESS, preferredLabel: '' }
  assert.equal(evaluateCondition('preferred_label=ship', sticky, empty), true)
  assert.equal(evaluateCondition('preferred_label=', sticky, empty), false, 'not the empty label')
  // And with nothing sticky either, an empty live label is still the empty
  // string rather than undefined -- spec section 10.3.
  assert.equal(evaluateCondition('preferred_label=', Context.from({}), empty), true)
})

test('outcome agrees across spellings because the engine writes it unconditionally', () => {
  // The asymmetry that made `outcome` immune: recordOutcome sets it on every
  // status, with no "if not empty" clause, immediately before edge selection.
  const ctx = Context.from({ outcome: 'fail' })
  const failed: Outcome = { status: Status.FAIL }
  for (const spelling of ['outcome', 'context.outcome']) {
    assert.equal(evaluateCondition(`${spelling}=fail`, ctx, failed), true)
  }
})
