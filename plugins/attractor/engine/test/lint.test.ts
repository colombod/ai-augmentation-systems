import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { lint, hasErrors, Severity } from '../src/dot/lint.ts'
import {
  Handler,
  INFERRED_OUTPUTS_BY_HANDLER,
  UNREGISTERED_HANDLER_KINDS,
  findConvergenceNode,
  findPartialReconvergence,
  type Graph,
  type Node,
} from '../src/dot/graph.ts'
import { PASSTHROUGH_KINDS, RUNS_ON_MODES, defaultHandlers } from '../src/core/engine.ts'
import { StubBackend } from '../src/handlers/stub.ts'

function codes(src: string): string[] {
  return lint(parseDot(src)).map((d) => d.code)
}

const GOOD = `
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work  [shape=box, prompt="do it"]
  start -> work -> done
}
`

test('a well formed graph produces no diagnostics', () => {
  const diags = lint(parseDot(GOOD))
  assert.deepEqual(diags, [])
  assert.equal(hasErrors(diags), false)
})

test('TOPO-001 fires when there is no start node', () => {
  assert.ok(codes(`digraph G { done [shape=Msquare]\n a [shape=box]\n a -> done }`).includes('TOPO-001'))
})

test('TOPO-002 fires when there are two exit nodes', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    d1 [shape=Msquare]
    d2 [shape=Msquare]
    start -> d1
    start -> d2
  }`
  assert.ok(codes(src).includes('TOPO-002'))
})

test('TOPO-004 fires for an unreachable node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    orphan [shape=box]
    start -> done
  }`
  assert.ok(codes(src).includes('TOPO-004'))
})

// F14: `reachableFrom` follows `retry_target`/`fallback_retry_target` -- a
// first-class routing mechanism (spec sections 3.4, 3.7), not merely a DOT
// edge -- because the engine genuinely traverses it at run time. The four
// tests below pin that fix directly, at the lint layer, rather than relying
// entirely on the 11 `engine.test.ts` fixtures whose primary purpose is
// pinning engine routing/retry behaviour, not lint correctness.

test('TOPO-004 does not fire for a node reachable only via a node-level retry_target, with a goal gate present', () => {
  // `fix` has no incoming DOT edge -- `a`'s retry_target is its only route
  // in, and section 3.7's node-level failure ladder is unconditional (it
  // does not require a goal gate anywhere in the graph), so this must not
  // fire regardless of the guard finding 1 added to the GRAPH-level rungs.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=box, goal_gate=true, prompt="judge"]
    a [shape=box, prompt="x", retry_target="fix"]
    fix [shape=box, prompt="repair"]
    start -> gate -> a -> done
  }`
  assert.ok(!codes(src).includes('TOPO-004'))
})

// F14 finding 1's own repro, directly: `orphan` is reachable only via the
// GRAPH-level retry_target, and this graph declares NO goal_gate=true node
// anywhere. Per D7 (ADR-003) and `engine.ts`'s `gateRetryTarget`, the
// graph-level retry_target/fallback_retry_target is consulted ONLY by an
// unsatisfied goal gate's exit check -- with no gate in the graph, nothing
// ever reads this attribute, so `orphan` is genuinely unreachable at
// runtime and TOPO-004 must fire. Before finding 1's fix, `reachableFrom`
// seeded the graph-level target unconditionally and this case produced NO
// TOPO-004 at all -- this is the test that would have caught it.
test('TOPO-004 still fires for a node reachable only via a graph-level retry_target when no goal gate is present (F14 finding 1)', () => {
  const src = `digraph G {
    graph [retry_target="orphan"]
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box, prompt="x"]
    orphan [shape=box, prompt="unreachable"]
    start -> a -> done
  }`
  assert.ok(codes(src).includes('TOPO-004'))
})

// The other direction of the same guard: with a goal_gate=true node present,
// the graph-level retry_target IS a live route (section 3.4's exit ladder),
// so `orphan` must not be flagged. Paired with the test immediately above so
// the guard is proven in both directions, not just the one finding 1 named.
test('TOPO-004 does not fire for a node reachable only via a graph-level retry_target when a goal gate is present', () => {
  const src = `digraph G {
    graph [retry_target="orphan"]
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=box, goal_gate=true, prompt="judge"]
    orphan [shape=box, prompt="unreachable"]
    start -> gate -> done
  }`
  assert.ok(!codes(src).includes('TOPO-004'))
})

// `graph.nodes.has(target)` guards both retry_target/fallback_retry_target
// expansions above against a value naming a node that was never declared.
// A genuinely unreachable `orphan` sits alongside the bogus reference so this
// test has an observable claim beyond "did not throw": if a phantom id ever
// corrupted the BFS (an infinite loop, a swallowed exception, a `seen` set
// that stopped meaning what TOPO-004 assumes it means) a real unreachable
// node would stop being caught. Note for a future reader: removing the
// `graph.nodes.has()` guard specifically does NOT make this test fail today
// -- confirmed by mutation -- because TOPO-004's own loop only ever
// consults `graph.nodes.values()`, so a phantom id sitting in `seen` is
// inert output-wise. The guard stays as cheap defensive symmetry with the
// graph-level block above and because `seen`'s invariant ("every member is
// a real node id") is worth keeping for whatever next reads this function's
// return value, but this test's job is the property that IS observable:
// lint() does not throw, does not mention the phantom id anywhere, and does
// not lose track of `orphan`.
test('a retry_target naming a nonexistent node does not crash lint, mention the phantom id, or suppress a real TOPO-004 elsewhere', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box, prompt="x", retry_target="does_not_exist"]
    orphan [shape=box, prompt="genuinely unreachable"]
    start -> a -> done
  }`
  const diags = lint(parseDot(src))
  assert.ok(!diags.some((d) => d.node === 'does_not_exist' || d.message.includes('does_not_exist')))
  assert.ok(
    diags.some((d) => d.code === 'TOPO-004' && d.node === 'orphan'),
    'a real unreachable node in the same graph must still be caught',
  )
})

test('TOPO-005 fires for an edge into start', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    a [shape=box]
    start -> a -> done
    a -> start
  }`
  assert.ok(codes(src).includes('TOPO-005'))
})

// F3: neither section 7.2's built-in lint rule table nor the section 11.2
// checklist mentions a dead-end rule at all, and the engine's OWN runtime
// (`Engine.run`, `core/engine.ts`) already refuses to treat a dead end as
// success: it halts with a loud FAIL whose message names the node ("... which
// has no outgoing edges and is not the exit"), so the safety property TOPO-006
// exists for is already guaranteed independently of lint. TOPO-006 is
// downgraded to WARNING to match the severity discipline DATA-001 and
// GATE-001 established: a design-time hint stays useful, but does not refuse
// to execute a graph the spec itself would accept and the engine itself
// handles safely. See `engine.test.ts`'s "a dead-end node fails the run
// instead of reporting silent success" for the runtime half of this argument.
test('TOPO-006 fires (at WARNING, not ERROR) for a non-exit node with no outgoing edges', () => {
  // Same shape as the whole-branch review reproduction: `a` dead-ends and
  // `zgate` (a goal gate) is never reached. Lint still catches this statically
  // as a hint, even though the engine's runtime is what actually guarantees
  // the goal gate is never silently bypassed.
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    a     [shape=box, prompt="x"]
    zgate [shape=box, goal_gate=true, prompt="judge"]
    start -> a
    start -> zgate
    zgate -> done
  }`
  const diags = lint(parseDot(src))
  const topo006 = diags.find((d) => d.code === 'TOPO-006')
  assert.ok(topo006, 'TOPO-006 present')
  assert.equal(topo006?.severity, Severity.WARNING)
  assert.equal(topo006?.node, 'a')
})

test('TOPO-006 does not fire for the exit node itself', () => {
  assert.ok(!codes(GOOD).includes('TOPO-006'))
})

// The point of downgrading: a graph containing only a dead end must not be
// refused execution by hasErrors(), because nothing in the spec requires
// refusing it and the engine's runtime already fails the run loudly and
// correctly if that dead end is ever reached.
test('TOPO-006 alone does not set hasErrors -- a dead end no longer refuses the run at lint time', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    a     [shape=box, prompt="x"]
    start -> a
    start -> done
  }`
  const diags = lint(parseDot(src))
  assert.deepEqual(diags.map((d) => d.code), ['TOPO-006'])
  assert.equal(hasErrors(diags), false)
})

test('HITL-002 fires when goal_gate is not the exact string "true"', () => {
  // Runtime matching is an exact-string comparison against 'true'; "TRUE" or
  // "1" reads as a passing gate to a human author but silently disables the
  // fail-closed feature at runtime.
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    gate  [shape=box, goal_gate="TRUE", prompt="judge"]
    start -> gate -> done
  }`
  const diags = lint(parseDot(src))
  const hitl002 = diags.find((d) => d.code === 'HITL-002')
  assert.ok(hitl002, 'HITL-002 present')
  assert.equal(hitl002?.severity, Severity.ERROR)
  assert.equal(hitl002?.node, 'gate')
})

test('HITL-002 fires when goal_gate sits on a shape with no evidence-producing handler', () => {
  // diamond is served by PassthroughHandler: a no-op returning SUCCESS with
  // zero evidence would satisfy the gate unconditionally.
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    a     [shape=box]
    gate  [shape=diamond, goal_gate=true]
    start -> a -> gate -> done
  }`
  const diags = lint(parseDot(src))
  const hitl002 = diags.find((d) => d.code === 'HITL-002')
  assert.ok(hitl002, 'HITL-002 present')
  assert.equal(hitl002?.severity, Severity.ERROR)
  assert.equal(hitl002?.node, 'gate')
})

test('HITL-002 does not fire for goal_gate=true on box or parallelogram', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    a     [shape=box, goal_gate=true]
    b     [shape=parallelogram, goal_gate=true, tool_command="printf ok"]
    start -> a -> b -> done
  }`
  assert.ok(!codes(src).includes('HITL-002'))
})

