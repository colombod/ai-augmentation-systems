import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { selectEdge } from '../src/core/edge-select.ts'

const G = parseDot(`
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram]
  b [shape=box]
  c [shape=box]
  start -> a
  a -> done [condition="context.tool.last_line=green && outcome=success"]
  a -> b    [condition="outcome=fail"]
  b -> c    [label="iterate"]
  b -> done [label="ship"]
}
`)

const WEIGHTED = parseDot(`
digraph W {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box]
  zeta [shape=box]
  alpha [shape=box]
  start -> a
  a -> zeta  [weight=5]
  a -> alpha [weight=5]
  zeta -> done
  alpha -> done
}
`)

test('condition match wins first', () => {
  const ctx = Context.from({ 'tool.last_line': 'green' })
  const e = selectEdge(G, 'a', ctx, { status: Status.SUCCESS })
  assert.equal(e?.to, 'done')
})

test('failure routes only along an explicit fail edge', () => {
  const ctx = Context.from({ 'tool.last_line': 'green' })
  const e = selectEdge(G, 'a', ctx, { status: Status.FAIL })
  assert.equal(e?.to, 'b')
})

test('preferred label selects among unconditional edges', () => {
  const ctx = Context.from({})
  const e = selectEdge(G, 'b', ctx, { status: Status.SUCCESS, preferredLabel: 'ship' })
  assert.equal(e?.to, 'done')
})

test('preferred label matching is case and space insensitive', () => {
  const ctx = Context.from({})
  const e = selectEdge(G, 'b', ctx, { status: Status.SUCCESS, preferredLabel: '  SHIP ' })
  assert.equal(e?.to, 'done')
})

test('accelerator prefixes in labels are ignored when matching', () => {
  const g = parseDot(`
    digraph A {
      start [shape=Mdiamond]
      done [shape=Msquare]
      x [shape=box]
      gate [shape=hexagon]
      start -> gate
      gate -> x    [label="[A] Abandon"]
      gate -> done [label="[C] Continue"]
      x -> done
    }
  `)
  const e = selectEdge(g, 'gate', Context.from({}), {
    status: Status.SUCCESS,
    preferredLabel: 'Abandon',
  })
  assert.equal(e?.to, 'x')
})

test('suggested next ids are honoured after labels', () => {
  // `done` is chosen ONLY by the suggestion: the weight/lexical fallback
  // would otherwise pick `c`, so this test fails if step 3 is removed.
  const ctx = Context.from({})
  const e = selectEdge(G, 'b', ctx, { status: Status.SUCCESS, suggestedNextIds: ['done'] })
  assert.equal(e?.to, 'done')
})

test('a preferred label outranks a suggested next id', () => {
  const ctx = Context.from({})
  const e = selectEdge(G, 'b', ctx, {
    status: Status.SUCCESS,
    preferredLabel: 'iterate',
    suggestedNextIds: ['done'],
  })
  assert.equal(e?.to, 'c', 'label wins; the suggestion is only consulted if no label matches')
})

test('a matching condition ends the cascade; a preferred label does not override it', () => {
  // Spec section 3.3 step 1 RETURNs. Steps 2 and 3 are scoped to unconditional
  // edges and only run "if no condition-matching edges were found".
  const g = parseDot(`
    digraph L {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  x [shape=box]  y [shape=box]
      start -> a
      a -> x [condition="outcome=success", label="left", weight=9]
      a -> y [condition="outcome=success", label="right", weight=1]
      x -> done  y -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'right' })
  assert.equal(e?.to, 'x', 'weight decides among matching conditions; the label does not')
})

test('suggested next ids are honoured in list order', () => {
  // Spec section 3.3 step 3 iterates the caller's list, so its ranking wins.
  const g = parseDot(`
    digraph S {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  p [shape=box]  q [shape=box]
      start -> a
      a -> p [weight=1]
      a -> q [weight=9]
      p -> done  q -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), {
    status: Status.SUCCESS, suggestedNextIds: ['p', 'q'],
  })
  assert.equal(e?.to, 'p', 'first suggestion wins over higher weight')
})

test('label normalization strips accelerators, not descriptions', () => {
  // Spec section 3.3: strip "[Y] ", "Y) ", "Y - " prefixes.
  const g = parseDot(`
    digraph A2 {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=hexagon]  x [shape=box]
      start -> gate
      gate -> x    [label="A - Approve"]
      gate -> done [label="R) Reject"]
      x -> done
    }
  `)
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Approve' })?.to, 'x')
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Reject' })?.to, 'done')
})

test('a description after a dash is part of the label', () => {
  // Round-1 review: the single-edge version of this test still passed under
  // the old dash-truncating normaliseLabel, because both the edge label and
  // the preferred label truncate to the same "abandon" and happen to land on
  // the same (only) candidate. Two sibling edges sharing the "Abandon" prefix
  // but differing after the dash force a real divergence: the old
  // implementation collapses both to "abandon" and can only ever pick the
  // first-declared one, while the fix must pick the one whose full label,
  // dash and all, matches.
  const g = parseDot(`
    digraph D {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=hexagon]  x [shape=box]  y [shape=box]
      start -> gate
      gate -> x    [label="Abandon - keep the postmortem"]
      gate -> y    [label="Abandon - discard it"]
      gate -> done [label="Continue"]
      x -> done  y -> done
    }
  `)
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Abandon - keep the postmortem' })?.to, 'x',
    'the description distinguishes this label from a same-prefix sibling')
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Abandon - discard it' })?.to, 'y',
    'the description distinguishes this label from a same-prefix sibling')
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Abandon' })?.to, 'done',
    'the bare prefix alone must not match either full-description label')
})

