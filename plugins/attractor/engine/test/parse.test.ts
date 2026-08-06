import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { Handler } from '../src/dot/graph.ts'

const SRC = `
digraph TaskRunner {
    graph [goal="Ship the thing", params="task_file", default_max_retries=2]
    node [class="default"]

    start [shape=Mdiamond]
    done  [shape=Msquare]

    verify [shape=parallelogram, class="gate", max_retries=0, goal_gate=true,
        tool_command="n=$(($(cat .ai/iter 2>/dev/null || echo 0)+1)); VF=\\"$task_file\\"; VF=\\"\${VF%.md}.verify.sh\\"; printf '{\\"gate\\": \\"verify\\"}\\n' >> .ai/c.jsonl; [ -f \\"$VF\\" ] && printf green || { printf red; exit 1; }"]

    attempt [shape=box, prompt="Advance $goal"]

    start -> attempt -> verify
    verify -> done    [condition="context.tool.last_line=green && outcome=success", weight=10]
    verify -> attempt [condition="outcome=fail", label="retry"]
}
`

test('parses nodes, edges and graph attributes', () => {
  const g = parseDot(SRC)
  assert.equal(g.name, 'TaskRunner')
  assert.equal(g.attrs.goal, 'Ship the thing')
  assert.equal(g.attrs.default_max_retries, '2')
  assert.equal(g.nodes.size, 4)
  assert.equal(g.edges.length, 4)
})

test('assigns handlers from shapes', () => {
  const g = parseDot(SRC)
  assert.equal(g.nodes.get('start')?.handler, Handler.START)
  assert.equal(g.nodes.get('done')?.handler, Handler.EXIT)
  assert.equal(g.nodes.get('verify')?.handler, Handler.TOOL)
  assert.equal(g.nodes.get('attempt')?.handler, Handler.CODERGEN)
})

test('chained edges expand pairwise', () => {
  const g = parseDot(SRC)
  const pairs = g.edges.map((e) => `${e.from}->${e.to}`)
  assert.ok(pairs.includes('start->attempt'))
  assert.ok(pairs.includes('attempt->verify'))
})

test('edge attributes are preserved', () => {
  const g = parseDot(SRC)
  const toDone = g.edges.find((e) => e.from === 'verify' && e.to === 'done')
  assert.equal(toDone?.attrs.condition, 'context.tool.last_line=green && outcome=success')
  assert.equal(toDone?.attrs.weight, '10')
  const back = g.edges.find((e) => e.from === 'verify' && e.to === 'attempt')
  assert.equal(back?.attrs.label, 'retry')
})

test('node default attribute lists apply to nodes lacking the attribute', () => {
  const g = parseDot(SRC)
  assert.equal(g.nodes.get('attempt')?.attrs.class, 'default')
  assert.equal(g.nodes.get('verify')?.attrs.class, 'gate')
})

test('edge default attribute lists apply to edges lacking the attribute', () => {
  const g = parseDot(`
    digraph E {
      edge [weight=3, color="gray"]
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      start -> a [weight=9]
      a -> done
    }
  `)
  const explicit = g.edges.find((e) => e.from === 'start' && e.to === 'a')
  const defaulted = g.edges.find((e) => e.from === 'a' && e.to === 'done')
  assert.equal(explicit?.attrs.weight, '9', 'explicit attribute wins over the default')
  assert.equal(explicit?.attrs.color, 'gray', 'default fills the gap')
  assert.equal(defaulted?.attrs.weight, '3', 'default applies where nothing was declared')
})

test('re-declaring a node merges attributes instead of replacing them', () => {
  const g = parseDot(`
    digraph M {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      gate [shape=parallelogram, tool_command="printf ok"]
      gate [goal_gate=true]
      start -> gate -> done
    }
  `)
  const gate = g.nodes.get('gate')
  assert.equal(gate?.attrs.tool_command, 'printf ok', 'the earlier attribute survives')
  assert.equal(gate?.attrs.goal_gate, 'true', 'the later attribute is added')
  assert.equal(gate?.handler, Handler.TOOL, 'shape from the first statement still resolves')
})

