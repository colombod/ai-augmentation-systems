import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { resolveRetryPolicy, backoffMs, resolveRetryTarget } from '../src/core/retry.ts'

const G = parseDot(`
digraph G {
  graph [default_max_retries=3, retry_target="attempt", fallback_retry_target="orient"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  attempt [shape=box]
  orient  [shape=box]
  strict  [shape=parallelogram, max_retries=0]
  loose   [shape=box, max_retries=5, retry_target="orient"]
  start -> attempt -> strict -> loose -> done
}
`)

test('node max_retries overrides the graph default', () => {
  assert.equal(resolveRetryPolicy(G.nodes.get('strict')!, G).maxRetries, 0)
  assert.equal(resolveRetryPolicy(G.nodes.get('loose')!, G).maxRetries, 5)
})

test('graph default applies when the node is silent', () => {
  assert.equal(resolveRetryPolicy(G.nodes.get('attempt')!, G).maxRetries, 3)
})

test('backoff grows geometrically and is capped', () => {
  // `jitter: false` is what makes this assertable at all. Section 3.6 defaults
  // jitter ON, so a policy that omitted the field would be randomised and the
  // exact-equality assertions below could not exist. The growth-and-cap law is
  // tested here; the jitter multiplier is tested separately, against an
  // injected random source.
  const p = { maxRetries: 5, initialDelayMs: 200, factor: 2, maxDelayMs: 1000, jitter: false }
  assert.equal(backoffMs(p, 0), 200)
  assert.equal(backoffMs(p, 1), 400)
  assert.equal(backoffMs(p, 2), 800)
  assert.equal(backoffMs(p, 3), 1000)
  assert.equal(backoffMs(p, 9), 1000)
})

// Spec section 3.6: "`max_delay_ms : Integer -- cap on delay in milliseconds
// (default: 60000)`". Ours capped at 30000, so a `patient`-shaped policy on a
// long-running node backed off half as far as the spec asks for.
test('the backoff cap defaults to 60s, not 30s (section 3.6)', () => {
  const policy = resolveRetryPolicy(G.nodes.get('attempt')!, G)
  assert.equal(policy.maxDelayMs, 60_000)
  // And the cap is reachable: 200 * 2^9 = 102400, above 60000 and below what
  // an uncapped series would give, so this fails in BOTH directions -- a cap
  // left at 30000 returns 30000, a cap removed entirely returns 102400.
  assert.equal(backoffMs({ ...policy, jitter: false }, 9), 60_000)
})

// Section 3.6: "`jitter : Boolean -- add random jitter to prevent thundering
// herd (default: true)`", and the delay calculation ends
// "IF config.jitter: delay = delay * random_uniform(0.5, 1.5)".
//
// The random source is injected rather than stubbed globally so the mapping
// from a uniform sample to a delay is pinned exactly. A jitter implementation
// that silently ignored its input, or that used the wrong interval, passes a
// "two runs differ" test and fails this one.
test('jitter maps a uniform sample onto [0.5x, 1.5x) of the capped delay (section 3.6)', () => {
  const p = { maxRetries: 5, initialDelayMs: 200, factor: 2, maxDelayMs: 60_000, jitter: true }
  assert.equal(backoffMs(p, 0, () => 0), 100, 'the low end of the interval is 0.5x')
  assert.equal(backoffMs(p, 0, () => 0.5), 200, 'the midpoint is the undisturbed delay')
  assert.equal(backoffMs(p, 0, () => 0.999), 300, 'the high end approaches 1.5x')
  // Jitter is applied AFTER the cap, exactly as the pseudocode orders it.
  assert.equal(backoffMs(p, 20, () => 0), 30_000, 'the cap is jittered, not the raw delay')
})

test('jitter is on by default, so a resolved policy does not repeat itself', () => {
  const policy = resolveRetryPolicy(G.nodes.get('attempt')!, G)
  assert.equal(policy.jitter, true, 'section 3.6 default: true')
  const series = () => Array.from({ length: 12 }, (_, i) => backoffMs(policy, i))
  const a = series()
  const b = series()
  assert.notDeepEqual(a, b, 'two identical policies must not produce an identical series')
  // Still bounded by the law: every sample sits inside its own jitter window.
  for (const [i, delay] of a.entries()) {
    const base = Math.min(200 * 2 ** i, 60_000)
    assert.ok(delay >= base * 0.5 && delay <= base * 1.5, `sample ${i} (${delay}) is in window`)
  }
})

test('node retry_target wins over graph retry_target', () => {
  assert.equal(resolveRetryTarget(G.nodes.get('loose')!, G, { includeGraphLevel: true }), 'orient')
})

test('graph retry_target applies when the node declares none', () => {
  assert.equal(resolveRetryTarget(G.nodes.get('strict')!, G, { includeGraphLevel: true }), 'attempt')
})

test('graph-level retry_target is suppressed when the caller says includeGraphLevel: false', () => {
  const G = parseDot(`
    digraph G {
      retry_target="fallback"
      start [shape=Mdiamond] fallback [shape=box, prompt="x"] strict [shape=box, prompt="y"]
      start -> strict
    }
  `)
  const node = G.nodes.get('strict')!
  assert.equal(resolveRetryTarget(node, G, { includeGraphLevel: false }), null)
})

test('a graph declaring no retry attributes gets no retries', () => {
  // Spec section 3.5: "If neither is set, the built-in default is 0."
  const g = parseDot(`
    digraph N {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]
      start -> a -> done
    }
  `)
  assert.equal(resolveRetryPolicy(g.nodes.get('a')!, g).maxRetries, 0)
})

test('a retry target naming an unknown node resolves to null', () => {
  const g = parseDot(`
    digraph X {
      graph [retry_target="nowhere"]
      start [shape=Mdiamond]
      done [shape=Msquare]
      a [shape=box]
      start -> a -> done
    }
  `)
  assert.equal(resolveRetryTarget(g.nodes.get('a')!, g, { includeGraphLevel: true }), null)
})