// F2: the spec's own attribute table (Appendix A / section 2.6) types
// `goal_gate` as Boolean with default `false`, and section 2.4 defines the
// Boolean syntax as the literal keywords `true` and `false` -- nothing else.
// A node written `goal_gate=false` is spec-legal and, at runtime,
// `wantsVerdict` (`backend/argv.ts`) correctly reads it as "not a gate" --
// the exact spec default. HITL-002 must not refuse it.
test('HITL-002 does not fire for goal_gate=false (spec-legal Boolean, matches the default)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    gate  [shape=box, goal_gate=false, prompt="judge"]
    start -> gate -> done
  }`
  assert.ok(!codes(src).includes('HITL-002'))
})

// The near-miss case HITL-002 exists to catch must still be caught: "false"
// is the one other spec-legal Boolean literal, but a value that is neither
// "true" nor "false" is exactly the silent-disable hazard the rule is for.
test('HITL-002 still fires for goal_gate values that are neither "true" nor "false"', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    gate  [shape=box, goal_gate="1", prompt="judge"]
    start -> gate -> done
  }`
  const diags = lint(parseDot(src))
  const hitl002 = diags.find((d) => d.code === 'HITL-002')
  assert.ok(hitl002, 'HITL-002 present')
  assert.equal(hitl002?.severity, Severity.ERROR)
  assert.equal(hitl002?.node, 'gate')
})

// The shape restriction (the rule's second check) must survive goal_gate=false
// being accepted: it is a DIFFERENT check, gated on goal_gate actually being
// "true", and must not be weakened by the first check's fix.
test('HITL-002 shape restriction is unaffected by the goal_gate=false fix', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done  [shape=Msquare]
    a     [shape=box]
    gate  [shape=diamond, goal_gate=true]
    start -> a -> gate -> done
  }`
  assert.ok(codes(src).includes('HITL-002'))
})

test('HITL-001 fires for a timeout with no declared fallback', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    gate [shape=hexagon, timeout="4h"]
    start -> gate -> done
  }`
  const diags = lint(parseDot(src))
  const hitl = diags.find((d) => d.code === 'HITL-001')
  assert.ok(hitl, 'HITL-001 present')
  assert.equal(hitl?.severity, Severity.ERROR)
})

test('HITL-001 is satisfied by on_timeout naming a real outgoing label', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    stop [shape=box]
    gate [shape=hexagon, timeout="4h", on_timeout="Abandon"]
    start -> gate
    gate -> done [label="Continue"]
    gate -> stop [label="Abandon"]
    stop -> done
  }`
  assert.ok(!codes(src).includes('HITL-001'))
})

test('HITL-001 fires when on_timeout names a label no edge carries', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    gate [shape=hexagon, timeout="4h", on_timeout="Nope"]
    start -> gate
    gate -> done [label="Continue"]
  }`
  assert.ok(codes(src).includes('HITL-001'))
})

// F9: section 6.5 names `human.default_choice`, not `on_timeout`, as the
// node attribute that "specifies which edge target to select" on a human
// gate's timeout -- the identical purpose HITL-001 was checking `on_timeout`
// for. A graph written exactly to the spec's own wording must not be refused.
test('HITL-001 is satisfied by human.default_choice naming a real outgoing label (spec section 6.5)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    stop [shape=box]
    gate [shape=hexagon, timeout="4h", human.default_choice="Abandon"]
    start -> gate
    gate -> done [label="Continue"]
    gate -> stop [label="Abandon"]
    stop -> done
  }`
  assert.ok(!codes(src).includes('HITL-001'))
})

test('HITL-001 fires when human.default_choice names a label no edge carries', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    gate [shape=hexagon, timeout="4h", human.default_choice="Nope"]
    start -> gate
    gate -> done [label="Continue"]
  }`
  assert.ok(codes(src).includes('HITL-001'))
})

// The safety property must survive: with NEITHER attribute present, a timeout
// is still refused. This is the same fixture as "fires for a timeout with no
// declared fallback" above, restated here to anchor it against the F9 fix.
test('HITL-001 still fires when neither on_timeout nor human.default_choice is present', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    gate [shape=hexagon, timeout="4h"]
    start -> gate -> done
  }`
  assert.ok(codes(src).includes('HITL-001'))
})

// selectEdge (core/edge-select.ts) matches a preferred label against an
// edge's label= only after normalising both sides: stripping a leading
// accelerator ("Y) ", "[Y] ", "Y - "), trimming, lowercasing. HITL-001's own
// label-existence check did a raw, unnormalised comparison -- so an
// on_timeout/human.default_choice value written in the normalised form (the
// form an author would naturally write, and the form that WOULD match at
// runtime) was incorrectly refused as "no outgoing edge carries that label"
// whenever the edge's own label= carried an accelerator prefix. Lint and
// runtime disagreeing about what matches is exactly the class of defect this
// project's doctrine treats as serious (spec-conformance.md's C1 finding).
test('HITL-001 accepts on_timeout written in normalised form against an accelerated edge label', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    stop [shape=box]
    gate [shape=hexagon, timeout="4h", on_timeout="Abandon"]
    start -> gate
    gate -> done [label="C) Continue"]
    gate -> stop [label="A) Abandon"]
    stop -> done
  }`
  assert.ok(!codes(src).includes('HITL-001'))
})

test('HITL-001 accepts human.default_choice differing from an edge label only by case', () => {
  const src = `digraph G {
    start [shape=Mdiamond]
    done [shape=Msquare]
    stop [shape=box]
    gate [shape=hexagon, timeout="4h", human.default_choice="abandon"]
    start -> gate
    gate -> done [label="Continue"]
    gate -> stop [label="Abandon"]
    stop -> done
  }`
  assert.ok(!codes(src).includes('HITL-001'))
})

// The shell rules are exercised against directly-constructed graphs rather
// than DOT source: these commands are full of quotes, and DOT escaping would
// obscure what is actually being tested. It also makes TOPO-003 reachable,
// which parseDot cannot produce because it back-fills edge-only nodes.
function graphWith(cmd: string): Graph {
  const nodes = new Map<string, Node>([
    ['start', { id: 'start', attrs: { shape: 'Mdiamond' }, handler: Handler.START }],
    [
      'g',
      { id: 'g', attrs: { shape: 'parallelogram', tool_command: cmd }, handler: Handler.TOOL },
    ],
    ['done', { id: 'done', attrs: { shape: 'Msquare' }, handler: Handler.EXIT }],
  ])
  return {
    name: 'T',
    attrs: {},
    nodes,
    edges: [
      { from: 'start', to: 'g', attrs: {} },
      { from: 'g', to: 'done', attrs: {} },
    ],
  }
}

function cmdCodes(cmd: string): string[] {
  return lint(graphWith(cmd)).map((d) => d.code)
}

test('TOPO-003 fires when an edge names a node the graph does not have', () => {
  const g = graphWith('printf ok')
  g.edges.push({ from: 'g', to: 'ghost', attrs: {} })
  assert.ok(lint(g).map((d) => d.code).includes('TOPO-003'))
})

test('CMD-001 fires when a command pipes into a filter without pipefail', () => {
  assert.ok(cmdCodes('make test | tail -5').includes('CMD-001'))
})

test('CMD-001 is silenced by set -o pipefail, including clustered flags', () => {
  assert.ok(!cmdCodes('set -o pipefail; make test | tail -5').includes('CMD-001'))
  assert.ok(!cmdCodes('set -eo pipefail; make test | tail -5').includes('CMD-001'))
})

test('the word pipefail in unrelated text does NOT silence CMD-001', () => {
  assert.ok(
    cmdCodes('curl https://example.com/pipefail-notes.txt | tail -5').includes('CMD-001'),
    'a bare substring match would wrongly suppress this',
  )
})

test('CMD-001 ignores a pipe inside command substitution', () => {
  // The pipeline feeds a string into a variable; its exit status routes nothing.
  assert.ok(!cmdCodes('sig=$(tail -20 log | md5sum | cut -d" " -f1); printf ok').includes('CMD-001'))
})

test('CMD-001 ignores a pipeline ending in a predicate filter', () => {
  // grep -q IS the test being performed, not a masked failure.
  assert.ok(!cmdCodes('git log --oneline -1 | grep -q . && printf shipped || printf dirty').includes('CMD-001'))
})

test('CMD-002 fires for a sentinel chained with &&', () => {
  assert.ok(cmdCodes('make test | tail -5 && printf ok').includes('CMD-002'))
})

test('CMD-002 fires for a sentinel after a semicolon', () => {
  assert.ok(cmdCodes('make test | tail -5; printf ok').includes('CMD-002'))
})

test('CMD-002 does not fire when the pipeline status is deliberately captured', () => {
  assert.ok(!cmdCodes('make test | tail -5; rc=$?; printf ok').includes('CMD-002'))
})