test('edges from a chained statement do not share one attrs object', () => {
  const g = parseDot(`
    digraph C {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      b [shape=box]
      start -> a -> b -> done [label="chain"]
    }
  `)
  const chained = g.edges.filter((e) => e.attrs.label === 'chain')
  assert.equal(chained.length, 3)
  chained[0].attrs.label = 'mutated'
  assert.equal(chained[1].attrs.label, 'chain', 'mutating one edge must not affect its siblings')
})

test('a grouped edge target fails loudly rather than inventing a phantom node', () => {
  assert.throws(
    () =>
      parseDot(`
        digraph G {
          start [shape=Mdiamond]
          done  [shape=Msquare]
          a [shape=box]
          b [shape=box]
          { a b } -> done
          start -> a
          start -> b
        }
      `),
    /grouped edge targets/,
  )
})

test('tool_command survives byte-exact', () => {
  const g = parseDot(SRC)
  const tc = g.nodes.get('verify')?.attrs.tool_command ?? ''
  assert.ok(tc.includes('$(($(cat .ai/iter'), 'shell command substitution intact')
  assert.ok(tc.includes('VF="$task_file"'), 'escaped quotes unescaped to real quotes')
  assert.ok(tc.includes('${VF%.md}'), 'shell suffix strip intact')
  assert.ok(tc.includes('{"gate": "verify"}'), 'embedded JSON intact')
  assert.ok(!tc.includes('\n'), 'no literal newline injected')
})

// The prototype-key hole, in the two default-application loops the earlier
// sweep of `graph.ts` and `lint.ts` missed. `k in node.attrs` walks the
// prototype chain, so a default named after an Object.prototype member was
// judged "already declared" on a node that never declared it, and silently
// dropped. Object.hasOwn asks the question that was meant.
test('node and edge defaults named after Object.prototype members are not dropped', () => {
  const g = parseDot(`
    digraph P {
      node [toString="kept", constructor="kept-too"]
      edge [valueOf="kept-edge", hasOwnProperty="kept-edge-too"]
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      start -> a -> done
    }
  `)
  const a = g.nodes.get('a')
  assert.equal(a?.attrs.toString, 'kept')
  assert.equal(a?.attrs.constructor, 'kept-too')
  for (const e of g.edges) {
    assert.equal(e.attrs.valueOf, 'kept-edge')
    assert.equal(e.attrs.hasOwnProperty, 'kept-edge-too')
  }
})

test('an explicitly declared attribute still wins over a same-named default', () => {
  // The forbidding direction has a permitting counterpart: hasOwn must not
  // start overwriting real declarations on its way to fixing the prototype
  // case.
  const g = parseDot(`
    digraph P2 {
      node [prompt="default"]
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box, prompt="explicit"]
      b [shape=box]
      start -> a -> b -> done
    }
  `)
  assert.equal(g.nodes.get('a')?.attrs.prompt, 'explicit')
  assert.equal(g.nodes.get('b')?.attrs.prompt, 'default')
})

// ---------------------------------------------------------------------------
// Section 2.10 subgraph scoping and section 2.11 "subsequent".
//
// Three separate violations lived in one parser shape: defaults accumulated
// into two graph-wide objects during the walk and were applied to every node
// and edge afterwards, and bare attributes inside a subgraph were written
// straight into the graph's own attribute map. Each has its own test below,
// because each fails for its own reason and a single omnibus test would hide
// two of them behind whichever assertion happens to run first.
// ---------------------------------------------------------------------------

// Violation 1, section 2.10: "Attributes declared in a subgraph's `node [ ... ]`
// block apply to nodes within that subgraph". Ours applied them everywhere --
// including to a node declared BEFORE the subgraph and one declared after it.
// `retry_target` makes this a routing defect rather than a cosmetic one: a
// leaked one silently gives every node in the graph a failure jump target its
// author never wrote (see the Engine.run test in engine.test.ts).
test('a subgraph node default does not escape the subgraph (section 2.10)', () => {
  const g = parseDot(`
    digraph SL {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      early [shape=box]
      subgraph cluster_a {
        node [retry_target="fix", thread_id="loop-a"]
        inside [shape=box]
      }
      late [shape=box]
      fix [shape=box]
      start -> early -> inside -> late -> done
    }
  `)
  const early = g.nodes.get('early')
  const inside = g.nodes.get('inside')
  const late = g.nodes.get('late')
  assert.equal(early?.attrs.retry_target, undefined, 'a node declared before the subgraph')
  assert.equal(early?.attrs.thread_id, undefined)
  assert.equal(inside?.attrs.retry_target, 'fix', 'the node inside it still inherits')
  assert.equal(inside?.attrs.thread_id, 'loop-a')
  assert.equal(late?.attrs.retry_target, undefined, 'a node declared after the subgraph')
  assert.equal(late?.attrs.thread_id, undefined)
})