test('an empty condition string counts as unconditional', () => {
  // Spec section 3.3 discriminates on emptiness, not presence.
  const g = parseDot(`
    digraph E {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  b [shape=box]
      start -> a
      a -> b    [condition="", label="plain"]
      a -> done [label="other"]
      b -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'plain' })
  assert.equal(e?.to, 'b', 'an empty condition must not exclude the edge from step 2')
})

test('a preferred label match picks the first declared edge, not the highest weight', () => {
  // Spec section 3.3 step 2: "find the FIRST unconditional edge whose label
  // matches" -- declaration order, not weight. Round-1 review: mutating
  // `unconditional.find(...)` back to `.filter(...).sort(byWeightThenTarget)[0]`
  // left all 18 prior tests green, because every label fixture had at most
  // one matching unconditional edge. This fixture has two, with the
  // later-declared edge carrying the higher weight, so the two
  // implementations disagree.
  const g = parseDot(`
    digraph DeclOrder {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=hexagon]  first [shape=box]  second [shape=box]
      start -> gate
      gate -> first  [label="go", weight=1]
      gate -> second [label="go", weight=9]
      first -> done  second -> done
    }
  `)
  const e = selectEdge(g, 'gate', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'go' })
  assert.equal(e?.to, 'first', 'declaration order wins; the later, heavier edge must not')
})

test('a whitespace-only condition string counts as unconditional', () => {
  // Same defect class as `condition=""`: the parser preserves whitespace
  // verbatim, and evaluateCondition('   ') trims to empty and returns true,
  // so an untrimmed isConditional check would wrongly treat this as a
  // matching condition and short-circuit step 1.
  const g = parseDot(`
    digraph WS {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  wrong [shape=box]
      start -> a
      a -> wrong [condition="   ", label="wrong"]
      a -> done  [label="right"]
      wrong -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'right' })
  assert.equal(e?.to, 'done', 'a whitespace-only condition must not win step 1 and hide the real unconditional match')
})

test('a whitespace-only condition does not carry a FAIL forward', () => {
  // The sharper version of the above: on a FAIL outcome, condition="" is
  // correctly unconditional and so cannot carry the failure forward
  // (fail-fast). A condition of only whitespace must behave identically --
  // same author intent (no real condition), and the previous author intent
  // must not flip to "carries FAIL forward" just because of stray spaces.
  const g = parseDot(`
    digraph WSFail {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]
      start -> a
      a -> done [condition="   "]
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.FAIL })
  assert.equal(e, null, 'a whitespace-only condition is unconditional; fail-fast forbids it carrying FAIL forward')
})

test('a condition="" edge does not short-circuit the cascade past a real unconditional match', () => {
  // The previous test alone is a weak mutation target: with only one
  // condition-bearing edge in the graph, treating condition="" as
  // condition-matching happens to select the same edge that step 2 would
  // have picked anyway, so that test still passes if `=== undefined` comes
  // back. This test forces a genuine divergence: if condition="" is (wrongly)
  // classified as conditional, step 1 returns `wrong` immediately and step 2
  // never runs, so the preferred label on `done` is never consulted.
  const g = parseDot(`
    digraph E2 {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  wrong [shape=box]
      start -> a
      a -> wrong [condition="", label="wrong"]
      a -> done  [label="right"]
      wrong -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'right' })
  assert.equal(e?.to, 'done', 'condition="" must not win step 1 and hide the real unconditional match')
})

test('higher weight wins among unconditional edges', () => {
  const g = parseDot(`
    digraph W2 {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      alpha [shape=box]
      zeta  [shape=box]
      start -> a
      a -> alpha [weight=1]
      a -> zeta  [weight=7]
      alpha -> done
      zeta -> done
    }
  `)
  // Lexical order alone would pick `alpha`; weight must override it.
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS })
  assert.equal(e?.to, 'zeta')
})

test('a non-numeric weight counts as zero instead of poisoning the sort', () => {
  const g = parseDot(`
    digraph W3 {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      alpha [shape=box]
      zeta  [shape=box]
      start -> a
      a -> zeta  [weight=heavy]
      a -> alpha [weight=2]
      alpha -> done
      zeta -> done
    }
  `)
  // NaN from the bad weight would make ordering depend on declaration order.
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS })
  assert.equal(e?.to, 'alpha', 'the real numeric weight must win')
})

test('equal weights fall back to lexical target order', () => {
  const e = selectEdge(WEIGHTED, 'a', Context.from({}), { status: Status.SUCCESS })
  assert.equal(e?.to, 'alpha')
})

test('fail with no explicit failure edge selects nothing', () => {
  const e = selectEdge(WEIGHTED, 'a', Context.from({}), { status: Status.FAIL })
  assert.equal(e, null)
})

test('a node with no outgoing edges selects nothing', () => {
  const e = selectEdge(G, 'done', Context.from({}), { status: Status.SUCCESS })
  assert.equal(e, null)
})