test('the canonical task-runner commands lint clean', () => {
  // Regression fixtures taken from examples/patterns/task-runner.dot. These
  // are correct code; an earlier rule set flagged all three, and CMD-002's
  // ERROR severity would have made the flagship pipeline unrunnable.
  const triage =
    'sig=$(tail -20 .ai/verify.log 2>/dev/null | sed -E "s|/tmp/[A-Za-z0-9._-]+|TMPPATH|g" | md5sum | cut -d" " -f1); prev=$(cat .ai/last-fail-sig 2>/dev/null || echo none); printf novel'
  const verdict =
    'grep -E "^VERDICT:" .ai/critique.md | tail -1 | grep -q "SHIP"; ok=$?; printf ship'
  const shipCheck =
    '[ -z "$(git status --porcelain | grep -v -E "^\\?\\? \\.ai")" ] && git log --oneline -1 | grep -q . && printf shipped || printf dirty'

  for (const [name, cmd] of [['triage', triage], ['verdict', verdict], ['ship_check', shipCheck]]) {
    assert.deepEqual(cmdCodes(cmd), [], `${name} must lint clean`)
  }
})

test('COND-001 rejects a malformed condition', () => {
  // Missing `=`: "outcome success" is not a single identifier, so as a bare
  // truthiness check it would look up a context key that can never exist
  // and silently evaluate false forever, rather than failing loudly.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="outcome success"]
  }`
  const diags = lint(parseDot(src))
  const cond001 = diags.find((d) => d.code === 'COND-001')
  assert.ok(cond001, 'COND-001 present')
  assert.equal(cond001?.severity, Severity.ERROR)
  assert.equal(cond001?.node, 'a')
})

test('COND-001 accepts every valid clause form', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]  b [shape=box]  c [shape=box]
    start -> a
    a -> b    [condition="outcome=success && context.k!=v"]
    a -> c    [condition="context.ready"]
    b -> done [condition="preferred_label=\\"ship\\""]
    c -> done
  }`
  assert.ok(!codes(src).includes('COND-001'))
})

test('COND-001 does not fire for an empty or whitespace-only condition', () => {
  // Spec section 10.7: an empty condition is unconditionally true. This is
  // not "no condition was written", it is a condition that legitimately
  // means "always". Flagging it would contradict the engine's own reading,
  // which `evaluateCondition` and the DOT `edge [...]` default-block idiom
  // both rely on.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="   "]
  }`
  assert.ok(!codes(src).includes('COND-001'))
  const src2 = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition=""]
  }`
  assert.ok(!codes(src2).includes('COND-001'))
})

test('COND-001 does not confuse invalid syntax with a valid condition that is simply false', () => {
  // `outcome=impossible` is syntactically perfect -- key, operator, literal
  // value -- it just never matches because `impossible` is not a real
  // Outcome status. Lint is static: it must not evaluate the condition
  // against any outcome, only parse its shape. Conflating "always false" (a
  // routing decision, none of the linter's business) with "malformed" (the
  // one thing this rule exists to catch) is exactly the trap named in the
  // task brief.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]  dead [shape=Msquare]
    a [shape=box]
    start -> a
    a -> dead [condition="outcome=impossible"]
    a -> done
  }`
  assert.ok(!codes(src).includes('COND-001'))
})

test('COND-001 leaves || inside a value untouched but flags it in a bare clause', () => {
  // Spec section 10.7: `||` is deliberately not an operator. Inside a
  // matched key[!]=value clause the value is unconstrained free text, so a
  // literal "||" there must not be rejected -- that would break a
  // legitimate graph over a character the grammar never claims meaning
  // for. A bare clause with no operator is a different case: at runtime it
  // is looked up as a literal context key, and "a||b" is not a syntactically
  // valid identifier for one, so it is exactly the always-false-typo shape
  // this rule targets -- not because "||" is being treated as disjunction,
  // but because the bare form never accepted anything but a plain identifier.
  const valueSrc = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="context.tag=a||b"]
  }`
  assert.ok(!codes(valueSrc).includes('COND-001'), '|| inside a value must not be rejected')

  const bareSrc = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="a||b"]
  }`
  assert.ok(codes(bareSrc).includes('COND-001'), '|| in a bare clause is not a valid identifier')
})

test('TYPE-001 rejects an unknown type attribute', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [type="not-a-handler"]
    start -> a -> done
  }`
  const diags = lint(parseDot(src))
  const type001 = diags.find((d) => d.code === 'TYPE-001')
  assert.ok(type001, 'TYPE-001 present')
  assert.equal(type001?.severity, Severity.ERROR)
  assert.equal(type001?.node, 'a')
})

test('TYPE-001 accepts every type string the engine resolves', () => {
  // Spec section 2.6's own example: a human gate declared by type rather
  // than shape (`type="wait.human"`, section 2.13). One node per known
  // type, each also carrying the matching shape so the graph is otherwise
  // unremarkable.
  const src = `digraph G {
    start  [shape=Mdiamond]
    done   [shape=Msquare]
    a      [type="codergen", shape=box, prompt="x"]
    b      [type="tool", shape=parallelogram, tool_command="printf ok"]
    c      [type="conditional", shape=diamond]
    gate   [type="wait.human", shape=hexagon]
    par    [type="parallel", shape=component]
    join   [type="parallel.fan_in", shape=tripleoctagon]
    loop   [type="stack.manager_loop", shape=house]
    start -> a -> b -> c -> gate -> par -> join -> loop -> done
  }`
  assert.ok(!codes(src).includes('TYPE-001'))
})

test('TYPE-001 rejects prototype-shaped type values', () => {
  // A bare `TYPE_TO_HANDLER[declared]` lookup (rather than Object.hasOwn)
  // resolves these via Object.prototype and reads as "known" even though
  // handlerForNode does not treat them as known -- the fix round 1 finding.
  // Each must still be flagged, not silently pass through as some prototype
  // member masquerading as a handler.
  for (const declared of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const src = `digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [type="${declared}"]
      start -> a -> done
    }`
    const diags = lint(parseDot(src))
    const type001 = diags.find((d) => d.code === 'TYPE-001')
    assert.ok(type001, `TYPE-001 present for type="${declared}"`)
    assert.equal(type001?.severity, Severity.ERROR)
  }
})

test('COND-001 does not attempt to be quote-aware around a literal && inside a value', () => {
  // Decision, not an accident: a value legitimately containing a literal
  // "&&" inside quotes (e.g. representing shell-like text) gets split
  // mid-literal, exactly as evaluateCondition itself splits it -- both
  // share splitClauses(), so lint inherits the engine's own grammar
  // limitation rather than independently deciding to be smarter about it.
  // The second half here ("b\"") is not a valid identifier, so this DOES
  // fire -- pinned so a future quote-aware split (anticipated in the task
  // report's Concerns) cannot silently change this without a test noticing.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="key=\\"a&&b\\""]
  }`
  assert.ok(
    codes(src).includes('COND-001'),
    'a literal && inside a quoted value is split mid-literal today; this pins that known limitation',
  )
})

// ---------------------------------------------------------------------------
// DATA-001 -- a reference nothing declares.
//
// WARNING, never ERROR. `--param` values arrive at runtime and lint cannot
// see them, so an ERROR here would refuse legitimate graphs -- the CMD-001
// lesson, where an ERROR rule false-positived on the canonical exemplar and
// nearly made the flagship pipeline unrunnable. The runtime eager-input check
// is the load-bearing guard; this is the design-time hint.
// ---------------------------------------------------------------------------

function data001(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'DATA-001')
}

test('DATA-001 fires for a dotted reference no node declares', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build it"]
    ship  [shape=parallelogram, tool_command="deploy \${artifact.path}"]
    start -> build -> ship -> done
  }`
  const found = data001(src)
  assert.equal(found.length, 1, 'exactly one DATA-001')
  assert.equal(found[0].severity, Severity.WARNING, 'WARNING, not ERROR -- see the comment above')
  assert.equal(found[0].node, 'ship')
  assert.match(found[0].message, /artifact\.path/)
  assert.equal(hasErrors(lint(parseDot(src))), false, 'a WARNING must not make the graph unrunnable')
})

test('DATA-001 names the box-node rule, which authors will hit constantly', () => {
  // A box (LLM) node infers NO outputs: a model's contextUpdates keys are
  // arbitrary and are filtered by the engine-managed guard, so there is
  // nothing honest to infer. That is a deliberate design decision, not an
  // oversight, and the diagnostic has to say so or every author who wires a
  // box node's result into a successor reads this warning as a linter bug.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    plan  [shape=box, prompt="write a plan"]
    ship  [shape=parallelogram, tool_command="apply \${plan.summary}"]
    start -> plan -> ship -> done
  }`
  const found = data001(src)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /box/, 'message should name the box node case')
  assert.match(found[0].message, /outputs=/, 'message should name the fix: an explicit outputs=')
})

test('DATA-001 is silenced by an outputs= declaration on any node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build it", outputs="artifact.path"]
    ship  [shape=parallelogram, tool_command="deploy \${artifact.path}"]
    start -> build -> ship -> done
  }`
  assert.deepEqual(data001(src), [])
})

test('DATA-001 distinguishes an undeclared reference from a declared-but-unused output', () => {
  // The two are opposite defects and only one of them is this rule's business.
  // `artifact.sha` is declared and never referenced -- that is a dead
  // declaration, not a missing one, and DATA-001 must stay silent about it.
  // `artifact.pth` is the typo the rule exists to catch.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build", outputs="artifact.path,artifact.sha"]
    ship  [shape=parallelogram, tool_command="deploy \${artifact.path} \${artifact.pth}"]
    start -> build -> ship -> done
  }`
  const found = data001(src)
  assert.equal(found.length, 1, 'only the undeclared reference is a finding')
  assert.match(found[0].message, /artifact\.pth/)
  assert.doesNotMatch(found[0].message, /artifact\.sha/, 'a declared, unreferenced output is not a finding')
})

test('DATA-001 does not fire for engine-managed keys', () => {
  // Derived from ENGINE_MANAGED_KEYS/ENGINE_MANAGED_PREFIXES via
  // isEngineManagedKey, so the built-in set cannot drift from the one the
  // engine writes through and the box handler refuses.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=parallelogram, tool_command="printf '\${tool.last_line} \${graph.goal} \${internal.retry_count.a} \${outcome} \${preferred_label} \${current_node}'"]
    start -> a -> done
  }`
  assert.deepEqual(data001(src), [])
})