// Violation 1, edge half. Section 2.11 scopes `edge [ ... ]` the same way
// ("within their scope"), and a leaked edge default is just as load-bearing:
// a stray `condition` disables a route and a stray `weight` re-orders edge
// selection, both with no diagnostic.
test('a subgraph edge default does not escape the subgraph (section 2.11)', () => {
  const g = parseDot(`
    digraph SEL {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      b [shape=box]
      start -> a
      subgraph cluster_e {
        edge [weight=7]
        a -> b
      }
      b -> done
    }
  `)
  const find = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)
  assert.equal(find('start', 'a')?.attrs.weight, undefined, 'an edge before the subgraph')
  assert.equal(find('a', 'b')?.attrs.weight, '7', 'the edge inside it still inherits')
  assert.equal(find('b', 'done')?.attrs.weight, undefined, 'an edge after the subgraph')
})

// Violation 2, section 2.11: "Default blocks set baseline attributes for all
// SUBSEQUENT nodes or edges within their scope". Defaults used to be applied
// in a pass after the whole walk, so a default reached backwards in time and
// attached itself to nodes and edges declared before it.
test('a default block applies only to subsequent nodes and edges (section 2.11)', () => {
  const g = parseDot(`
    digraph SUB {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      before [shape=box]
      start -> before
      node [timeout="900s"]
      edge [weight=5]
      after [shape=box]
      before -> after
      after -> done
    }
  `)
  assert.equal(g.nodes.get('before')?.attrs.timeout, undefined, 'declared before the node default')
  assert.equal(g.nodes.get('after')?.attrs.timeout, '900s', 'declared after it')
  const find = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)
  assert.equal(find('start', 'before')?.attrs.weight, undefined, 'declared before the edge default')
  assert.equal(find('before', 'after')?.attrs.weight, '5', 'declared after it')
})

// Violation 3, and the most damaging of the three. Section 2.5: graph
// attributes are "declared in a `graph [ ... ]` block or as TOP-LEVEL
// `key = value` declarations". A subgraph's are neither. Ours merged them into
// the graph's map, so a subgraph named its own `label` -- which section 2.10
// reserves for class derivation -- and overwrote the graph's, and a `goal`
// anywhere inside a subgraph replaced the pipeline's goal for `$goal`
// substitution, for `context.graph.goal`, and for every prompt built from it.
test('subgraph attributes do not overwrite graph attributes (sections 2.5, 2.10)', () => {
  const g = parseDot(`
    digraph GA {
      graph [goal="real goal", label="Real"]
      start [shape=Mdiamond]
      done  [shape=Msquare]
      subgraph cluster_a {
        label = "Loop A"
        goal = "hijacked"
        graph [retry_target="hijack_target"]
        inside [shape=box]
      }
      hijack_target [shape=box]
      start -> inside -> done
    }
  `)
  assert.equal(g.attrs.goal, 'real goal', 'the graph keeps its own goal')
  assert.equal(g.attrs.label, 'Real', "a subgraph's label is its own, not the graph's")
  assert.equal(g.attrs.retry_target, undefined, 'nor does a subgraph graph[] block leak')
})

// The permitting direction of violation 3: a top-level bare `key = value` is
// exactly what section 2.5 says IS a graph attribute, so scoping must not
// start dropping those on its way to ignoring the subgraph ones.
test('a top-level bare attribute is still a graph attribute (section 2.5)', () => {
  const g = parseDot(`
    digraph TL {
      rankdir = LR
      goal = "from a bare declaration"
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }
  `)
  assert.equal(g.attrs.rankdir, 'LR')
  assert.equal(g.attrs.goal, 'from a bare declaration')
})

// The spec's own section 2.10 example, verbatim in shape: "Here `Plan`
// inherits `thread_id="loop-a"` and `timeout="900s"`, while `Implement`
// inherits `thread_id` but overrides `timeout`." If our behaviour ever
// disagrees with that sentence, the spec wins.
test("the spec's own section 2.10 subgraph example behaves as the spec states", () => {
  const g = parseDot(`
    digraph SpecExample {
      start [shape=Mdiamond]
      done  [shape=Msquare]

      subgraph cluster_loop {
          label = "Loop A"
          node [thread_id="loop-a", timeout="900s"]

          Plan      [label="Plan next step"]
          Implement [label="Implement", timeout="1800s"]
      }

      start -> Plan -> Implement -> done
    }
  `)
  const plan = g.nodes.get('Plan')
  const implement = g.nodes.get('Implement')
  assert.equal(plan?.attrs.thread_id, 'loop-a')
  assert.equal(plan?.attrs.timeout, '900s')
  assert.equal(implement?.attrs.thread_id, 'loop-a', 'Implement inherits thread_id')
  assert.equal(implement?.attrs.timeout, '1800s', 'and overrides timeout')
  assert.equal(g.attrs.label, undefined, "the subgraph's label is not the graph's")
})

// Nesting: entering a subgraph takes a COPY of the enclosing defaults, so an
// inner block adds to what it inherited and nothing it sets escapes back out.
test('nested subgraphs inherit a copy and do not leak back out (section 2.10)', () => {
  const g = parseDot(`
    digraph N {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      node [fidelity="compact"]
      outer_only [shape=box]
      subgraph cluster_o {
        node [thread_id="outer"]
        in_outer [shape=box]
        subgraph cluster_i {
          node [thread_id="inner", timeout="60s"]
          in_inner [shape=box]
        }
        after_inner [shape=box]
      }
      post [shape=box]
      start -> outer_only -> in_outer -> in_inner -> after_inner -> post -> done
    }
  `)
  const a = (id: string) => g.nodes.get(id)?.attrs ?? {}
  assert.equal(a('outer_only').fidelity, 'compact', 'the graph-level default applies')
  assert.equal(a('outer_only').thread_id, undefined)

  assert.equal(a('in_outer').fidelity, 'compact', 'the enclosing default is inherited')
  assert.equal(a('in_outer').thread_id, 'outer')
  assert.equal(a('in_outer').timeout, undefined)

  assert.equal(a('in_inner').fidelity, 'compact', 'two levels of inheritance')
  assert.equal(a('in_inner').thread_id, 'inner', 'the inner block overrides what it inherited')
  assert.equal(a('in_inner').timeout, '60s')

  assert.equal(a('after_inner').thread_id, 'outer', "the inner block's override did not escape")
  assert.equal(a('after_inner').timeout, undefined)

  assert.equal(a('post').fidelity, 'compact')
  assert.equal(a('post').thread_id, undefined, 'nor did the outer one')
  assert.equal(a('post').timeout, undefined)
})

// A graph-level default written after a subgraph is "subsequent" only at graph
// level. It must not reach back into the subgraph that already closed.
test('a graph-level default after a subgraph does not reach back into it', () => {
  const g = parseDot(`
    digraph AFTER {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      subgraph cluster_x {
        node [thread_id="x"]
        inx [shape=box]
      }
      node [prompt="late default"]
      post [shape=box]
      start -> inx -> post -> done
    }
  `)
  assert.equal(g.nodes.get('inx')?.attrs.prompt, undefined, 'the subgraph closed before it')
  assert.equal(g.nodes.get('inx')?.attrs.thread_id, 'x')
  assert.equal(g.nodes.get('post')?.attrs.prompt, 'late default')
  assert.equal(g.nodes.get('post')?.attrs.thread_id, undefined)
})

// Defaults can supply `shape`, so the handler must be resolved from the
// attributes a node ends up with -- and scoping must not resolve it from a
// default the node never inherited.
test('a scoped shape default resolves the handler only inside its scope', () => {
  const g = parseDot(`
    digraph SH {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      outside [prompt="x"]
      subgraph cluster_t {
        node [shape=parallelogram, tool_command="printf ok"]
        tooled []
      }
      start -> outside -> tooled -> done
    }
  `)
  assert.equal(g.nodes.get('tooled')?.handler, Handler.TOOL, 'the scoped shape default applied')
  assert.equal(g.nodes.get('outside')?.handler, Handler.CODERGEN, 'and did not escape')
})