test('DATA-001 does not fire for a graph attribute the engine mirrors into context', () => {
  // Engine.run seeds context from every graph attribute under BOTH its bare
  // name and a `graph.`-qualified one, so a dotted graph attribute is a real
  // supplied key even though no node produces it. Read from graph.attrs, the
  // same place the engine reads it.
  const src = `digraph G {
    "release.channel"="beta"
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=parallelogram, tool_command="ship --channel \${release.channel}"]
    start -> a -> done
  }`
  assert.deepEqual(data001(src), [])
})

test('DATA-001 does not fire for an undotted reference, which is plausibly a --param', () => {
  // `--param flavour=vanilla` is invisible to lint. Every --param in this
  // codebase's tests and docs is a flat identifier, and every dataflow key
  // (`artifact.path`, `tool.last_line`, the `outputs=` examples) is dotted.
  // Flagging a flat name would cry wolf on every parameterised pipeline.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=parallelogram, tool_command="build $flavour \${feature}"]
    start -> a -> done
  }`
  assert.deepEqual(data001(src), [])
})

test('DATA-001 scans a box label only when it is actually the prompt', () => {
  // BoxHandler substitutes `attrs.prompt || attrs.label`, so a label IS the
  // prompt when no prompt is set and is dead text otherwise. Scanning it
  // unconditionally would flag decorative labels the engine never expands.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box, label="use \${artifact.path}"]
    b [shape=box, prompt="explicit", label="ignored \${artifact.sha}"]
    start -> a -> b -> done
  }`
  const found = data001(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].node, 'a')
  assert.match(found[0].message, /artifact\.path/)
})

// ---------------------------------------------------------------------------
// DATA-002 -- an `outputs=` declaration naming a key the node cannot own.
//
// ERROR, unlike DATA-001, and the difference is the CLOSED-SET test RUNS-001
// settled: DATA-001 cannot see `--param` keys, so its question is unanswerable
// at design time; the engine-managed and handler-owned key sets are fixed at
// lint time and no runtime input can make declaring one legitimate. `outputs=`
// is also new on this branch, so no pre-existing graph can be refused -- the
// CMD-001 hazard that forces WARNING elsewhere has nothing to bite on.
//
// The reason it matters at all is the ledger: a declaration is what puts a key
// in `failedOutputs` when the node fails, and the eager input check then
// refuses every downstream node referencing it.
// ---------------------------------------------------------------------------

function data002(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'DATA-002')
}

test('DATA-002 refuses a declaration of a handler-owned key, as an ERROR', () => {
  // The verified re-arming of the stale-label contradiction: `notify` exists to
  // report the failure, and this declaration is what blocks it.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build  [shape=parallelogram, tool_command="exit 1", outputs="tool.last_line"]
    notify [shape=parallelogram, tool_command="printf 'said: \${tool.last_line}'"]
    start -> build
    build -> notify [condition="outcome=fail"]
    notify -> done
  }`
  const found = data002(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.ERROR)
  assert.equal(found[0].node, 'build')
  assert.match(found[0].message, /tool\.last_line/)
  assert.ok(hasErrors(lint(parseDot(src))), 'the CLI must refuse this graph')
})

test('DATA-002 refuses a declaration of an engine-managed bare key', () => {
  // `outcome` is written by the engine every single step, and the
  // write-clearing cannot rescue it: engine bookkeeping writes are drained and
  // discarded before dispatch.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build  [shape=parallelogram, tool_command="exit 1", outputs="outcome"]
    report [shape=parallelogram, tool_command="printf 'was $outcome'"]
    start -> build
    build -> report [condition="outcome=fail"]
    report -> done
  }`
  const found = data002(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].node, 'build')
  assert.match(found[0].message, /outcome/)
  assert.match(found[0].message, /engine-managed/)
})

test('DATA-002 refuses every reserved prefix, and reports each bad key once', () => {
  for (const key of ['tool.anything', 'graph.goal', 'internal.retry_count.build']) {
    const src = `digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      build [shape=parallelogram, tool_command="true", outputs="${key}"]
      start -> build -> done
    }`
    const found = data002(src)
    assert.equal(found.length, 1, key)
    assert.match(found[0].message, /engine-managed/)
  }
  const both = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=parallelogram, tool_command="true", outputs="artifact.path, outcome, tool.last_line"]
    start -> build -> done
  }`
  assert.equal(data002(both).length, 2, 'one diagnostic per offending key, and no more')
})

test('DATA-002 stays silent on an author-namespace declaration', () => {
  // The ordinary case, and the one the rule must never touch. `goal` is a bare
  // graph attribute name, deliberately NOT reserved -- that is the author's
  // namespace, recorded as residual R3.
  for (const key of ['artifact.path', 'build.error', 'goal', 'resource.handle']) {
    const src = `digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      build [shape=parallelogram, tool_command="true", outputs="${key}"]
      start -> build -> done
    }`
    assert.deepEqual(data002(src), [], key)
  }
})

test('DATA-002 derives its handler-owned set from the handlers, not a copy', () => {
  // The anti-drift pin. `TOOL_OUTPUT_KEYS` is what `ToolHandler` actually
  // writes, `INFERRED_OUTPUTS_BY_HANDLER` imports it, and this rule reads that
  // table -- so a key added to the handler is refused by DATA-002 the same day,
  // with no third list to update. A hand-copied set would pass this test only
  // by coincidence today and never again.
  const declared = new Set<string>(
    Object.values(INFERRED_OUTPUTS_BY_HANDLER).flatMap((keys) => [...keys]),
  )
  assert.ok(declared.size > 0, 'the set is not vacuous')
  for (const key of declared) {
    const src = `digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      build [shape=box, prompt="work", outputs="${key}"]
      start -> build -> done
    }`
    assert.equal(data002(src).length, 1, `${key} is written by a handler and must be refused`)
  }
})

// ---------------------------------------------------------------------------
// GATE-001 -- a goal gate that does not gate.
// ---------------------------------------------------------------------------

function gate001(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'GATE-001')
}

test('GATE-001 fires when a fail edge reaches the exit without passing a goal gate', () => {
  // Finding I2's shape. The gate sits on the success branch; the failure
  // branch walks straight to the exit, so the gate is never VISITED, section
  // 3.4's check is legitimately empty and section 11.3 reports SUCCESS.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    bail  [shape=box, prompt="report"]
    start -> build
    build -> gate [condition="outcome=success"]
    build -> bail [condition="outcome=fail"]
    gate -> done
    bail -> done
  }`
  const found = gate001(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.WARNING)
  assert.equal(found[0].node, 'build')
  assert.match(found[0].message, /3\.4/, 'message must cite the section that makes the ENGINE correct')
  assert.match(found[0].message, /visited/i, 'message must say gates are checked only on visited nodes')
  assert.match(found[0].message, /gate/)
})

test('GATE-001 does not fire when the failure route returns through the gate', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    fix   [shape=box, prompt="repair"]
    start -> build
    build -> gate [condition="outcome=success"]
    build -> fix  [condition="outcome=fail"]
    fix -> build
    gate -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('GATE-001 does not fire on a graph that declares no goal gate', () => {
  // Nothing is being bypassed. Firing here would warn about every ungated
  // pipeline in existence, which is how a WARNING gets filtered out and
  // becomes worse than absent.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    bail  [shape=box, prompt="report"]
    start -> build
    build -> done [condition="outcome=success"]
    build -> bail [condition="outcome=fail"]
    bail -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('GATE-001 fires for a node-level retry_target that bypasses the gate', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build", retry_target="bail"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    bail  [shape=box, prompt="report"]
    start -> build
    build -> gate [condition="outcome=success"]
    build -> bail [condition="preferred_label=abort"]
    gate -> done
    bail -> done
  }`
  const found = gate001(src)
  assert.equal(found.length, 1, 'the retry_target is the only failure route here')
  assert.equal(found[0].node, 'build')
  assert.match(found[0].message, /retry_target/)
})

test('GATE-001 does not fire for a purely graph-level fallback_retry_target on a non-gate node', () => {
  // Before the D7 fix, a purely graph-level fallback_retry_target with no
  // node-level attribute was treated as a live bypass route for ANY node.
  // Section 3.7's ladder (which this rule mirrors) never consults the
  // graph-level rungs for a plain node's failure -- only section 3.4's
  // goal-gate ladder does -- so this is no longer a route GATE-001 should
  // report.
  const src = `digraph G {
    fallback_retry_target="bail"
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    bail  [shape=box, prompt="report"]
    start -> build
    build -> gate [condition="outcome=success"]
    build -> bail [condition="preferred_label=abort"]
    gate -> done
    bail -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('GATE-001 does not fire when the failure route leaves the gate itself', () => {
  // The gate HAS been visited, and its outcome is non-success, so section
  // 3.4's check blocks the exit. Nothing is bypassed and the run cannot
  // report an unearned success -- flagging it would be a false positive on
  // the single most ordinary way to write a gated abort path.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work [shape=box, prompt="work"]
    gate [shape=box, goal_gate=true, prompt="judge"]
    bail [shape=box, prompt="report"]
    start -> work -> gate
    gate -> done [condition="outcome=success"]
    gate -> bail [condition="outcome=fail"]
    bail -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('GATE-001 does not treat a vacuously-true != guard as a declared failure route', () => {
  // Finding I1's shape, not I2's. `context.build_error!=fatal` is TRUE when
  // nothing writes the key (section 10.3), so it is eligible on SUCCESS as
  // well as on failure -- it is an ordinary edge, not a failure route. The
  // eager input check is what addresses this shape; treating it as a failure
  // route here would fire GATE-001 on every loop-guard idiom in the corpus.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    next  [shape=box, prompt="next"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    start -> build
    build -> next [condition="context.build_error!=fatal"]
    build -> gate [condition="context.build_error=fatal"]
    next -> done
    gate -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('GATE-001 does not treat an unconditional edge as a failure route', () => {
  // Fail-fast doctrine: on a FAIL with no matching condition, no
  // unconditional edge carries the failure forward -- section 3.7 terminates
  // the pipeline instead, so the exit is never reached along this edge.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    start -> build
    build -> done
    build -> gate [condition="outcome=success"]
    gate -> done
  }`
  assert.deepEqual(gate001(src), [])
})

test('COND-001 rejects a hyphenated bare key, which is a real producible key shape', () => {
  // Hyphenated context keys are genuinely reachable: `--param feature-flag=on`
  // splits on the first "=" with no key-format validation, and LLM
  // contextUpdates keys are arbitrary strings. An author can therefore seed
  // a key no condition can ever reference by its bare name (the grammar's
  // identifier charset is letters, digits, "_", "."  -- no hyphen). Before
  // this rule existed that produced a silent always-false clause; COND-001
  // correctly turns it into an ERROR, and the message names the identifier
  // charset so the hyphen is findable rather than just "malformed".
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="feature-flag"]
  }`
  const diags = lint(parseDot(src))
  const cond001 = diags.find((d) => d.code === 'COND-001')
  assert.ok(cond001, 'COND-001 present')
  assert.match(cond001!.message, /"_"|underscore/, 'message should name the identifier charset')
  assert.match(cond001!.message, /hyphen/, 'message should call out the hyphen as an example of what fails')
})

// ---------------------------------------------------------------------------
// RUNS-001 -- an unrecognised `runs_on` value.
//
// ERROR, matching TYPE-001 and HITL-002 rather than DATA-001. The deciding
// difference from DATA-001 is not taste: DATA-001 softens to WARNING because
// `--param` supplies keys at runtime that lint cannot see, so its question is
// unanswerable at design time. The `runs_on` value set is CLOSED and fully
// known at lint time, so there is no false-positive risk to trade against.
// ---------------------------------------------------------------------------

function runs001(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'RUNS-001')
}

const RUNS_ON_TYPO = `digraph G {
  start [shape=Mdiamond]  done [shape=Msquare]
  work    [shape=box, prompt="work"]
  cleanup [shape=parallelogram, runs_on="alwyas", tool_command="release"]
  start -> work
  work -> cleanup
  cleanup -> done
}`

test('RUNS-001 fires on an unrecognised runs_on value, as an ERROR', () => {
  const found = runs001(RUNS_ON_TYPO)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.ERROR)
  assert.equal(found[0].node, 'cleanup')
  assert.match(found[0].message, /alwyas/, 'the message must quote what the author wrote')
  assert.match(found[0].message, /always/, 'and list what the engine accepts')
  assert.match(found[0].message, /falls back/, 'and say what happens instead')
  assert.equal(hasErrors(lint(parseDot(RUNS_ON_TYPO))), true, 'the CLI must refuse this graph')
})

test('RUNS-001 accepts every value the engine recognises', () => {
  // The PERMITTING direction, because a guard tested in one direction only is
  // this project's recurring defect. Read from the engine's own table rather
  // than listed here, so a value added to the engine and not to this test
  // cannot pass by omission.
  for (const mode of Object.keys(RUNS_ON_MODES)) {
    const src = `digraph G {
      start [shape=Mdiamond]  done [shape=Msquare]
      work    [shape=box, prompt="work"]
      cleanup [shape=parallelogram, runs_on="${mode}", tool_command="release"]
      start -> work
      work -> cleanup
      cleanup -> done
    }`
    assert.deepEqual(runs001(src), [], `runs_on="${mode}" was rejected`)
  }
})

test('RUNS-001 does not fire on a node that sets no runs_on at all', () => {
  assert.deepEqual(runs001(GOOD), [])
})

test('RUNS-001 treats an Object.prototype member as unrecognised', () => {
  // `RUNS_ON_MODES['constructor']` resolves through Object.prototype, so a bare
  // index would read this as a known value -- the same hazard `runsOn`,
  // `handlerForNode` and TYPE-001 all use Object.hasOwn to avoid. The two must
  // agree on what "known" means, not merely share the table.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work [shape=box, prompt="work", runs_on="constructor"]
    start -> work -> done
  }`
  assert.equal(runs001(src).length, 1)
})

// ---------------------------------------------------------------------------
// RUNS-002 -- a goal gate carrying a `runs_on` the engine ignores.
//
// A separate rule from RUNS-001 because the severity differs and one code must
// carry one severity: RUNS-001 asks whether a value is recognised (ERROR),
// this asks whether two individually valid attributes contradict each other
// (WARNING, because the engine resolves it fail-closed by running the gate
// anyway AND by keeping its eager input check armed).
//
// It covers `always` as well as `failure`. Before the whole-branch fix,
// `always` on a gate had a real (and dangerous) effect: it switched off the
// eager input check. Now it has none at all, so an author who wrote it is owed
// the same notice as one who wrote `failure`.
// ---------------------------------------------------------------------------

function runs002(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'RUNS-002')
}

test('RUNS-002 warns on a goal gate with runs_on=failure', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work  [shape=box, prompt="work"]
    judge [shape=box, prompt="judge", goal_gate="true", runs_on="failure"]
    start -> work -> judge -> done
  }`
  const found = runs002(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.WARNING)
  assert.equal(found[0].node, 'judge')
  assert.match(found[0].message, /goal gate/)
  assert.match(found[0].message, /no evidence/, 'the message must say why it cannot be honoured')
  assert.match(
    found[0].message,
    /eager input check/,
    'the second half of the resolution is what makes WARNING the right severity',
  )
  assert.equal(hasErrors(lint(parseDot(src))), false, 'an inert attribute must not block the run')
})

test('RUNS-002 warns on a goal gate with runs_on=always, which is now wholly inert', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work  [shape=box, prompt="work"]
    judge [shape=box, prompt="judge", goal_gate="true", runs_on="always"]
    start -> work -> judge -> done
  }`
  const found = runs002(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.WARNING)
  assert.equal(found[0].node, 'judge')
  assert.match(found[0].message, /runs_on="always"/)
  // `always` never skipped anything, so the skip half of the message does not
  // apply and must not be claimed.
  assert.doesNotMatch(found[0].message, /skipping it/)
  assert.match(found[0].message, /eager input check/)
})

test('RUNS-002 does not fire on a goal gate with no runs_on at all', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work  [shape=box, prompt="work"]
    judge [shape=box, prompt="judge", goal_gate="true"]
    start -> work -> judge -> done
  }`
  assert.deepEqual(runs002(src), [])
})

test('RUNS-002 defers to RUNS-001 on a gate whose runs_on value is unrecognised', () => {
  // The resolved mode is `success`, where the attribute IS honoured (as the
  // default). Warning that it is ignored would be false; RUNS-001 is the rule
  // that names the actual problem.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work  [shape=box, prompt="work"]
    judge [shape=box, prompt="judge", goal_gate="true", runs_on="alwyas"]
    start -> work -> judge -> done
  }`
  assert.deepEqual(runs002(src), [])
  assert.ok(lint(parseDot(src)).some((d) => d.code === 'RUNS-001'))
})

test('RUNS-002 does not fire on a non-gate node with runs_on=failure', () => {
  // The whole point of the attribute. A failure handler that is not a gate is
  // exactly what `runs_on=failure` is for.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work   [shape=box, prompt="work"]
    notify [shape=parallelogram, runs_on="failure", tool_command="send-alert"]
    start -> work
    work -> notify [condition="outcome=fail"]
    work -> done [condition="outcome=success"]
    notify -> done
  }`
  assert.deepEqual(runs002(src), [])
})

test('RUNS-002 does not fire when goal_gate is not the exact string true', () => {
  // `wantsVerdict` matches goal_gate="true" exactly, so a node with
  // goal_gate="TRUE" is NOT a gate at runtime and its runs_on is honoured
  // normally. Warning about it would describe behaviour that does not happen;
  // HITL-002 is the rule that catches the real problem with that node.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work  [shape=box, prompt="work"]
    judge [shape=box, prompt="judge", goal_gate="TRUE", runs_on="failure"]
    start -> work -> judge -> done
  }`
  assert.deepEqual(runs002(src), [])
  assert.ok(lint(parseDot(src)).some((d) => d.code === 'HITL-002'))
})

// ---------------------------------------------------------------------------
// The passthrough set GATE-001 depends on.
//
// `NEVER_FAILS` used to hand-copy the three kinds `defaultHandlers` maps to
// `PassthroughHandler`. It now IS that list -- `defaultHandlers` is built from
// `PASSTHROUGH_KINDS` -- which closes the drift in one direction. Types are
// stripped rather than checked before tests run, so runtime pins are the
// enforcement that runs, in the style of the INFERRED_OUTPUTS_BY_HANDLER
// exhaustiveness test.
//
// THE OTHER DIRECTION NEEDS AN INDEPENDENT ANCHOR, and a test-quality audit
// found the first test below did not have one. `derived` is computed FROM
// `defaultHandlers`, which is BUILT FROM `PASSTHROUGH_KINDS`, so the comparison
// is between a list and itself and can only fail on a post-spread override.
// Shortening `PASSTHROUGH_KINDS` to drop CONDITIONAL left the entire repository
// suite green -- while `defaultHandlers` stopped registering CONDITIONAL (so a
// `shape=diamond` node aborts the run with `no handler registered`) and
// `NEVER_FAILS` silently shrank (so GATE-001 starts reporting failure edges out
// of diamond nodes as real bypass routes).
//
// The two tests after it are those consequences, anchored on things that do not
// come from `PASSTHROUGH_KINDS`: the handler kinds a parsed GRAPH resolves to,
// and GATE-001's output on a diamond failure edge.
// ---------------------------------------------------------------------------

test('no kind outside PASSTHROUGH_KINDS is mapped to the passthrough handler', () => {
  // The post-spread-override direction, and now named for what it can actually
  // see rather than "is exactly the set".
  const handlers = defaultHandlers(new StubBackend({}))
  const passthrough = handlers.get(Handler.START)
  assert.ok(passthrough, 'start has a handler')
  const derived = [...handlers].filter(([, h]) => h === passthrough).map(([kind]) => kind)
  assert.deepEqual(new Set(derived), new Set(PASSTHROUGH_KINDS))
  // And the set is not vacuous, so a future refactor that empties both sides
  // cannot make this pass by having nothing to compare.
  assert.ok(PASSTHROUGH_KINDS.length > 0)
})

test('defaultHandlers registers every kind a runnable graph shape resolves to', () => {
  // The anchor is the GRAPH, not the list: `parseDot` resolves each shape to a
  // handler kind, and every one of those kinds must be registered or the run
  // aborts with `no handler registered`. Shortening PASSTHROUGH_KINDS drops the
  // kind from the map and this fails, which the self-comparison above cannot do.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    pick  [shape=diamond]
    think [shape=box, prompt="work"]
    run   [shape=parallelogram, tool_command="true"]
    start -> pick
    pick -> think
    think -> run -> done
  }`
  const graph = parseDot(src)
  const handlers = defaultHandlers(new StubBackend({}))
  const required = [...graph.nodes.values()].map((n) => n.handler)
  assert.ok(required.includes(Handler.CONDITIONAL), 'the fixture must exercise a diamond')
  for (const kind of required) {
    assert.ok(handlers.has(kind), `no handler registered for ${kind}`)
  }
})