// A node that appears only as an edge endpoint has no declaration statement of
// its own, so the edge statement IS its declaration point: it is created there
// and takes the defaults in scope at that point. That is what Graphviz itself
// does with `subgraph { node [x]; a -> b }`, and it is the only answer
// consistent with section 2.11's "subsequent ... within their scope" -- the
// alternatives (no defaults at all, or whatever the defaults happened to be at
// end of file) both make a node's attributes depend on text that is not where
// the node appears.
test('a node introduced by an edge takes the defaults in scope at that edge', () => {
  const g = parseDot(`
    digraph EE {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      node [fidelity="compact"]
      subgraph cluster_e {
        node [thread_id="e"]
        start -> ghost
      }
      ghost -> after_ghost
      after_ghost -> done
    }
  `)
  const ghost = g.nodes.get('ghost')
  assert.ok(ghost, 'an edge endpoint is still a real node')
  assert.equal(ghost?.attrs.fidelity, 'compact', 'it inherits the enclosing default')
  assert.equal(ghost?.attrs.thread_id, 'e', 'and the subgraph default in scope where it appears')
  const after = g.nodes.get('after_ghost')
  assert.equal(after?.attrs.fidelity, 'compact')
  assert.equal(after?.attrs.thread_id, undefined, 'introduced at graph level, outside the subgraph')
})

// An endpoint-created node later declared explicitly keeps the explicit
// attributes over the defaults it was born with: a declaration is not a
// default and must win.
test('an explicit declaration overrides a default an edge endpoint was created with', () => {
  const g = parseDot(`
    digraph EEO {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      node [prompt="default prompt"]
      start -> later
      later [shape=box, prompt="explicit prompt"]
      later -> done
    }
  `)
  assert.equal(g.nodes.get('later')?.attrs.prompt, 'explicit prompt')
})

// ---------------------------------------------------------------------------
// Section 2.2: `Key ::= Identifier | QualifiedId`, where
// `QualifiedId ::= Identifier ( '.' Identifier )+`.
//
// The upstream `@ts-graphviz/ast` grammar has no such production -- a bare
// `.` after an identifier is a syntax error there -- so an unquoted dotted
// key made the WHOLE file unparseable while its quoted spelling worked. That
// blocked every dotted attribute the spec defines: `human.default_choice`
// (4.6) and the `manager.*` / `stack.*` families (4.11).
// ---------------------------------------------------------------------------

test('an unquoted dotted attribute key parses (section 2.2 QualifiedId)', () => {
  const g = parseDot('digraph G { n [ manager.poll_interval="45s" ] }')
  assert.equal(g.nodes.get('n')?.attrs['manager.poll_interval'], '45s')
})

test('the unquoted and quoted spellings of a dotted key agree', () => {
  // The two spellings disagreeing is the actual defect: one threw, the other
  // worked. Asserting equality rather than each side separately is what makes
  // "the transform changes nothing but acceptance" a checked claim.
  const bare = parseDot('digraph G { n [ manager.poll_interval="45s", a.b.c=1 ] }')
  const quoted = parseDot('digraph G { n [ "manager.poll_interval"="45s", "a.b.c"=1 ] }')
  assert.deepEqual(bare.nodes.get('n')?.attrs, quoted.nodes.get('n')?.attrs)
})

test('every dotted attribute key the spec defines parses unquoted', () => {
  const g = parseDot(`
    digraph Q {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      ask [shape=hexagon, human.default_choice="approve"]
      loop [shape=house, manager.poll_interval="45s", manager.max_cycles=10,
            manager.stop_condition="context.done=true", manager.actions="a,b",
            stack.child_dotfile="child.dot", stack.child_autostart=true]
      start -> ask -> loop -> done
    }
  `)
  assert.equal(g.nodes.get('ask')?.attrs['human.default_choice'], 'approve')
  const loop = g.nodes.get('loop')
  assert.equal(loop?.attrs['manager.poll_interval'], '45s')
  assert.equal(loop?.attrs['manager.max_cycles'], '10')
  assert.equal(loop?.attrs['manager.stop_condition'], 'context.done=true')
  assert.equal(loop?.attrs['manager.actions'], 'a,b')
  assert.equal(loop?.attrs['stack.child_dotfile'], 'child.dot')
  assert.equal(loop?.attrs['stack.child_autostart'], 'true')
})

test('a dotted bare VALUE parses (section 2.2 BareValue), including the spec type names', () => {
  // 2.6's `type` values are dotted bare words. `type=wait.human` unquoted was
  // the same syntax error as a dotted key, so this is the value-side half of
  // the same finding -- observed through the resolved handler, not through
  // the attribute string, so the test fails if the value arrives corrupted.
  const g = parseDot(`
    digraph BV {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      ask [type=wait.human]
      join [type=parallel.fan_in]
      start -> ask -> join -> done
    }
  `)
  assert.equal(g.nodes.get('ask')?.handler, Handler.HUMAN)
  assert.equal(g.nodes.get('join')?.handler, Handler.FAN_IN)
})

test('a dot inside a quoted value is not touched by qualified-id quoting', () => {
  // What happens to a `.` inside a quoted VALUE: nothing. The scanner is
  // string-aware, so text that merely LOOKS like a qualified id inside a
  // value survives byte-exact, including one naming a real spec attribute.
  const g = parseDot(`
    digraph QV {
      n [label="a.b.c", prompt="see manager.poll_interval in section 4.11",
         "x.y"="p.q", cmd="printf 'a.b' | tee out.txt"]
    }
  `)
  const n = g.nodes.get('n')
  assert.equal(n?.attrs.label, 'a.b.c')
  assert.equal(n?.attrs.prompt, 'see manager.poll_interval in section 4.11')
  assert.equal(n?.attrs['x.y'], 'p.q')
  assert.equal(n?.attrs.cmd, "printf 'a.b' | tee out.txt")
  assert.deepEqual(Object.keys(n?.attrs ?? {}).sort(), ['cmd', 'label', 'prompt', 'x.y'])
})

test('a dot inside a comment is not touched by qualified-id quoting', () => {
  // What happens to a `.` inside a comment: nothing, in all three comment
  // forms the parser accepts. A comment that mentions an attribute must not
  // become one, and must not break the file either.
  const g = parseDot(`
    digraph QC {
      // manager.poll_interval="1s" is documented in section 4.11
      /* stack.child_dotfile
         spans.two.lines */
      # human.default_choice
      n [a=1]
    }
  `)
  assert.deepEqual([...g.nodes.keys()], ['n'])
  assert.deepEqual(g.nodes.get('n')?.attrs, { a: '1' })
})

test('a comment holding an unbalanced quote does not swallow the code after it', () => {
  // The sharp edge of scanning comments rather than ignoring them, and the
  // only shape in which getting it wrong is OBSERVABLE. Quoting a qualified
  // id that is really inside a comment is harmless -- it stays a comment
  // either way. The damage runs the other way: a scanner blind to a comment
  // form enters STRING state at the lone `"` in the prose below and stays
  // there until the next quote, which is the one opening a real value on a
  // later line. Every qualified id in between is then left unquoted and the
  // whole file fails to parse. Prose in a comment is exactly where a stray
  // quote appears, so one test per comment form.
  const g = parseDot(`
    digraph QU {
      // the operator said "go, and section 4.11 still applies
      a [manager.poll_interval="45s"]
      /* an unterminated " inside a block comment */
      b [stack.child_dotfile="child.dot"]
      # a trailing " here too
      c [human.default_choice="approve"]
      a -> b -> c
    }
  `)
  assert.equal(g.nodes.get('a')?.attrs['manager.poll_interval'], '45s')
  assert.equal(g.nodes.get('b')?.attrs['stack.child_dotfile'], 'child.dot')
  assert.equal(g.nodes.get('c')?.attrs['human.default_choice'], 'approve')
})

test('floats and durations are not mistaken for qualified ids', () => {
  const g = parseDot('digraph F { n [x=0.5, y=-3.14, z=900s, w=.25] }')
  assert.deepEqual(g.nodes.get('n')?.attrs, { x: '0.5', y: '-3.14', z: '900s', w: '.25' })
})

// ---------------------------------------------------------------------------
// Section 2.3 key constraints. Each of these ran to a successful pipeline
// before this branch; the undirected case was the worst, because `--` was
// silently reinterpreted as `->` and executed.
// ---------------------------------------------------------------------------