test('GATE-001 does not treat a failure edge out of a diamond node as a route', () => {
  // The NEVER_FAILS consequence, anchored on a diagnostic rather than on the
  // list. A diamond node is a PassthroughHandler node: it returns SUCCESS
  // unconditionally and has no failure to route, so `pick -> bail` is dead and
  // reporting it would be a false positive. Drop CONDITIONAL from
  // PASSTHROUGH_KINDS and NEVER_FAILS shrinks with it, and this fires.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    pick  [shape=diamond]
    judge [shape=box, prompt="judge", goal_gate="true"]
    bail  [shape=box, prompt="bail out"]
    start -> pick
    pick -> judge [condition="outcome=success"]
    pick -> bail  [condition="outcome=fail"]
    judge -> done
    bail -> done
  }`
  const diags = lint(parseDot(src))
  assert.deepEqual(
    diags.filter((d) => d.code === 'GATE-001'),
    [],
    'a node that cannot fail has no failure route to report',
  )
  // Not vacuous: the graph really does declare a gate and a bypassing route,
  // so GATE-001 had every other reason to fire and was stopped only by
  // NEVER_FAILS.
  assert.ok([...parseDot(src).nodes.values()].some((n) => n.attrs.goal_gate === 'true'))
  assert.equal(hasErrors(diags), false)
})

// ---------------------------------------------------------------------------
// HAND-001: a node resolving to a handler kind this build does not register.
// ---------------------------------------------------------------------------

test('UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually registers', () => {
  const registered = new Set(defaultHandlers(new StubBackend({})).keys())
  const expected = Object.values(Handler).filter((k) => !registered.has(k))
  assert.deepEqual(new Set(UNREGISTERED_HANDLER_KINDS), new Set(expected))
})

test('HAND-001 fires for a node resolving to Handler.PARALLEL', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fanout [shape=component]
    start -> fanout -> done
  }`
  const found = codes(src)
  assert.ok(found.includes('HAND-001'))
})

test('HAND-001 fires for a node resolving to Handler.FAN_IN', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    join [shape=tripleoctagon]
    start -> join -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 fires for a node resolving to Handler.MANAGER_LOOP', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    loop [shape=house]
    start -> loop -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 fires for Handler.HUMAN too, since it is unregistered in this build', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=hexagon, prompt="approve?"]
    start -> gate -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 respects type= overriding shape=', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    node1 [shape=box, type="parallel"]
    start -> node1 -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 does not fire for any registered handler kind', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work [shape=box, prompt="do it"]
    tool [shape=parallelogram, tool_command="printf ok"]
    cond [shape=diamond]
    start -> work -> tool -> cond -> done [condition="outcome=success"]
    cond -> done [condition="outcome=fail"]
  }`
  assert.ok(!codes(src).includes('HAND-001'))
})

test('HAND-001 reports one diagnostic per offending node, not one per graph', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=component]
    b [shape=tripleoctagon]
    start -> a -> b -> done
  }`
  const found = lint(parseDot(src)).filter((d) => d.code === 'HAND-001')
  assert.equal(found.length, 2)
})

// ---------------------------------------------------------------------------
// HITL-003: an agent-inclusive human gate whose context traces to a single,
// structurally-provable Handler.CODERGEN predecessor. See ADR-006 for why
// CODERGEN-only (not Handler.TOOL, whose output is written conditionally on
// exit code and so cannot be proven at lint time).
// ---------------------------------------------------------------------------

function hitl003(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'HITL-003')
}

test('HITL-003 fires when an agent-inclusive gate is fed directly by a CODERGEN node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize the work"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.WARNING)
  assert.equal(found[0].node, 'gate')
  assert.match(found[0].message, /review/)
  assert.match(found[0].message, /agent/)
})

test('HITL-003 fires when "agent" is not the first hop in human.channel', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="human,agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 respects type= overriding shape= on the gate node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=box, type="wait.human", human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 respects type= overriding shape= on the predecessor node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=parallelogram, type="codergen", prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 reports one diagnostic per offending node, not one per graph', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    reviewA [shape=box, prompt="summarize A"]
    gateA [shape=hexagon, human.channel="agent", human.context="reviewA.summary"]
    reviewB [shape=box, prompt="summarize B"]
    gateB [shape=hexagon, human.channel="agent", human.context="reviewB.summary"]
    start -> reviewA -> gateA -> reviewB -> gateB -> done
  }`
  assert.equal(hitl003(src).length, 2)
})

test('HITL-003 does not fire when human.channel has no agent hop', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="human", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when human.context is absent', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when human.context is whitespace-only', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="   "]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the gate has two direct predecessors', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    other [shape=box, prompt="do other work"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate
    start -> other -> gate
    gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

// directPredecessor's in-degree blind spot: raw incoming-edge count can be
// inflated by duplicate/self-loop edges from what is really a single
// meaningful predecessor. Exercised here through hitl003() fixtures
// (matching this file's existing convention -- graph.ts helpers like
// outgoingEdges have no direct unit tests either, only exercise through
// lint rule behavior) rather than by importing directPredecessor directly.

test('HITL-003 fires when two edges (e.g. labelled success/failure branches) come from the same CODERGEN predecessor', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review
    review -> gate [label="success"]
    review -> gate [label="failure"]
    gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /review/)
})

test('HITL-003 fires through a self-loop on the gate node, still resolving to the real predecessor', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate
    gate -> gate
    gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /review/)
})

test('HITL-003 fires when an identical duplicate edge from the same predecessor is declared twice', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate
    review -> gate
    gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.match(found[0].message, /review/)
})

test('HITL-003 does not fire for a Handler.TOOL predecessor without outputs=', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    check [shape=parallelogram, tool_command="printf ok"]
    gate [shape=hexagon, human.channel="agent", human.context="check.output"]
    start -> check -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire for a Handler.TOOL predecessor with outputs= declared', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    check [shape=parallelogram, tool_command="printf ok", outputs="check.output"]
    gate [shape=hexagon, human.channel="agent", human.context="check.output"]
    start -> check -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the CODERGEN node is two hops back, not the direct predecessor', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    notify [shape=parallelogram, tool_command="printf notified"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> notify -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the sole direct predecessor is Handler.START', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=hexagon, human.channel="agent", human.context="start.anything"]
    start -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire on a channel name merely containing the substring "agent"', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agentic_reviewer", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 never reports an error-severity diagnostic -- advisory only', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.ok(found.every((d) => d.severity === Severity.WARNING))
})

// Regression pin: an earlier implementation attempt of this rule silently
// dropped the `node.handler === Handler.HUMAN` outer gate, and no fixture
// in this file's other 19 cases would have caught it -- every one of them
// that sets human.channel/human.context also happens to already be a
// hexagon/Handler.HUMAN node, so the gate was never independently
// exercised. This fixture puts the two attributes on a plain box
// (Handler.CODERGEN) node instead, which is not any kind of human gate.
test('HITL-003 does not fire on a non-Handler.HUMAN node carrying human.channel/human.context', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    notagate [shape=box, prompt="do something else", human.channel="agent", human.context="review.summary"]
    start -> review -> notagate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 co-fires with HAND-001 without interference, since Handler.HUMAN is still unregistered', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const found = codes(src)
  assert.ok(found.includes('HITL-003'))
  assert.ok(found.includes('HAND-001'))
})

test('HITL-003 message names the predecessor, states advisory-only, and disclaims multi-hop/TOOL detection', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const message = hitl003(src)[0].message
  assert.match(message, /review/)
  assert.match(message, /[Aa]dvisory/)
  assert.match(message, /does not (block|detect)/)
})

// ---------------------------------------------------------------------------
// findConvergenceNode / findPartialReconvergence (dot/graph.ts) -- pure
// functions, no lint() involved yet.
// ---------------------------------------------------------------------------

test('findConvergenceNode: multi-hop convergence returns the shallowest common descendant', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan  [shape=component]
    a [shape=box]  b [shape=box]  mid [shape=box]  join [shape=box]
    start -> fan
    fan -> a -> mid -> join -> done
    fan -> b -> join
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), 'join')
})

test('findConvergenceNode: branches that never reconverge return null', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan  [shape=component]
    a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), null)
})

test('findConvergenceNode: single-branch degenerate returns the one root\'s nearest descendant', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]
    start -> fan -> a -> done
  }`)
  assert.equal(findConvergenceNode(g, ['a']), 'done')
})