test('an undirected graph is rejected rather than reinterpreted as directed', () => {
  assert.throws(
    () => parseDot('graph G { start [shape=Mdiamond] exit [shape=Msquare] start -- exit }'),
    /undirected/,
  )
})

test('a strict modifier is rejected', () => {
  assert.throws(
    () => parseDot('strict digraph G { start [shape=Mdiamond] exit [shape=Msquare] start -> exit }'),
    /strict/,
  )
})

test('a node id that is not a bare identifier is rejected', () => {
  assert.throws(() => parseDot('digraph G { "bad id" [label="x"] }'), /node id/)
  assert.throws(() => parseDot('digraph G { a [shape=box] a -> "b c" }'), /node id/)
  assert.throws(() => parseDot('digraph G { 42 [shape=box] }'), /node id/)
  assert.throws(() => parseDot('digraph G { a.b [shape=box] }'), /node id/)
})

test('a legal node id is still accepted', () => {
  const g = parseDot('digraph G { _a A0 z_9 }')
  assert.deepEqual([...g.nodes.keys()], ['_a', 'A0', 'z_9'])
})

test('a missing comma between attributes is rejected', () => {
  assert.throws(() => parseDot('digraph G { n [shape=box timeout="900s"] }'), /comma/)
  assert.throws(() => parseDot('digraph G { a -> b [weight=1 label="x"] }'), /comma/)
  assert.throws(() => parseDot('digraph G { graph [goal="g" params="p"] n }'), /comma/)
  assert.throws(() => parseDot('digraph G { node [shape=box class="c"] n }'), /comma/)
})

test('a comma inside a quoted value does not stand in for the separator', () => {
  assert.throws(() => parseDot('digraph G { n [a="x,y" b=2] }'), /comma/)
})

test('a comma inside a comment does not stand in for the separator', () => {
  assert.throws(() => parseDot('digraph G { n [a=1 /* , */ b=2] }'), /comma/)
})

test('a semicolon does not stand in for the required comma', () => {
  // Section 2.2: `AttrBlock ::= "[" Attr ( "," Attr )* "]"`. DOT itself allows
  // `;` here; the spec's grammar does not, and 2.3's "semicolons optional"
  // bullet is about STATEMENT terminators, not attribute separators.
  assert.throws(() => parseDot('digraph G { n [a=1; b=2] }'), /comma/)
})

test('separated attributes, and a trailing statement semicolon, are still accepted', () => {
  const g = parseDot(`
    digraph OK {
      graph [goal="g", params="p"];
      node [shape=box];
      n [a=1, b=2];
      m [c=3];
      n -> m [weight=1, label="x"];
    }
  `)
  assert.deepEqual(g.nodes.get('n')?.attrs, { shape: 'box', a: '1', b: '2' })
  assert.deepEqual(g.edges[0].attrs, { weight: '1', label: 'x' })
})

test('an HTML label is rejected (section 2.1: no HTML labels)', () => {
  assert.throws(() => parseDot('digraph G { n [label=<<b>hi</b>>] }'), /HTML/)
})

// A rule at ERROR that false-positives makes a legitimate graph unrunnable,
// so the canonical fixture at the top of this file -- which exercises quoted
// shell, embedded JSON, escaped quotes, chained edges and default blocks --
// must still parse unchanged after all four constraints are armed.
test('the canonical pipeline still parses with every section 2.3 constraint armed', () => {
  const g = parseDot(SRC)
  assert.equal(g.nodes.size, 4)
  assert.equal(g.edges.length, 4)
})

// ---------------------------------------------------------------------------
// Finding F5 / section 2.4: `String ::= '"' ... '"'` with "escapes" -- the
// table's own example is `"line1\nline2"` -- and section 8.6's worked
// example embeds a REAL newline character inside `model_stylesheet`'s
// quoted value, spanning five source lines. Real Graphviz accepts this
// (verified against `dot -Tcanon`); the upstream `@ts-graphviz/ast` grammar
// does not -- a bare, un-escaped newline inside a quoted string matches none
// of its `DoubleStringCharacter` alternatives, and the parse throws
// `Expected "\"" or "\\" but "\n" found.` for the spec's own example. See
// the block comment above `LF_PLACEHOLDER` in `src/dot/parse.ts` for why the
// fix is a reversible placeholder substitution rather than encoding the
// newline as `\n` (which upstream -- and real Graphviz -- decode back to two
// literal characters, not a line break) or `\` + newline (which upstream's
// own line-continuation rule DELETES).
// ---------------------------------------------------------------------------