test('findConvergenceNode: convergence at the graph\'s real EXIT node', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done
    fan -> b -> done
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), 'done')
})

test('findConvergenceNode: a root reachable from another root resolves past it, not to it', () => {
  // root1 -> root2 is a legal DOT shape (one branch's own path happens to
  // pass through another branch's root). Roots are never valid convergence
  // candidates, so the function must skip over root2 and find `shared`, the
  // real non-root common descendant -- not error, and not return root2.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    root1 [shape=box]  root2 [shape=box]  shared [shape=box]
    start -> fan
    fan -> root1 -> root2
    fan -> root2
    root2 -> shared -> done
  }`)
  assert.equal(findConvergenceNode(g, ['root1', 'root2']), 'shared')
})

test('findPartialReconvergence: the "normalize" shared-step shape (F3)', () => {
  // Two of three branches share `normalize` before the real convergence
  // node `combine` -- a node reachable from 2 of 3 roots, not all.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  r3 [shape=box]
    normalize [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> normalize
    fan -> r2 -> normalize
    fan -> r3 -> combine
    normalize -> combine -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2', 'r3'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['r1', 'r2', 'r3'], convergenceId), ['normalize'])
})

test('findPartialReconvergence: tied full-common-descendant shape (F3 residual, ADR-007 amendment)', () => {
  // Both X and Y are common to EVERY root at the same depth -- the "diamond
  // of diamonds" shape. findConvergenceNode picks one (whichever wins the
  // unspecified tie-break); findPartialReconvergence must still flag the
  // other, because it too is reachable from every branch root and could
  // still be double-dispatched.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]
    x [shape=box]  y [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> x
    fan -> r1 -> y
    fan -> r2 -> x
    fan -> r2 -> y
    x -> combine -> done
    y -> combine
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.ok(convergenceId === 'x' || convergenceId === 'y', 'the shallower tied node wins the tie-break')
  const other = convergenceId === 'x' ? 'y' : 'x'
  const partial = findPartialReconvergence(g, ['r1', 'r2'], convergenceId)
  assert.ok(
    partial.includes(other),
    'the sibling that lost the tie-break must still be flagged -- a pre-amendment ' +
      '("but not all") rule would miss it, since it is reachable from EVERY root',
  )
})

test('findPartialReconvergence: disjoint branches produce no false positive', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> combine
    fan -> r2 -> combine
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['r1', 'r2'], convergenceId), [])
})

test('findPartialReconvergence: a node genuinely downstream of convergence is never flagged', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  mid [shape=box]  after [shape=box]
    start -> fan
    fan -> r1 -> mid
    fan -> r2 -> mid
    mid -> after -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.equal(convergenceId, 'mid')
  assert.deepEqual(
    findPartialReconvergence(g, ['r1', 'r2'], convergenceId), [],
    'after is only reachable BY GOING THROUGH mid -- the truncated BFS never expands past it, so it is dead code by construction',
  )
})

test('findPartialReconvergence: a null convergenceId returns empty, not an error', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`)
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], null), [])
})

test('findConvergenceNode: worst-case (not best-case) depth wins a non-trivial tie', () => {
  // p is close to `a` (depth 1) but far from `b` (depth 5); q is at depth 3
  // from both. The correct worst-case ranking picks q (max(3,3)=3 beats
  // max(1,5)=5); a best-case ranking would wrongly pick p (min(1,5)=1 beats
  // min(3,3)=3). Every fixture elsewhere in this suite happens to have max
  // and min agree, so this is the one that actually pins the direction.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    a [shape=box]  b [shape=box]  p [shape=box]  q [shape=box]
    a1 [shape=box]  a2 [shape=box]
    b1 [shape=box]  b2 [shape=box]  b3 [shape=box]  b4 [shape=box]
    combine [shape=box]
    start -> fan
    fan -> a
    fan -> b
    a -> p
    a -> a1 -> a2 -> q
    b -> b1 -> b2 -> q
    b2 -> b3 -> b4 -> p
    p -> combine
    q -> combine
    combine -> done
  }`)
  assert.equal(findConvergenceNode(g, ['a', 'b']), 'q')
})

test('findConvergenceNode: the root-exclusion filter is load-bearing under a root-to-root cycle', () => {
  // r1 <-> r2 is a cycle, so each root is reachable from its OWN depth map
  // (via the cycle back through the other root) -- without excluding roots
  // from candidacy, a root itself could be picked as "the" convergence node.
  // Every other fixture in this suite has no root-to-root edge at all, so
  // the exclusion never actually mattered to their outcome; this one makes
  // it load-bearing.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  m1 [shape=box]  m2 [shape=box]  shared [shape=box]
    start -> fan
    fan -> r1
    fan -> r2
    r1 -> r2
    r2 -> r1
    r1 -> m1 -> shared
    r2 -> m2 -> shared
    shared -> done
  }`)
  assert.equal(findConvergenceNode(g, ['r1', 'r2']), 'm1')
})

test('findPartialReconvergence: a branch root reachable from a sibling root is flagged (ADR-007 sixth amendment, Gap 1)', () => {
  // Same fixture as the existing 'a root reachable from another root
  // resolves past it, not to it' test above -- that test only checked
  // findConvergenceNode. root2 is itself a branch root AND reachable from
  // root1's own path, so root1's branch and root2's own branch can both
  // dispatch root2.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    root1 [shape=box]  root2 [shape=box]  shared [shape=box]
    start -> fan
    fan -> root1 -> root2
    fan -> root2
    root2 -> shared -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['root1', 'root2'])
  assert.equal(convergenceId, 'shared')
  assert.deepEqual(
    findPartialReconvergence(g, ['root1', 'root2'], convergenceId),
    ['root2'],
    'root2 is reachable from its own branch dispatch AND from root1 -- a real double dispatch',
  )
})

test('findPartialReconvergence: an asymmetric tie hazard the truncated-intersection check alone misses (ADR-007 sixth amendment, Gap 2)', () => {
  // x and y tie for shallowest full common descendant (both worst-case
  // depth 2); x wins the tie-break. root2's only path to y runs THROUGH x,
  // so y never appears in root2's truncated set -- but root1 reaches y
  // directly (via q), without ever touching x. y is present in exactly one
  // branch's truncated set, so the old cross-branch-intersection check alone
  // would miss it; it must be caught because y is also reachable from x
  // (the chosen convergence node) itself, i.e. from where the main run
  // resumes.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    root1 [shape=box]  root2 [shape=box]
    p [shape=box]  q [shape=box]  x [shape=box]  y [shape=box]
    start -> fan
    fan -> root1
    fan -> root2
    root1 -> p -> x
    root1 -> q -> y
    root2 -> x
    x -> y
    y -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['root1', 'root2'])
  assert.equal(convergenceId, 'x', 'x wins the depth-2 tie over y (first-encountered convention)')
  assert.deepEqual(
    findPartialReconvergence(g, ['root1', 'root2'], convergenceId),
    ['y'],
    'y is reachable from root1 alone (bypassing x) AND from x\'s own downstream -- flagged without needing root2 to also reach it',
  )
})

test('findPartialReconvergence: the graph\'s real EXIT node never contributes a false hazard', () => {
  // Both branches reach EXIT via their own shortcut (s1/s2) at the same
  // depth EXIT is reachable from the chosen convergence node itself --
  // without the EXIT exclusion, 'done' would be flagged by BOTH the
  // cross-branch rule (reachable from both r1's and r2's truncated sets)
  // and the downstream-of-convergence rule. EXIT is a PassthroughHandler
  // (writes nothing), so a second dispatch has no observable effect --
  // this is PAR-005's territory (a future rule), not PAR-004's.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  s1 [shape=box]  s2 [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1
    fan -> r2
    r1 -> combine
    r1 -> s1 -> done
    r2 -> combine
    r2 -> s2 -> done
    combine -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r2'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(
    findPartialReconvergence(g, ['r1', 'r2'], convergenceId),
    [],
    'done (EXIT) is reachable from both branches and from combine\'s own downstream, but must never be flagged',
  )
  assert.ok(
    !lint(g).some((d) => d.code === 'PAR-004'),
    'the full lint pipeline must not refuse this graph',
  )
})

test('findPartialReconvergence: an ordinary rework loop back to the fan-out node is not a false hazard', () => {
  // A ...-> check -> fan (retry) loop routes convergenceId's own downstream
  // back into the fan-out and its branch roots -- an ordinary, already-
  // accepted repair pattern (NFR-1's step cap bounds routing cycles like
  // this one), not a double-dispatch hazard. ADR-007's seventh amendment.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> combine
    fan -> b -> combine
    combine -> check
    check -> fan [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], convergenceId), [])
})