// Verbatim from attractor-spec.md section 8.6, fetched from
// repos/strongdm/attractor. `STYLESHEET_BODY` is interpolated into the
// source AND used as the expected value, so the two cannot silently drift:
// if the parser gave back anything other than the author's own bytes this
// assertion would fail, not merely "the file rejected".
const STYLESHEET_BODY = `
            * { llm_model: claude-sonnet-4-5; llm_provider: anthropic; }
            .code { llm_model: claude-opus-4-6; llm_provider: anthropic; }
            #critical_review { llm_model: gpt-5.2; llm_provider: openai; reasoning_effort: high; }
        `

const SECTION_8_6_EXAMPLE = `digraph Pipeline {
    graph [
        goal="Implement feature X",
        model_stylesheet="${STYLESHEET_BODY}"
    ]

    start [shape=Mdiamond]
    exit  [shape=Msquare]

    plan            [label="Plan", class="planning"]
    implement       [label="Implement", class="code"]
    critical_review [label="Critical Review", class="code"]

    start -> plan -> implement -> critical_review -> exit
}`

test('the section 8.6 worked example parses, verbatim from the spec (finding F5)', () => {
  const g = parseDot(SECTION_8_6_EXAMPLE)
  assert.equal(g.name, 'Pipeline')
  assert.equal(g.attrs.goal, 'Implement feature X')
  assert.equal(
    g.attrs.model_stylesheet,
    STYLESHEET_BODY,
    'the multi-line value must come back byte-exact, embedded newlines included',
  )
  assert.equal(g.nodes.get('plan')?.attrs.class, 'planning')
  assert.equal(g.nodes.get('implement')?.attrs.class, 'code')
  assert.equal(g.nodes.get('critical_review')?.attrs.label, 'Critical Review')
  assert.equal(g.edges.length, 4)
})

test('a newline survives alongside an escaped quote in the same value', () => {
  const g = parseDot('digraph G { n [note="a \\"quoted\\" word\nsecond line"] }')
  assert.equal(g.nodes.get('n')?.attrs.note, 'a "quoted" word\nsecond line')
})

test('a quoted value spanning four lines parses with every line preserved', () => {
  const g = parseDot(`digraph G { n [note="line one
line two
line three
line four"] }`)
  assert.equal(g.nodes.get('n')?.attrs.note, 'line one\nline two\nline three\nline four')
})

test('a CRLF line ending inside a quoted value round-trips exactly', () => {
  const g = parseDot('digraph G { n [note="line1\r\nline2"] }')
  assert.equal(g.nodes.get('n')?.attrs.note, 'line1\r\nline2')
})

test('a literal backslash-n stays two characters, not an actual newline', () => {
  // The opposite boundary from the tests above: this source has no raw
  // newline byte in it anywhere -- just the two ordinary characters `\` and
  // `n` -- and must not be reinterpreted as a line break.
  const g = parseDot('digraph G { n [note="line1\\nline2"] }')
  assert.equal(g.nodes.get('n')?.attrs.note, 'line1\\nline2')
  assert.ok(!g.nodes.get('n')?.attrs.note.includes('\n'), 'no actual newline character was introduced')
})

test('a newline inside a comment is untouched by the quoted-value newline fix', () => {
  const g = parseDot(`
    digraph G {
      /* a comment
         spanning
         three lines, mentioning model_stylesheet="x
y" as prose, not a value */
      n [a=1]
    }
  `)
  assert.deepEqual(g.nodes.get('n')?.attrs, { a: '1' })
})

test('a source already containing the internal newline placeholder is rejected rather than silently corrupted', () => {
  assert.throws(
    () => parseDot('digraph G { n [note="a￾b"] }'),
    /noncharacter|U\+FFFE/,
  )
  assert.throws(
    () => parseDot('digraph G { n [note="a￿b"] }'),
    /noncharacter|U\+FFFF/,
  )
})