test('findPartialReconvergence: a rework loop straight back to a branch root is not a false hazard', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> combine
    fan -> b -> combine
    combine -> check
    check -> a [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], convergenceId), [])
})

test('findPartialReconvergence: a rework loop back to the graph start is not a false hazard', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> combine
    fan -> b -> combine
    combine -> check
    check -> start [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], convergenceId), [])
})

test('findPartialReconvergence: a rework loop into a genuinely shared non-root node is still flagged', () => {
  // Contrast with the three tests above: this retry edge does NOT go back to
  // a root or the fan-out node -- it reaches `m`, a node branch `a`'s own
  // path already passes through. `m` is not "a fresh iteration of the
  // fan-out"; it is the same double-dispatch hazard this rule exists to
  // catch, reached by a second, independent path. Proves the root exclusion
  // above does not overreach into hiding a real hazard.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]  m [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> m -> combine
    fan -> b -> combine
    combine -> check
    check -> m
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(
    findPartialReconvergence(g, ['a', 'b'], convergenceId),
    ['m'],
    'm is reachable from branch a AND from a second, independent path through check -- a real hazard, not a rework loop',
  )
})

test('findPartialReconvergence: a rework loop stays a non-hazard even when a branch has an intermediate node (ADR-007 eighth amendment)', () => {
  // Round 2's own three rework-loop tests all used branches exactly one node
  // long (fan -> a -> combine), which cannot distinguish "exclude the root"
  // from "exclude the root and everything reachable only via the loop
  // through it" -- both pass identically on a degenerate single-node branch.
  // This adds one ordinary node (n) to branch a's own path -- the exact
  // shape an independent review found round 2's fix did not actually close.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  n [shape=box]  b [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> n -> combine
    fan -> b -> combine
    combine -> check
    check -> fan [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(
    findPartialReconvergence(g, ['a', 'b'], convergenceId),
    [],
    'n is reached only by walking the rework loop back through root a -- not a real hazard',
  )
})

test('findPartialReconvergence: a rework loop straight to a root is a non-hazard even with an intermediate node past it', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  n [shape=box]  b [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a -> n -> combine
    fan -> b -> combine
    combine -> check
    check -> a [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a', 'b'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['a', 'b'], convergenceId), [])
})

test('findPartialReconvergence: a rework loop to graph start is a non-hazard with both branches multi-node', () => {
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a1 [shape=box]  a2 [shape=box]  b1 [shape=box]  b2 [shape=box]
    combine [shape=box]  check [shape=diamond]
    start -> fan
    fan -> a1 -> a2 -> combine
    fan -> b1 -> b2 -> combine
    combine -> check
    check -> start [label="retry"]
    check -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['a1', 'b1'])
  assert.equal(convergenceId, 'combine')
  assert.deepEqual(findPartialReconvergence(g, ['a1', 'b1'], convergenceId), [])
})

// ---------------------------------------------------------------------------
// PAR-001 / PAR-002 / PAR-004: Handler.PARALLEL fan-out shape, reusing
// findConvergenceNode/findPartialReconvergence above. Co-fire with HAND-001
// -- Handler.PARALLEL stays in UNREGISTERED_HANDLER_KINDS until p5-08.
// ---------------------------------------------------------------------------

test('PAR-001 fires ERROR when a component node has no discoverable convergence node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done1 [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]
    start -> fan
    fan -> a -> done1
    fan -> b
  }`
  const found = codes(src)
  assert.ok(found.includes('PAR-001'))
  assert.ok(found.includes('HAND-001'), 'PAR-001 co-fires with HAND-001, never suppresses it')
  const diag = lint(parseDot(src)).find((d) => d.code === 'PAR-001')
  assert.equal(diag?.severity, Severity.ERROR)
})

test('PAR-001 does not fire when a genuine convergence node exists; HAND-001 still fires alone', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]  b [shape=box]  join [shape=box]
    start -> fan
    fan -> a -> join
    fan -> b -> join
    join -> done
  }`
  const found = codes(src)
  assert.ok(!found.includes('PAR-001'))
  assert.ok(found.includes('HAND-001'))
})

test('PAR-002 fires WARNING only on exactly one outgoing edge, never with PAR-001/PAR-004, and co-fires with HAND-001 without either suppressing the other', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]
    start -> fan -> a -> done
  }`
  const diags = lint(parseDot(src))
  const par002 = diags.find((d) => d.code === 'PAR-002')
  assert.ok(par002)
  assert.equal(par002?.severity, Severity.WARNING)
  assert.ok(!diags.some((d) => d.code === 'PAR-001'))
  assert.ok(!diags.some((d) => d.code === 'PAR-004'))
  assert.ok(
    diags.some((d) => d.code === 'HAND-001'),
    'the negative-control row: PAR-002 (WARNING) must not suppress HAND-001 (ERROR), and vice versa -- Handler.PARALLEL is still unregistered',
  )
})

test('a component node with zero outgoing edges fires neither PAR-001 nor PAR-002 nor PAR-004', () => {
  // TOPO-006 already refuses a non-exit node with no outgoing edge --
  // deliberately not a PAR-* concern.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    start -> fan
  }`
  const found = codes(src)
  assert.ok(!found.includes('PAR-001'))
  assert.ok(!found.includes('PAR-002'))
  assert.ok(!found.includes('PAR-004'))
})

test('PAR-004 fires ERROR on the exact "normalize" shared-step fixture (F3)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  r3 [shape=box]
    normalize [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> normalize
    fan -> r2 -> normalize
    fan -> r3 -> combine
    normalize -> combine -> done
  }`
  const diags = lint(parseDot(src))
  const par004 = diags.find((d) => d.code === 'PAR-004')
  assert.ok(par004, 'a rule that only checks findConvergenceNode() === null misses this -- convergence DOES exist (combine)')
  assert.equal(par004?.severity, Severity.ERROR)
  assert.ok(diags.some((d) => d.code === 'HAND-001'))
})

test('PAR-004 fires ERROR on the tied-full-common-descendant fixture (ADR-007 amendment)', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]
    x [shape=box]  y [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> x
    fan -> r1 -> y
    fan -> r2 -> x
    fan -> r2 -> y
    x -> combine -> done
    y -> combine
  }`
  const diags = lint(parseDot(src))
  assert.ok(
    diags.some((d) => d.code === 'PAR-004'),
    'a pre-amendment ("but not all") rule would NOT fire here -- the sibling that lost the ' +
      'tie-break is reachable from EVERY root, not a proper subset -- proving the broadening is real',
  )
})

test('PAR-004 does not false-positive on disjoint branches', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> combine
    fan -> r2 -> combine
  }`
  assert.ok(!codes(src).includes('PAR-004'))
})

test('PAR-004 does not fire for a node genuinely downstream of the convergence node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  mid [shape=box]  after [shape=box]
    start -> fan
    fan -> r1 -> mid
    fan -> r2 -> mid
    mid -> after -> done
  }`
  assert.ok(!codes(src).includes('PAR-004'))
})

test('PAR-004 does not false-positive on a duplicate chain-form edge to the same branch root', () => {
  // `fan -> r1 -> p` then `fan -> r1 -> combine` is ordinary DOT chain
  // syntax that emits TWO edges from fan to r1. Before deduping
  // branchRootIds, this counted r1 as two branches, and p (reachable from
  // only ONE distinct root) tripped the count>=2 check, refusing a
  // perfectly ordinary graph -- and the ERROR message named the same root
  // twice as if there were two.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  p [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> p
    fan -> r1 -> combine
    fan -> r2 -> combine
    p -> combine
    combine -> done
  }`
  const found = codes(src)
  assert.ok(!found.includes('PAR-004'), 'a re-spelling of the same two-branch graph must not flip PAR-004 on')
  assert.ok(found.includes('HAND-001'))
})

test('PAR-002 fires (not PAR-004) on two differently-labelled edges to the same successor', () => {
  // Structurally a one-branch fan-out (both edges target `a`), just spelled
  // with two labels. Before deduping branchRootIds, this counted as two
  // branches, silencing PAR-002 (length was 2, not 1) and could spuriously
  // trip PAR-004 instead.
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]  a [shape=box]
    start -> fan
    fan -> a [label="success"]
    fan -> a [label="failure"]
    a -> done
  }`
  const diags = lint(parseDot(src))
  assert.ok(diags.some((d) => d.code === 'PAR-002'), 'a single distinct target is a one-branch fan-out regardless of edge count')
  assert.ok(!diags.some((d) => d.code === 'PAR-001'))
  assert.ok(!diags.some((d) => d.code === 'PAR-004'))
})

test('findPartialReconvergence: is defensively insensitive to a caller passing a duplicate root id', () => {
  // lint.ts already dedupes branchRootIds before calling this function --
  // this test calls the function directly with a duplicate, bypassing that,
  // to prove the function no longer trusts its caller to have deduped.
  const g = parseDot(`digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fan [shape=component]
    r1 [shape=box]  r2 [shape=box]  p [shape=box]  combine [shape=box]
    start -> fan
    fan -> r1 -> p
    fan -> r1 -> combine
    fan -> r2 -> combine
    p -> combine
    combine -> done
  }`)
  const convergenceId = findConvergenceNode(g, ['r1', 'r1', 'r2'])
  assert.deepEqual(
    findPartialReconvergence(g, ['r1', 'r1', 'r2'], convergenceId),
    [],
    'a duplicated root id must not inflate rule (a)\'s cross-branch count against itself',
  )
})
