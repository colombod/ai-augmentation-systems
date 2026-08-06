# Attractor Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the attractor control plane — a CLI that lints a Graphviz DOT pipeline and executes it as a program, running real shell nodes and dispatching LLM nodes through a pluggable backend (stubbed in this plan).

**Architecture:** A DOT file is parsed into a `Graph` of nodes (computation) and edges (dispatch). An `Engine` walks it: execute node via a handler, merge context updates, select the next edge deterministically, checkpoint, repeat. Node shape selects the handler. All routing decisions are made by code, never by an LLM. The LLM backend sits behind a one-method `Backend` interface so Plan 2 can drop in `claude -p` without touching the engine.

**Tech Stack:** TypeScript on Node 24+ (native type stripping — no build step for tests), `node:test` + `node:assert`, `@ts-graphviz/ast` for DOT parsing, `esbuild` to bundle for distribution.

## Global Constraints

- **Node >= 24.** Relies on native TypeScript type stripping. Verified on Node 26.5.0.
- **Type stripping does no codegen.** Never use `enum`, `namespace`, `declare`, or constructor parameter properties. Use `const` objects with `as const` plus a derived union type instead.
- **All relative imports carry an explicit `.ts` extension** (`import { x } from './graph.ts'`). Required by Node's ESM resolver.
- **ESM only.** `"type": "module"` in package.json.
- **Runtime dependencies: `@ts-graphviz/ast` only.** Dev dependencies: `esbuild` only. Adding any other dependency requires a decision recorded in the design doc.
- **License MIT**, © 2026 Diego Colombo. Files ported from `microsoft/amplifier-bundle-attractor` carry an attribution header naming that source and its MIT license.
- **Build location:** everything in this plan is created under `plugins/attractor/engine/` **in this workspace**, mirroring the target layout exactly. Plan 6 lands it in `colombod/ai-augmentation-systems`. Do not modify that shared repository during this plan — another session is actively working in it.
- **`tool_command` is POSIX shell** and is executed with `sh -c`. Never assume bash.
- **No emoji** in source, tests, or commit messages.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src/core/outcome.ts` | `Status` union and the `Outcome` record every handler returns |
| `src/dot/graph.ts` | `Node`/`Edge`/`Graph` model; shape-to-handler mapping |
| `src/dot/parse.ts` | DOT source to `Graph` |
| `src/dot/lint.ts` | TOPO-001..005, HITL-001, CMD-001..002 |
| `src/core/context.ts` | Shared key/value run state |
| `src/core/substitute.ts` | `$name` / `${name}` expansion (M5 contract) |
| `src/core/condition.ts` | Edge condition expression evaluation |
| `src/core/edge-select.ts` | Five-step deterministic edge selection plus fail-fast guard |
| `src/core/retry.ts` | Retry policy resolution and backoff |
| `src/core/checkpoint.ts` | Run state persistence and resume |
| `src/run/events.ts` | Append-only JSONL event log |
| `src/handlers/types.ts` | `Handler` and `Backend` interfaces |
| `src/handlers/tool.ts` | `parallelogram` — POSIX shell execution |
| `src/handlers/stub.ts` | Deterministic `Backend` for tests |
| `src/handlers/box.ts` | `codergen` — prompt expansion, backend dispatch, fail-closed goal gates |
| `src/core/engine.ts` | Traversal loop, goal gates, retries, step cap |
| `src/cli.ts` | `attractor lint` / `attractor run` |

---

### Task 1: Scaffold, Outcome, and the Graph model

**Files:**
- Create: `plugins/attractor/engine/package.json`
- Create: `plugins/attractor/engine/src/core/outcome.ts`
- Create: `plugins/attractor/engine/src/dot/graph.ts`
- Test: `plugins/attractor/engine/test/graph.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Status`, `Outcome`, `Handler` (kind constant), `HandlerKind`, `Node`, `Edge`, `Graph`, `handlerForShape(shape, id)`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/graph.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Handler, handlerForShape } from '../src/dot/graph.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'

test('shape maps to handler kind', () => {
  assert.equal(handlerForShape('Mdiamond', 'begin'), Handler.START)
  assert.equal(handlerForShape('Msquare', 'finish'), Handler.EXIT)
  assert.equal(handlerForShape('box', 'attempt'), Handler.CODERGEN)
  assert.equal(handlerForShape('parallelogram', 'verify'), Handler.TOOL)
  assert.equal(handlerForShape('diamond', 'gate'), Handler.CONDITIONAL)
  assert.equal(handlerForShape('hexagon', 'escalate'), Handler.HUMAN)
  assert.equal(handlerForShape('component', 'fanout'), Handler.PARALLEL)
  assert.equal(handlerForShape('tripleoctagon', 'fanin'), Handler.FAN_IN)
})

test('missing shape defaults to codergen', () => {
  assert.equal(handlerForShape(undefined, 'plan'), Handler.CODERGEN)
})

test('reserved ids win over missing shape', () => {
  assert.equal(handlerForShape(undefined, 'start'), Handler.START)
  assert.equal(handlerForShape(undefined, 'exit'), Handler.EXIT)
})

test('explicit shape wins over reserved id', () => {
  assert.equal(handlerForShape('box', 'start'), Handler.CODERGEN)
})

test('outcome carries routing fields', () => {
  const o: Outcome = { status: Status.SUCCESS, preferredLabel: 'green' }
  assert.equal(o.status, 'success')
  assert.equal(o.preferredLabel, 'green')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test
```
Expected: FAIL — cannot resolve `../src/dot/graph.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/package.json`:

```json
{
  "name": "@colombod/attractor-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "test": "node --test",
    "build": "esbuild src/cli.ts --bundle --platform=node --format=esm --outfile=../dist/attractor.js --banner:js='#!/usr/bin/env node'"
  },
  "dependencies": {
    "@ts-graphviz/ast": "^3.0.6"
  },
  "devDependencies": {
    "esbuild": "^0.25.0"
  }
}
```

Create `plugins/attractor/engine/src/core/outcome.ts`:

```typescript
export const Status = {
  SUCCESS: 'success',
  PARTIAL: 'partial_success',
  RETRY: 'retry',
  FAIL: 'fail',
  SKIPPED: 'skipped',
} as const

export type Status = (typeof Status)[keyof typeof Status]

export interface Outcome {
  status: Status
  preferredLabel?: string
  suggestedNextIds?: string[]
  contextUpdates?: Record<string, string>
  notes?: string
}

export function isTerminalFailure(o: Outcome): boolean {
  return o.status === Status.FAIL
}
```

Create `plugins/attractor/engine/src/dot/graph.ts`:

```typescript
export const Handler = {
  START: 'start',
  EXIT: 'exit',
  CODERGEN: 'codergen',
  TOOL: 'tool',
  CONDITIONAL: 'conditional',
  HUMAN: 'human',
  PARALLEL: 'parallel',
  FAN_IN: 'fan_in',
} as const

export type HandlerKind = (typeof Handler)[keyof typeof Handler]

export interface Node {
  id: string
  attrs: Record<string, string>
  handler: HandlerKind
}

export interface Edge {
  from: string
  to: string
  attrs: Record<string, string>
}

export interface Graph {
  name: string
  attrs: Record<string, string>
  nodes: Map<string, Node>
  edges: Edge[]
}

const SHAPE_TO_HANDLER: Record<string, HandlerKind> = {
  Mdiamond: Handler.START,
  Msquare: Handler.EXIT,
  box: Handler.CODERGEN,
  parallelogram: Handler.TOOL,
  diamond: Handler.CONDITIONAL,
  hexagon: Handler.HUMAN,
  component: Handler.PARALLEL,
  tripleoctagon: Handler.FAN_IN,
}

const RESERVED_IDS: Record<string, HandlerKind> = {
  start: Handler.START,
  exit: Handler.EXIT,
}

/**
 * Resolve a node's handler. An explicit shape always wins; otherwise the
 * reserved ids `start` and `exit` apply; otherwise a node is an LLM task.
 */
export function handlerForShape(shape: string | undefined, id: string): HandlerKind {
  if (shape && SHAPE_TO_HANDLER[shape]) return SHAPE_TO_HANDLER[shape]
  if (!shape && RESERVED_IDS[id]) return RESERVED_IDS[id]
  return Handler.CODERGEN
}

export function outgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.from === nodeId)
}

export function findByHandler(graph: Graph, kind: HandlerKind): Node[] {
  return [...graph.nodes.values()].filter((n) => n.handler === kind)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && npm install && node --test
```
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): graph model, outcome types, shape-to-handler mapping

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: DOT parser

**Files:**
- Create: `plugins/attractor/engine/src/dot/parse.ts`
- Test: `plugins/attractor/engine/test/parse.test.ts`

**Interfaces:**
- Consumes: `Graph`, `Node`, `Edge`, `handlerForShape` from `src/dot/graph.ts`.
- Produces: `parseDot(src: string): Graph`.

The critical requirement is fidelity: `tool_command` attributes contain escaped quotes, `$(...)`, `${VAR%.suffix}`, and embedded JSON. They must survive byte-exact.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/parse.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/parse.test.ts
```
Expected: FAIL — cannot resolve `../src/dot/parse.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/dot/parse.ts`:

```typescript
import { parse as parseAst } from '@ts-graphviz/ast'
import { type Edge, type Graph, type Node, handlerForShape } from './graph.ts'

/**
 * The @ts-graphviz AST is loosely typed for our purposes; we walk it
 * structurally rather than importing its node type union.
 */
interface AstAny {
  type: string
  children?: AstAny[]
  id?: { value: string }
  key?: { value: string }
  value?: { value: string | number | boolean }
  targets?: AstAny[]
  kind?: string
}

function attributesOf(n: AstAny): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of n.children ?? []) {
    if (c.type === 'Attribute' && c.key && c.value !== undefined) {
      out[String(c.key.value)] = String(c.value.value)
    }
  }
  return out
}

export function parseDot(src: string): Graph {
  const ast = parseAst(src) as unknown as AstAny
  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const graphAttrs: Record<string, string> = {}
  const nodeDefaults: Record<string, string> = {}
  const edgeDefaults: Record<string, string> = {}
  let name = ''

  const walk = (parent: AstAny): void => {
    for (const c of parent.children ?? []) {
      switch (c.type) {
        case 'Node': {
          const id = String(c.id?.value ?? '')
          const attrs = attributesOf(c)
          // DOT semantics: repeated statements for one id ACCUMULATE attributes.
          // Replacing would silently discard a tool_command declared earlier.
          const existing = nodes.get(id)
          const merged = existing ? { ...existing.attrs, ...attrs } : attrs
          nodes.set(id, { id, attrs: merged, handler: handlerForShape(merged.shape, id) })
          break
        }
        case 'Edge': {
          const ids = (c.targets ?? []).map((t) => {
            const id = t.id?.value
            if (id === undefined) {
              // A grouped target ({a; b} -> c) carries children, not an id.
              // Failing loudly beats inventing a phantom node with an empty id.
              throw new Error(
                'attractor: grouped edge targets ({a; b} -> c) are not supported; ' +
                  'write each edge explicitly',
              )
            }
            return String(id)
          })
          const attrs = attributesOf(c)
          for (let i = 0; i < ids.length - 1; i++) {
            // Clone per edge: a chained statement must not alias one attrs
            // object across every edge it produces.
            edges.push({ from: ids[i], to: ids[i + 1], attrs: { ...attrs } })
          }
          break
        }
        case 'Attribute': {
          if (c.key && c.value !== undefined) {
            graphAttrs[String(c.key.value)] = String(c.value.value)
          }
          break
        }
        case 'AttributeList': {
          if (c.kind === 'Graph') Object.assign(graphAttrs, attributesOf(c))
          else if (c.kind === 'Node') Object.assign(nodeDefaults, attributesOf(c))
          else if (c.kind === 'Edge') Object.assign(edgeDefaults, attributesOf(c))
          break
        }
        default:
          if (c.children) walk(c)
      }
    }
  }

  for (const top of ast.children ?? []) {
    if (top.type === 'Graph') {
      name = top.id ? String(top.id.value) : ''
      walk(top)
    }
  }

  // Nodes that appear only inside edge statements are still real nodes.
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (!nodes.has(id)) {
        nodes.set(id, { id, attrs: {}, handler: handlerForShape(undefined, id) })
      }
    }
  }

  // Apply `node [...]` defaults without overriding explicit attributes.
  for (const node of nodes.values()) {
    for (const [k, v] of Object.entries(nodeDefaults)) {
      if (!(k in node.attrs)) node.attrs[k] = v
    }
    // Defaults may have supplied the shape, so re-resolve the handler.
    node.handler = handlerForShape(node.attrs.shape, node.id)
  }

  // Apply `edge [...]` defaults the same way. Dropping these silently would
  // lose a default `weight` or `condition` and change routing with no signal.
  for (const edge of edges) {
    for (const [k, v] of Object.entries(edgeDefaults)) {
      if (!(k in edge.attrs)) edge.attrs[k] = v
    }
  }

  return { name, attrs: graphAttrs, nodes, edges }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/parse.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): DOT parser preserving shell attributes byte-exact

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Lint rules

**Files:**
- Create: `plugins/attractor/engine/src/dot/lint.ts`
- Test: `plugins/attractor/engine/test/lint.test.ts`

**Interfaces:**
- Consumes: `Graph`, `Handler`, `findByHandler`, `outgoingEdges` from `src/dot/graph.ts`.
- Produces: `Severity`, `Diagnostic`, `lint(graph): Diagnostic[]`, `hasErrors(diags): boolean`.

Rules: TOPO-001 exactly one start; TOPO-002 exactly one exit; TOPO-003 edge targets exist; TOPO-004 all nodes reachable from start; TOPO-005 no edge into start and none out of exit; HITL-001 `timeout` without `on_timeout`; CMD-001 pipe-masked exit code; CMD-002 always-true sentinel.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/lint.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDot } from '../src/dot/parse.ts'
import { lint, hasErrors, Severity } from '../src/dot/lint.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/lint.test.ts
```
Expected: FAIL — cannot resolve `../src/dot/lint.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/dot/lint.ts`:

```typescript
import { type Graph, Handler, findByHandler, outgoingEdges } from './graph.ts'

export const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const

export type Severity = (typeof Severity)[keyof typeof Severity]

export interface Diagnostic {
  code: string
  severity: Severity
  node?: string
  message: string
}

function reachableFrom(graph: Graph, startId: string): Set<string> {
  const seen = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const e of outgoingEdges(graph, current)) {
      if (!seen.has(e.to)) {
        seen.add(e.to)
        queue.push(e.to)
      }
    }
  }
  return seen
}

const FILTERS = ['tail', 'head', 'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'wc']
const FILTER_HEAD = new RegExp(`^\\s*(${FILTERS.join('|')})\\b`)

/** `set -o pipefail`, including clustered forms such as `set -eo pipefail`. */
const PIPEFAIL = /\bset\s+-[a-zA-Z]*o\b[^;&|]*\bpipefail\b/

/**
 * Blank out `$( ... )` and backtick spans.
 *
 * A pipe inside a command substitution feeds a string into a variable; its
 * exit status never routes anything, so flagging it is a false positive.
 * The canonical task-runner pipeline hits this three times.
 *
 * Depth counting tolerates nesting, including `$(( ... ))` arithmetic. A
 * stray unbalanced paren may survive; harmless, since the caller only looks
 * for pipes and command words.
 */
function stripSubstitutions(cmd: string): string {
  let out = ''
  let depth = 0
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === '$' && cmd[i + 1] === '(') {
      depth++
      i++
      continue
    }
    if (depth > 0 && cmd[i] === ')') {
      depth--
      continue
    }
    if (depth === 0) out += cmd[i]
  }
  return out.replace(/`[^`]*`/g, ' ')
}

/**
 * A filter used as a PREDICATE reports a genuine test result, so the
 * pipeline's exit status is the intended signal rather than a masked
 * failure. `grep -q` is the common case and appears twice in the canonical
 * exemplar, both times correctly.
 */
function isPredicateFilter(segment: string): boolean {
  return /^\s*grep\b[^|]*\s-[a-zA-Z]*q/.test(segment)
}

/**
 * A pipeline whose LAST stage is a non-predicate filter swallows the real
 * exit code: under `sh` the pipeline reports the filter's status, and a
 * filter almost always succeeds.
 */
function maskingPipeline(statement: string): boolean {
  // Split on a SINGLE pipe only. Splitting on `||` too would make the last
  // segment of `... | grep -q . && printf ok || printf fail` read as
  // `printf fail`, hiding the real terminal filter and false-flagging the
  // doctrine's own honest-token-gate idiom.
  const segments = statement.split(/(?<!\|)\|(?!\|)/)
  if (segments.length < 2) return false
  const pipesIntoFilter = segments.slice(1).some((s) => FILTER_HEAD.test(s))
  if (!pipesIntoFilter) return false
  return !isPredicateFilter(segments[segments.length - 1])
}

/** Split into statements at `;` and newlines, keeping `&&` / `||` chains intact. */
function statementsOf(cmd: string): string[] {
  return cmd.split(/;|\n/).filter((s) => s.trim() !== '')
}

/** An unconditional routing sentinel chained onto a masking pipeline. */
const CHAINED_SENTINEL = /&&\s*(printf|echo)\b/
const BARE_SENTINEL = /^\s*(printf|echo)\b/
const STATUS_CAPTURE = /^\s*[A-Za-z_][A-Za-z0-9_]*=\$\?/

export function lint(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = []

  const starts = findByHandler(graph, Handler.START)
  const exits = findByHandler(graph, Handler.EXIT)

  if (starts.length !== 1) {
    diags.push({
      code: 'TOPO-001',
      severity: Severity.ERROR,
      message: `expected exactly one start node, found ${starts.length}`,
    })
  }
  if (exits.length !== 1) {
    diags.push({
      code: 'TOPO-002',
      severity: Severity.ERROR,
      message: `expected exactly one exit node, found ${exits.length}`,
    })
  }

  for (const e of graph.edges) {
    for (const id of [e.from, e.to]) {
      if (!graph.nodes.has(id)) {
        diags.push({
          code: 'TOPO-003',
          severity: Severity.ERROR,
          message: `edge ${e.from} -> ${e.to} references unknown node ${id}`,
        })
      }
    }
  }

  if (starts.length === 1) {
    const reachable = reachableFrom(graph, starts[0].id)
    for (const node of graph.nodes.values()) {
      if (!reachable.has(node.id)) {
        diags.push({
          code: 'TOPO-004',
          severity: Severity.ERROR,
          node: node.id,
          message: `node ${node.id} is unreachable from ${starts[0].id}`,
        })
      }
    }
    for (const e of graph.edges) {
      if (e.to === starts[0].id) {
        diags.push({
          code: 'TOPO-005',
          severity: Severity.ERROR,
          node: e.from,
          message: `edge ${e.from} -> ${e.to} enters the start node`,
        })
      }
    }
  }

  for (const exitNode of exits) {
    if (outgoingEdges(graph, exitNode.id).length > 0) {
      diags.push({
        code: 'TOPO-005',
        severity: Severity.ERROR,
        node: exitNode.id,
        message: `exit node ${exitNode.id} has outgoing edges`,
      })
    }
  }

  for (const node of graph.nodes.values()) {
    if (node.handler === Handler.HUMAN && node.attrs.timeout) {
      const declared = node.attrs.on_timeout
      const labels = outgoingEdges(graph, node.id).map((e) => e.attrs.label)
      if (!declared) {
        diags.push({
          code: 'HITL-001',
          severity: Severity.ERROR,
          node: node.id,
          message:
            `human gate ${node.id} sets timeout="${node.attrs.timeout}" but declares no ` +
            `on_timeout. A timeout must name the edge to take; there is no implicit fallback.`,
        })
      } else if (!labels.includes(declared)) {
        diags.push({
          code: 'HITL-001',
          severity: Severity.ERROR,
          node: node.id,
          message:
            `human gate ${node.id} declares on_timeout="${declared}" but no outgoing edge ` +
            `carries that label (found: ${labels.filter(Boolean).join(', ') || 'none'})`,
        })
      }
    }

    const cmd = node.attrs.tool_command
    if (cmd && !PIPEFAIL.test(cmd)) {
      const stmts = statementsOf(stripSubstitutions(cmd))
      for (let i = 0; i < stmts.length; i++) {
        if (!maskingPipeline(stmts[i])) continue

        diags.push({
          code: 'CMD-001',
          severity: Severity.WARNING,
          node: node.id,
          message:
            `tool_command pipes into a filter without 'set -o pipefail'; under sh the ` +
            `pipeline exits with the filter's status, masking real failure`,
        })

        // The sentinel may be chained in the same statement (`... && printf ok`)
        // or stand alone in the next one (`...; printf ok`). A deliberate
        // `rc=$?` capture means the author took the status on purpose.
        const next = stmts[i + 1] ?? ''
        const sentinel =
          CHAINED_SENTINEL.test(stmts[i]) ||
          (BARE_SENTINEL.test(next) && !STATUS_CAPTURE.test(next))
        if (sentinel) {
          diags.push({
            code: 'CMD-002',
            severity: Severity.ERROR,
            node: node.id,
            message:
              `tool_command emits a routing sentinel after a pipe to a filter; the filter ` +
              `exits 0 unconditionally so the sentinel fires regardless of real success`,
          })
        }
      }
    }
  }

  return diags
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === Severity.ERROR)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/lint.test.ts
```
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): lint rules TOPO-001..005, HITL-001, CMD-001..002

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Context and M5 substitution

**Files:**
- Create: `plugins/attractor/engine/src/core/context.ts`
- Create: `plugins/attractor/engine/src/core/substitute.ts`
- Test: `plugins/attractor/engine/test/substitute.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Context` (methods `get`, `set`, `merge`, `snapshot`, `has`; static `from`), `substitute(text, ctx): string`.

The M5 contract: absent keys are left as literal text, never replaced with an empty string and never an error.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/substitute.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../src/core/context.ts'
import { substitute } from '../src/core/substitute.ts'

test('context stores, merges and snapshots', () => {
  const c = Context.from({ goal: 'ship' })
  c.set('iter', '3')
  c.merge({ iter: '4', extra: 'yes' })
  assert.equal(c.get('goal'), 'ship')
  assert.equal(c.get('iter'), '4')
  assert.deepEqual(c.snapshot(), { goal: 'ship', iter: '4', extra: 'yes' })
  assert.equal(c.has('missing'), false)
})

test('substitutes $name and ${name}', () => {
  const c = Context.from({ goal: 'ship it', dir: '/tmp/x' })
  assert.equal(substitute('do $goal in ${dir}', c), 'do ship it in /tmp/x')
})

test('absent keys are left as literal text', () => {
  const c = Context.from({})
  assert.equal(substitute('VF="$task_file"', c), 'VF="$task_file"')
})

test('shell parameter expansion is not treated as a key', () => {
  const c = Context.from({ VF: 'should-not-be-used' })
  assert.equal(substitute('${VF%.md}.verify.sh', c), '${VF%.md}.verify.sh')
  assert.equal(substitute('${B:-6}', c), '${B:-6}')
})

test('longest key wins so prefixes do not corrupt', () => {
  const c = Context.from({ task: 'A', task_file: 'B' })
  assert.equal(substitute('$task_file', c), 'B')
})

test('command substitution is untouched', () => {
  const c = Context.from({ n: '9' })
  assert.equal(substitute('n=$(cat .ai/iter)', c), 'n=$(cat .ai/iter)')
})

test('a substituted value is never re-expanded', () => {
  // The engine must expand what the author wrote, once. If a value that
  // itself contains $HOME were rescanned, the engine would invent an
  // expansion the author never asked for.
  const c = Context.from({ dir: '$HOME', HOME: '/root' })
  assert.equal(substitute('cd ${dir}', c), 'cd $HOME')
  assert.equal(substitute('cd $dir', c), 'cd $HOME')
})

test('a value containing replacement syntax is inserted literally', () => {
  const c = Context.from({ pat: '$& and $1' })
  assert.equal(substitute('use $pat', c), 'use $& and $1')
})

test('clone is independent of the original', () => {
  const a = Context.from({ k: '1' })
  const b = a.clone()
  b.set('k', '2')
  b.set('extra', 'x')
  assert.equal(a.get('k'), '1')
  assert.equal(a.has('extra'), false)
  assert.equal(b.get('k'), '2')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/substitute.test.ts
```
Expected: FAIL — cannot resolve `../src/core/context.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/context.ts`:

```typescript
export class Context {
  private data: Map<string, string>

  constructor(initial: Record<string, string> = {}) {
    this.data = new Map(Object.entries(initial))
  }

  static from(obj: Record<string, string>): Context {
    return new Context(obj)
  }

  get(key: string): string | undefined {
    return this.data.get(key)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  set(key: string, value: string): void {
    this.data.set(key, value)
  }

  merge(updates: Record<string, string>): void {
    for (const [k, v] of Object.entries(updates)) this.data.set(k, String(v))
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.data)
  }

  clone(): Context {
    return new Context(this.snapshot())
  }
}
```

Create `plugins/attractor/engine/src/core/substitute.ts`:

```typescript
import { type Context } from './context.ts'

/**
 * M5 substitution contract.
 *
 * Replaces `$key` and `${key}` with the context value for `key`. Keys absent
 * from context are left as literal text, so shell variables inside a
 * tool_command survive untouched.
 *
 * `${...}` forms carrying shell parameter-expansion operators (`%`, `#`, `:`,
 * `/`, `-`, `+`, `?`, `!`) are never treated as context keys. Command
 * substitution `$(...)` is likewise untouched, since `(` is not a key
 * character.
 */
const TOKEN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

export function substitute(text: string, ctx: Context): string {
  // ONE pass over the original text. Two chained passes would let a value
  // inserted by the first be rescanned by the second, so a context value
  // that happens to contain `$otherkey` would expand a second time -- the
  // engine inventing an expansion the author never wrote. A single
  // `replace` never rescans inserted text.
  return text.replace(TOKEN, (match, braced?: string, bare?: string) => {
    const key = braced ?? bare
    if (key === undefined) return match
    const value = ctx.get(key)
    return value === undefined ? match : value
  })
}
```

Note: the `BRACED` pattern only matches a bare identifier between the braces, so
`${VF%.md}` and `${B:-6}` never match and are returned untouched. The `BARE`
pattern is greedy over identifier characters, so `$task_file` matches the full
key rather than the `$task` prefix.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/substitute.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): context store and M5 substitution preserving shell syntax

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Condition evaluation

**Files:**
- Create: `plugins/attractor/engine/src/core/condition.ts`
- Test: `plugins/attractor/engine/test/condition.test.ts`

**Interfaces:**
- Consumes: `Context` from `src/core/context.ts`; `Outcome`, `Status` from `src/core/outcome.ts`.
- Produces: `evaluateCondition(expr: string, ctx: Context, outcome: Outcome): boolean`.

Grammar: conjunctions of `key=value` or `key!=value` joined by `&&`. Recognised left-hand sides are `outcome`, `preferred_label`, and `context.<key>`. There is no `||`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/condition.test.ts`:

```typescript
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

test('an absent context key never matches', () => {
  const c = Context.from({})
  assert.equal(evaluateCondition('context.missing=anything', c, ok), false)
})

test('an empty condition is vacuously true', () => {
  assert.equal(evaluateCondition('', Context.from({}), ok), true)
})

test('an unparseable clause is false rather than throwing', () => {
  assert.equal(evaluateCondition('garbage', Context.from({}), ok), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/condition.test.ts
```
Expected: FAIL — cannot resolve `../src/core/condition.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/condition.ts`:

```typescript
import { type Context } from './context.ts'
import { type Outcome } from './outcome.ts'

const CLAUSE = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|=)\s*(.*?)\s*$/

function leftValue(key: string, ctx: Context, outcome: Outcome): string | undefined {
  if (key === 'outcome') return outcome.status
  if (key === 'preferred_label') return outcome.preferredLabel
  if (key.startsWith('context.')) return ctx.get(key.slice('context.'.length))
  return undefined
}

/**
 * Evaluate an edge condition. The grammar is a conjunction of comparisons
 * joined by `&&`; there is deliberately no disjunction, so routing stays
 * readable in the graph rather than hidden in expressions.
 *
 * An unrecognised clause evaluates false. Conditions gate edge eligibility,
 * so failing closed keeps a malformed condition from silently opening a path.
 */
export function evaluateCondition(expr: string, ctx: Context, outcome: Outcome): boolean {
  const trimmed = expr.trim()
  if (trimmed === '') return true

  for (const raw of trimmed.split('&&')) {
    const m = CLAUSE.exec(raw)
    if (!m) return false
    const [, key, op, expected] = m
    const actual = leftValue(key, ctx, outcome)
    if (actual === undefined) {
      // An absent value cannot satisfy equality. For inequality it also fails,
      // so a missing key never opens a path by accident.
      return false
    }
    const equal = actual === expected
    if (op === '=' ? !equal : equal) return false
  }
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/condition.test.ts
```
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): edge condition evaluation, failing closed on absent keys

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Edge selection

**Files:**
- Create: `plugins/attractor/engine/src/core/edge-select.ts`
- Test: `plugins/attractor/engine/test/edge-select.test.ts`

**Interfaces:**
- Consumes: `Graph`, `Edge`, `outgoingEdges` from `src/dot/graph.ts`; `Context`; `Outcome`, `Status`; `evaluateCondition`.
- Produces: `selectEdge(graph, fromId, ctx, outcome): Edge | null`.

Order: conditions, then preferred label, then suggested ids, then weight descending, then lexical target id. Fail-fast: on `FAIL`, unconditional edges are not followed.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/edge-select.test.ts`:

```typescript
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

test('a preferred label picks among several matching conditional edges', () => {
  // Conditions establish the eligible set; they do not end the cascade.
  const g = parseDot(`
    digraph L {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      a [shape=box]
      x [shape=box]
      y [shape=box]
      start -> a
      a -> x [condition="outcome=success", label="left"]
      a -> y [condition="outcome=success", label="right"]
      x -> done
      y -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), {
    status: Status.SUCCESS,
    preferredLabel: 'right',
  })
  assert.equal(e?.to, 'y')
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/edge-select.test.ts
```
Expected: FAIL — cannot resolve `../src/core/edge-select.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/edge-select.ts`:

```typescript
import { type Edge, type Graph, outgoingEdges } from '../dot/graph.ts'
import { type Context } from './context.ts'
import { Status, type Outcome } from './outcome.ts'
import { evaluateCondition } from './condition.ts'

/**
 * Normalise an edge label for comparison against a handler's preferred label.
 * Strips a leading accelerator such as "[A] " and folds case and whitespace,
 * so a human gate labelled "[A] Abandon - keep the postmortem" is selected by
 * a preferred label of "Abandon".
 */
function normaliseLabel(label: string): string {
  return label
    .replace(/^\s*\[[A-Za-z0-9]\]\s*/, '')
    .split(/\s+[-\u2014]\s+/)[0]
    .trim()
    .toLowerCase()
}

/**
 * A weight that is absent, empty, or not a finite number counts as zero.
 * Returning NaN from a sort comparator violates its contract, and the
 * resulting order falls back to edge declaration order -- so a typo like
 * `weight=heavy` would quietly make routing depend on how the DOT file was
 * written rather than on what it says.
 */
function weightOf(edge: Edge): number {
  const raw = edge.attrs.weight
  if (raw === undefined) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function byWeightThenTarget(a: Edge, b: Edge): number {
  const wa = weightOf(a)
  const wb = weightOf(b)
  if (wa !== wb) return wb - wa
  return a.to.localeCompare(b.to)
}

/**
 * Select the next edge deterministically.
 *
 * Fail-fast: when the node failed, unconditional edges are NOT followed. Only
 * an edge whose condition explicitly matches the failure can route onward, so
 * a failure is loud by default rather than silently flowing downstream.
 */
export function selectEdge(
  graph: Graph,
  fromId: string,
  ctx: Context,
  outcome: Outcome,
): Edge | null {
  const edges = outgoingEdges(graph, fromId)
  if (edges.length === 0) return null

  // Step 1 establishes the ELIGIBLE SET; steps 2-5 then choose within it.
  // Conditions are a filter, not an early return: when several conditional
  // edges match, a preferred label still picks among them, which is what the
  // spec's five-step cascade describes.
  const matching = edges.filter(
    (e) =>
      e.attrs.condition !== undefined &&
      evaluateCondition(e.attrs.condition, ctx, outcome),
  )

  let eligible: Edge[]
  if (matching.length > 0) {
    eligible = matching
  } else if (outcome.status === Status.FAIL) {
    // Fail-fast: with no condition explicitly matching the failure, no
    // unconditional edge may carry it forward.
    return null
  } else {
    eligible = edges.filter((e) => e.attrs.condition === undefined)
  }
  if (eligible.length === 0) return null

  // 2. Preferred label.
  if (outcome.preferredLabel) {
    const want = normaliseLabel(outcome.preferredLabel)
    const byLabel = eligible.filter(
      (e) => e.attrs.label !== undefined && normaliseLabel(e.attrs.label) === want,
    )
    if (byLabel.length > 0) return byLabel.sort(byWeightThenTarget)[0]
  }

  // 3. Explicitly suggested next node ids.
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    const wanted = new Set(outcome.suggestedNextIds)
    const bySuggestion = eligible.filter((e) => wanted.has(e.to))
    if (bySuggestion.length > 0) return bySuggestion.sort(byWeightThenTarget)[0]
  }

  // 4 and 5. Weight descending, then lexical target id.
  return eligible.sort(byWeightThenTarget)[0]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/edge-select.test.ts
```
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): deterministic edge selection with fail-fast routing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Retry policy

**Files:**
- Create: `plugins/attractor/engine/src/core/retry.ts`
- Test: `plugins/attractor/engine/test/retry.test.ts`

**Interfaces:**
- Consumes: `Node`, `Graph` from `src/dot/graph.ts`.
- Produces: `RetryPolicy`, `resolveRetryPolicy(node, graph): RetryPolicy`, `backoffMs(policy, attempt): number`, `resolveRetryTarget(node, graph): string | null`.

`max_retries=N` means up to N+1 total attempts. Resolution order for a retry target is node `retry_target`, node `fallback_retry_target`, graph `retry_target`, graph `fallback_retry_target`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/retry.test.ts`:

```typescript
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
  const p = { maxRetries: 5, initialDelayMs: 200, factor: 2, maxDelayMs: 1000 }
  assert.equal(backoffMs(p, 0), 200)
  assert.equal(backoffMs(p, 1), 400)
  assert.equal(backoffMs(p, 2), 800)
  assert.equal(backoffMs(p, 3), 1000)
  assert.equal(backoffMs(p, 9), 1000)
})

test('node retry_target wins over graph retry_target', () => {
  assert.equal(resolveRetryTarget(G.nodes.get('loose')!, G), 'orient')
})

test('graph retry_target applies when the node declares none', () => {
  assert.equal(resolveRetryTarget(G.nodes.get('strict')!, G), 'attempt')
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
  assert.equal(resolveRetryTarget(g.nodes.get('a')!, g), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/retry.test.ts
```
Expected: FAIL — cannot resolve `../src/core/retry.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/retry.ts`:

```typescript
import { type Graph, type Node } from '../dot/graph.ts'

export interface RetryPolicy {
  maxRetries: number
  initialDelayMs: number
  factor: number
  maxDelayMs: number
}

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 200,
  factor: 2,
  maxDelayMs: 30_000,
}

function intAttr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

/** `max_retries=N` permits N+1 total attempts: one initial plus N retries. */
export function resolveRetryPolicy(node: Node, graph: Graph): RetryPolicy {
  const maxRetries =
    intAttr(node.attrs.max_retries) ??
    intAttr(graph.attrs.default_max_retries) ??
    intAttr(graph.attrs.default_max_retry) ??
    DEFAULT_POLICY.maxRetries
  return { ...DEFAULT_POLICY, maxRetries }
}

export function backoffMs(policy: RetryPolicy, attempt: number): number {
  const raw = policy.initialDelayMs * policy.factor ** attempt
  return Math.min(raw, policy.maxDelayMs)
}

/**
 * Resolve where an exhausted node should route. Node-level declarations win
 * over graph-level ones; a target naming a node that does not exist is
 * treated as absent rather than crashing the run.
 */
export function resolveRetryTarget(node: Node, graph: Graph): string | null {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    graph.attrs.retry_target,
    graph.attrs.fallback_retry_target,
  ]
  for (const c of candidates) {
    if (c && graph.nodes.has(c)) return c
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/retry.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): retry policy resolution and backoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Checkpoint and event log

**Files:**
- Create: `plugins/attractor/engine/src/core/checkpoint.ts`
- Create: `plugins/attractor/engine/src/run/events.ts`
- Test: `plugins/attractor/engine/test/checkpoint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Checkpoint`, `saveCheckpoint(runDir, cp)`, `loadCheckpoint(runDir): Checkpoint | null`, `RunEvent`, `EventLog` (methods `append`, `all`).

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/checkpoint.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Checkpoint, saveCheckpoint, loadCheckpoint } from '../src/core/checkpoint.ts'
import { EventLog } from '../src/run/events.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-test-'))
}

test('checkpoint round-trips', () => {
  const dir = tempDir()
  try {
    const cp: Checkpoint = {
      runId: 'r1',
      currentNode: 'verify',
      completed: ['start', 'attempt'],
      attempts: { attempt: 2 },
      context: { 'tool.last_line': 'green' },
      goalGatesSatisfied: ['verify'],
    }
    saveCheckpoint(dir, cp)
    assert.deepEqual(loadCheckpoint(dir), cp)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loading from a directory with no checkpoint returns null', () => {
  const dir = tempDir()
  try {
    assert.equal(loadCheckpoint(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('event log appends and reads back in order', () => {
  const dir = tempDir()
  try {
    const log = new EventLog(dir)
    log.append({ type: 'node.start', node: 'attempt' })
    log.append({ type: 'node.end', node: 'attempt', status: 'success' })
    const all = log.all()
    assert.equal(all.length, 2)
    assert.equal(all[0].type, 'node.start')
    assert.equal(all[1].status, 'success')
    assert.ok(typeof all[0].ts === 'string' && all[0].ts.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second EventLog on the same directory appends rather than truncating', () => {
  const dir = tempDir()
  try {
    new EventLog(dir).append({ type: 'a' })
    new EventLog(dir).append({ type: 'b' })
    assert.deepEqual(
      new EventLog(dir).all().map((e) => e.type),
      ['a', 'b'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a crash-truncated final line does not make the whole log unreadable', () => {
  const dir = tempDir()
  try {
    const log = new EventLog(dir)
    log.append({ type: 'first' })
    log.append({ type: 'second' })
    // Simulate a crash mid-append: a non-empty, unparseable trailing line.
    appendFileSync(join(dir, 'events.jsonl'), '{"type":"thi', 'utf8')

    assert.deepEqual(
      new EventLog(dir).all().map((e) => e.type),
      ['first', 'second'],
      'events written before the crash must still be readable',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saveCheckpoint leaves no temp file behind and overwrites cleanly', () => {
  const dir = tempDir()
  try {
    const base: Checkpoint = {
      runId: 'r1',
      currentNode: 'a',
      completed: [],
      attempts: {},
      context: {},
      goalGatesSatisfied: [],
    }
    saveCheckpoint(dir, base)
    saveCheckpoint(dir, { ...base, currentNode: 'b', completed: ['a'] })

    assert.equal(loadCheckpoint(dir)?.currentNode, 'b', 'the later write wins')
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.includes('.tmp')),
      [],
      'no temp file may survive a completed write',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/checkpoint.test.ts
```
Expected: FAIL — cannot resolve `../src/core/checkpoint.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/checkpoint.ts`:

```typescript
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export interface Checkpoint {
  runId: string
  currentNode: string | null
  completed: string[]
  attempts: Record<string, number>
  context: Record<string, string>
  goalGatesSatisfied: string[]
}

const FILE = 'checkpoint.json'

/** fsync a path, ignoring platforms that refuse to sync a directory. */
function syncPath(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch {
    // Some platforms (notably Windows) reject fsync on a directory handle.
    // Losing the directory sync is a weaker guarantee, not a failed write.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Write atomically AND durably.
 *
 * A checkpoint truncated by a crash mid-write would make a run unresumable,
 * which defeats the point of having one. Temp-then-rename gives atomicity:
 * a reader sees the old file or the new one, never a half-written one.
 *
 * Atomicity alone only survives the PROCESS dying. Without fsync the bytes
 * can still be in page cache when the machine loses power, so on recovery
 * the rename may be visible while the data behind it is stale or zeroed.
 * A pipeline can park at a human gate overnight, so reboot survival is the
 * case that actually matters: the temp file is synced before the rename and
 * the directory entry after it.
 */
export function saveCheckpoint(runDir: string, cp: Checkpoint): void {
  mkdirSync(runDir, { recursive: true })
  const target = join(runDir, FILE)
  // Unique temp name: two writers on one run directory must not share it.
  const temp = `${target}.${process.pid}.tmp`
  const fd = openSync(temp, 'w')
  try {
    writeFileSync(fd, JSON.stringify(cp, null, 2), 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, target)
  syncPath(runDir)
}

export function loadCheckpoint(runDir: string): Checkpoint | null {
  const target = join(runDir, FILE)
  if (!existsSync(target)) return null
  return JSON.parse(readFileSync(target, 'utf8')) as Checkpoint
}
```

Create `plugins/attractor/engine/src/run/events.ts`:

```typescript
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RunEvent {
  ts?: string
  type: string
  node?: string
  [key: string]: unknown
}

const FILE = 'events.jsonl'

/** Append-only run history. Every view over a run derives from this file. */
export class EventLog {
  private path: string

  constructor(runDir: string) {
    mkdirSync(runDir, { recursive: true })
    this.path = join(runDir, FILE)
  }

  append(event: RunEvent): void {
    const stamped: RunEvent = { ts: new Date().toISOString(), ...event }
    appendFileSync(this.path, `${JSON.stringify(stamped)}\n`, 'utf8')
  }

  /**
   * Read the log back.
   *
   * A crash during an append can leave a truncated final line. That line is
   * non-empty, so it survives the blank-line filter and would throw from
   * JSON.parse -- making the WHOLE log unreadable in exactly the situation
   * the log exists to survive. An append-only file can only be damaged at
   * its end, so an unparseable line ends the read and everything before it
   * is still returned.
   */
  all(): RunEvent[] {
    if (!existsSync(this.path)) return []
    const events: RunEvent[] = []
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        events.push(JSON.parse(line) as RunEvent)
      } catch {
        break
      }
    }
    return events
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/checkpoint.test.ts
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): atomic checkpoints and append-only event log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Tool handler

**Files:**
- Create: `plugins/attractor/engine/src/handlers/types.ts`
- Create: `plugins/attractor/engine/src/handlers/tool.ts`
- Test: `plugins/attractor/engine/test/tool.test.ts`

**Interfaces:**
- Consumes: `Node`, `Graph`; `Context`; `Outcome`, `Status`; `substitute`; `EventLog`.
- Produces: `HandlerCtx`, `Handler`, `Backend` in `src/handlers/types.ts`; `ToolHandler` in `src/handlers/tool.ts`.

The stale-label rule is doctrine: a **failing** tool node must not refresh `tool.last_line`. Pipelines depend on this, and a test locks it in.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/tool.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { ToolHandler } from '../src/handlers/tool.ts'

const G = parseDot(`
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  green [shape=parallelogram, tool_command="printf green"]
  red   [shape=parallelogram, tool_command="printf red; exit 1"]
  subst [shape=parallelogram, tool_command="printf $flavour"]
  multi [shape=parallelogram, tool_command="echo noise; printf chosen"]
  start -> green -> red -> subst -> multi -> done
}
`)

function run(nodeId: string, ctx: Context) {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-tool-'))
  const handler = new ToolHandler()
  return handler
    .execute({
      node: G.nodes.get(nodeId)!,
      graph: G,
      context: ctx,
      runDir: dir,
      cwd: dir,
      events: new EventLog(dir),
    })
    .finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('exit zero succeeds and records the last stdout line', async () => {
  const ctx = Context.from({})
  const outcome = await run('green', ctx)
  assert.equal(outcome.status, Status.SUCCESS)
  assert.equal(ctx.get('tool.last_line'), 'green')
})

test('only the final non-empty line becomes the routing label', async () => {
  const ctx = Context.from({})
  await run('multi', ctx)
  assert.equal(ctx.get('tool.last_line'), 'chosen')
})

test('non-zero exit fails', async () => {
  const ctx = Context.from({})
  const outcome = await run('red', ctx)
  assert.equal(outcome.status, Status.FAIL)
})

test('a failing tool node does NOT refresh tool.last_line', async () => {
  const ctx = Context.from({})
  await run('green', ctx)
  assert.equal(ctx.get('tool.last_line'), 'green')
  await run('red', ctx)
  assert.equal(
    ctx.get('tool.last_line'),
    'green',
    'stale label rule: a failed tool node leaves the previous label in place',
  )
})

test('the command is substituted from context before execution', async () => {
  const ctx = Context.from({ flavour: 'vanilla' })
  await run('subst', ctx)
  assert.equal(ctx.get('tool.last_line'), 'vanilla')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/tool.test.ts
```
Expected: FAIL — cannot resolve `../src/handlers/tool.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/handlers/types.ts`:

```typescript
import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { type Outcome } from '../core/outcome.ts'
import { type EventLog } from '../run/events.ts'

export interface HandlerCtx {
  node: Node
  graph: Graph
  context: Context
  /** Directory holding this run's checkpoint, events and per-node artifacts. */
  runDir: string
  /** Working directory for shell commands and LLM workers. */
  cwd: string
  events: EventLog
}

export interface Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}

/**
 * The single seam between the control plane and whatever executes an LLM
 * task. Plan 2 supplies a `claude -p` implementation; tests supply a stub.
 */
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph): Promise<Outcome>
}
```

Create `plugins/attractor/engine/src/handlers/tool.ts`:

```typescript
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Status, type Outcome } from '../core/outcome.ts'
import { substitute } from '../core/substitute.ts'
import { type Handler, type HandlerCtx } from './types.ts'

interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { cwd })
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined

    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    }
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}${String(err)}` })
    })
  })
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return lines.length > 0 ? lines[lines.length - 1].trim() : ''
}

function parseDuration(value: string | undefined): number {
  if (!value) return 0
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(value.trim())
  if (!m) return 0
  const n = Number.parseInt(m[1], 10)
  const unit = m[2] ?? 's'
  const factors: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return n * factors[unit]
}

/**
 * Executes a `parallelogram` node: a deterministic shell command whose exit
 * code and final stdout line drive routing.
 *
 * STALE-LABEL RULE: on a non-zero exit the handler returns early WITHOUT
 * writing `tool.last_line`. Pipelines rely on this — a gate's previous label
 * must survive a failed re-entry rather than being overwritten with the
 * failure's output.
 */
export class ToolHandler implements Handler {
  async execute(ctx: HandlerCtx): Promise<Outcome> {
    const raw = ctx.node.attrs.tool_command
    if (!raw) {
      return { status: Status.FAIL, notes: `node ${ctx.node.id} has no tool_command` }
    }
    const command = substitute(raw, ctx.context)
    const timeoutMs = parseDuration(ctx.node.attrs.timeout)

    ctx.events.append({ type: 'node.tool.start', node: ctx.node.id })
    const result = await runShell(command, ctx.cwd, timeoutMs)

    const nodeDir = join(ctx.runDir, ctx.node.id)
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(join(nodeDir, 'command.sh'), command, 'utf8')
    writeFileSync(join(nodeDir, 'stdout.txt'), result.stdout, 'utf8')
    writeFileSync(join(nodeDir, 'stderr.txt'), result.stderr, 'utf8')

    ctx.events.append({
      type: 'node.tool.end',
      node: ctx.node.id,
      exitCode: result.code,
    })

    if (result.code !== 0) {
      return {
        status: Status.FAIL,
        notes: `exit ${result.code}: ${lastNonEmptyLine(result.stderr) || lastNonEmptyLine(result.stdout)}`,
      }
    }

    const label = lastNonEmptyLine(result.stdout)
    ctx.context.set('tool.last_line', label)
    return {
      status: Status.SUCCESS,
      contextUpdates: { 'tool.last_line': label },
      notes: label,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/tool.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): tool handler with the stale-label rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Stub backend and box handler

**Files:**
- Create: `plugins/attractor/engine/src/handlers/stub.ts`
- Create: `plugins/attractor/engine/src/handlers/box.ts`
- Test: `plugins/attractor/engine/test/box.test.ts`

**Interfaces:**
- Consumes: `Backend`, `Handler`, `HandlerCtx`; `Outcome`, `Status`; `substitute`.
- Produces: `StubBackend` (constructor takes `Record<string, Outcome | Outcome[]>`; method `calls(): Array<{ nodeId: string; prompt: string }>`); `BoxHandler` (constructor takes a `Backend`).

The fail-closed goal gate lives here: a `goal_gate=true` node whose backend returns prose with no verdict yields `RETRY`, never `SUCCESS`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/box.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { EventLog } from '../src/run/events.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { BoxHandler } from '../src/handlers/box.ts'

const G = parseDot(`
digraph G {
  graph [goal="ship the thing"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  plain [shape=box, prompt="Advance $goal now"]
  gate  [shape=box, goal_gate=true, prompt="Judge it"]
  start -> plain -> gate -> done
}
`)

async function run(nodeId: string, backend: StubBackend, ctx = Context.from({ goal: 'ship the thing' })) {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-box-'))
  try {
    return await new BoxHandler(backend).execute({
      node: G.nodes.get(nodeId)!,
      graph: G,
      context: ctx,
      runDir: dir,
      cwd: dir,
      events: new EventLog(dir),
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the prompt is expanded from context before dispatch', async () => {
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'ok' } })
  await run('plain', backend)
  assert.equal(backend.calls()[0].prompt, 'Advance ship the thing now')
})

test('context updates from the backend are merged', async () => {
  const backend = new StubBackend({
    plain: { status: Status.SUCCESS, contextUpdates: { phase: 'built' } },
  })
  const ctx = Context.from({ goal: 'g' })
  await run('plain', backend, ctx)
  assert.equal(ctx.get('phase'), 'built')
})

test('an ordinary node ending in prose succeeds', async () => {
  const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'I did the thing' } })
  const outcome = await run('plain', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})

test('a goal gate ending in bare prose returns RETRY, not SUCCESS', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
  })
  const outcome = await run('gate', backend)
  assert.equal(
    outcome.status,
    Status.RETRY,
    'fail-closed: a goal gate cannot be satisfied by prose',
  )
})

test('a goal gate carrying an explicit verdict is honoured', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'all criteria pass' },
  })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.SUCCESS)
})

test('a goal gate is satisfied by suggested next ids alone', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, suggestedNextIds: ['package'], notes: 'done' },
  })
  assert.equal((await run('gate', backend)).status, Status.SUCCESS)
})

test('a goal gate is satisfied by context updates alone', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, contextUpdates: { verdict: 'ship' }, notes: 'done' },
  })
  assert.equal((await run('gate', backend)).status, Status.SUCCESS)
})

test('an empty preferred label does not satisfy a goal gate', async () => {
  const backend = new StubBackend({
    gate: { status: Status.SUCCESS, preferredLabel: '', notes: 'looks fine to me' },
  })
  assert.equal((await run('gate', backend)).status, Status.RETRY)
})

test('a PARTIAL goal gate ending in prose is also downgraded', async () => {
  const backend = new StubBackend({ gate: { status: Status.PARTIAL, notes: 'mostly there' } })
  assert.equal((await run('gate', backend)).status, Status.RETRY)
})

test('the persisted outcome records the downgraded status, not the raw one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-box-artifact-'))
  try {
    const backend = new StubBackend({
      gate: { status: Status.SUCCESS, notes: 'NOT CONVERGED - 2 of 7 criteria pass' },
    })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('gate')!,
      graph: G,
      context: Context.from({ goal: 'g' }),
      runDir: dir,
      cwd: dir,
      events: new EventLog(dir),
    })
    const persisted = JSON.parse(readFileSync(join(dir, 'gate', 'outcome.json'), 'utf8'))
    assert.equal(
      persisted.status,
      Status.RETRY,
      'the artifact must not claim success when the gate was downgraded',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a goal gate reporting failure stays failed', async () => {
  const backend = new StubBackend({ gate: { status: Status.FAIL, notes: 'broken' } })
  const outcome = await run('gate', backend)
  assert.equal(outcome.status, Status.FAIL)
})

test('scripted sequences advance on each call', async () => {
  const backend = new StubBackend({
    plain: [
      { status: Status.FAIL, notes: 'first' },
      { status: Status.SUCCESS, notes: 'second' },
    ],
  })
  assert.equal((await run('plain', backend)).status, Status.FAIL)
  assert.equal((await run('plain', backend)).status, Status.SUCCESS)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/box.test.ts
```
Expected: FAIL — cannot resolve `../src/handlers/stub.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/handlers/stub.ts`:

```typescript
import { type Graph, type Node } from '../dot/graph.ts'
import { type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type Backend } from './types.ts'

/**
 * Deterministic backend for tests and for `--dry-run`. Scripted by node id;
 * a node mapped to an array returns each entry in turn, so a test can drive a
 * convergence loop through failure and then success.
 */
export class StubBackend implements Backend {
  private script: Record<string, Outcome | Outcome[]>
  private cursor: Map<string, number> = new Map()
  private log: Array<{ nodeId: string; prompt: string }> = []

  constructor(script: Record<string, Outcome | Outcome[]> = {}) {
    this.script = script
  }

  async run(node: Node, prompt: string, _context: Context, _graph: Graph): Promise<Outcome> {
    this.log.push({ nodeId: node.id, prompt })
    const entry = this.script[node.id]
    if (entry === undefined) {
      return { status: Status.SUCCESS, notes: `stub: no script for ${node.id}` }
    }
    if (!Array.isArray(entry)) return entry
    const i = this.cursor.get(node.id) ?? 0
    this.cursor.set(node.id, Math.min(i + 1, entry.length - 1))
    return entry[Math.min(i, entry.length - 1)]
  }

  calls(): Array<{ nodeId: string; prompt: string }> {
    return this.log
  }
}
```

Create `plugins/attractor/engine/src/handlers/box.ts`:

```typescript
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Status, type Outcome } from '../core/outcome.ts'
import { substitute } from '../core/substitute.ts'
import { type Backend, type Handler, type HandlerCtx } from './types.ts'

/**
 * A goal gate must be earned with evidence. An outcome that carries no
 * routing signal — no preferred label, no suggested nodes, no context
 * updates — is prose, and prose cannot satisfy a gate.
 *
 * This closes a documented upstream failure: a judge wrote "NOT CONVERGED"
 * and was recorded a success by a fail-open default, so the designed replan
 * loop never fired and the run exited false-success with no work product.
 */
function carriesVerdict(outcome: Outcome): boolean {
  // An empty label is not a routing signal, for the same reason an empty
  // suggestion list and an empty update map are not.
  if (outcome.preferredLabel !== undefined && outcome.preferredLabel.length > 0) return true
  if (outcome.suggestedNextIds !== undefined && outcome.suggestedNextIds.length > 0) return true
  if (outcome.contextUpdates !== undefined && Object.keys(outcome.contextUpdates).length > 0) {
    return true
  }
  return false
}

export class BoxHandler implements Handler {
  private backend: Backend

  constructor(backend: Backend) {
    this.backend = backend
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    const rawPrompt = ctx.node.attrs.prompt ?? ctx.graph.attrs.goal ?? ''
    const prompt = substitute(rawPrompt, ctx.context)

    ctx.events.append({ type: 'node.box.start', node: ctx.node.id })
    const outcome = await this.backend.run(ctx.node, prompt, ctx.context, ctx.graph)

    const nodeDir = join(ctx.runDir, ctx.node.id)
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(join(nodeDir, 'prompt.md'), prompt, 'utf8')

    // Context updates are merged BEFORE the gate check: a gate that wrote
    // evidence into context has produced a routing signal.
    if (outcome.contextUpdates) ctx.context.merge(outcome.contextUpdates)

    const isGoalGate = ctx.node.attrs.goal_gate === 'true'
    let finalStatus = outcome.status
    if (
      isGoalGate &&
      (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) &&
      !carriesVerdict(outcome)
    ) {
      finalStatus = Status.RETRY
      ctx.events.append({
        type: 'node.box.goal_gate_unverified',
        node: ctx.node.id,
        message: 'goal gate returned prose with no verdict; failing closed to RETRY',
      })
    }

    const finalOutcome: Outcome = { ...outcome, status: finalStatus }

    // Persist AFTER the gate decision. Writing the raw outcome would record
    // "success" in the per-node artifact while the event log and the return
    // value say "retry" -- and the operator reading that artifact is
    // debugging precisely the case the gate exists to catch.
    writeFileSync(join(nodeDir, 'outcome.json'), JSON.stringify(finalOutcome, null, 2), 'utf8')

    ctx.events.append({ type: 'node.box.end', node: ctx.node.id, status: finalStatus })
    return finalOutcome
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/box.test.ts
```
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): box handler with fail-closed goal gates, stub backend

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Engine traversal

**Files:**
- Create: `plugins/attractor/engine/src/core/engine.ts`
- Test: `plugins/attractor/engine/test/engine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: `EngineOptions`, `RunResult`, `Engine` (constructor takes `EngineOptions`; method `run(): Promise<RunResult>`), `defaultHandlers(backend): Map<HandlerKind, Handler>`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/engine.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDot } from '../src/dot/parse.ts'
import { Context } from '../src/core/context.ts'
import { Status, type Outcome } from '../src/core/outcome.ts'
import { StubBackend } from '../src/handlers/stub.ts'
import { Engine, defaultHandlers } from '../src/core/engine.ts'
import { loadCheckpoint } from '../src/core/checkpoint.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'attractor-engine-'))
}

async function execute(src: string, script: Record<string, Outcome | Outcome[]> = {}) {
  const dir = tempDir()
  const graph = parseDot(src)
  const backend = new StubBackend(script)
  const engine = new Engine({
    graph,
    context: Context.from({}),
    runDir: dir,
    cwd: dir,
    handlers: defaultHandlers(backend),
  })
  const result = await engine.run()
  return { result, dir, backend }
}

const LINEAR = `
digraph L {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="first"]
  b [shape=box, prompt="second"]
  start -> a -> b -> done
}
`

test('a linear pipeline runs to the exit node', async () => {
  const { result, dir } = await execute(LINEAR)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.deepEqual(result.path, ['start', 'a', 'b', 'done'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a checkpoint is written as the run advances', async () => {
  const { dir } = await execute(LINEAR)
  try {
    const cp = loadCheckpoint(dir)
    assert.ok(cp, 'checkpoint exists')
    assert.ok(cp!.completed.includes('a'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const CONVERGENCE = `
digraph C {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  attempt [shape=box, prompt="work"]
  verify  [shape=parallelogram, tool_command="if [ -f .ok ]; then printf green; else touch .ok; printf red; exit 1; fi"]
  start -> attempt -> verify
  verify -> done    [condition="context.tool.last_line=green && outcome=success"]
  verify -> attempt [condition="outcome=fail"]
}
`

test('a convergence loop iterates until the gate goes green', async () => {
  const { result, dir } = await execute(CONVERGENCE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(result.path.filter((n) => n === 'attempt').length, 2)
    assert.equal(result.path[result.path.length - 1], 'done')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const NO_ROUTE = `
digraph N {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  start -> a -> done
}
`

test('a failure with no explicit failure route terminates the run', async () => {
  const { result, dir } = await execute(NO_ROUTE, { a: { status: Status.FAIL, notes: 'boom' } })
  try {
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /no matching edge/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const RETRYING = `
digraph R {
  graph [default_max_retries=2]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  start -> a -> done
}
`

test('a retry status re-executes the node up to the cap then fails', async () => {
  const { result, backend, dir } = await execute(RETRYING, {
    a: { status: Status.RETRY, notes: 'again' },
  })
  try {
    assert.equal(backend.calls().filter((c) => c.nodeId === 'a').length, 3)
    assert.equal(result.status, Status.FAIL)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a retry that later succeeds continues the run', async () => {
  const { result, backend, dir } = await execute(RETRYING, {
    a: [
      { status: Status.RETRY, notes: 'again' },
      { status: Status.SUCCESS, notes: 'ok' },
    ],
  })
  try {
    assert.equal(result.status, Status.SUCCESS)
    // Asserting SUCCESS alone would not discriminate: RETRY is an edge-eligible
    // status, so with the retry block deleted the first outcome would simply
    // take the unconditional edge and still finish successfully. The call count
    // is what proves the node was actually re-executed.
    assert.equal(
      backend.calls().filter((c) => c.nodeId === 'a').length,
      2,
      'the node must be executed twice, not routed onward on the first RETRY',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const GOAL_GATE = `
digraph U {
  graph [retry_target="fix"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  fix  [shape=box, prompt="fix it"]
  gate [shape=parallelogram, goal_gate=true, tool_command="if [ -f .g ]; then printf ok; else touch .g; printf ok; fi"]
  start -> fix -> gate -> done
}
`

// The gate FAILS, and an explicit failure edge carries the run to the exit
// anyway. Nothing but the goal-gate check stands between this graph and a
// false success -- which is the entire reason goal gates exist.
const UNSATISFIED_GATE = `
digraph UG {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work [shape=box, prompt="work"]
  gate [shape=parallelogram, goal_gate=true, max_retries=0,
        tool_command="printf notyet; exit 1"]
  start -> work -> gate
  gate -> done [condition="outcome=success"]
  gate -> done [condition="outcome=fail"]
}
`

test('reaching the exit with an unsatisfied goal gate fails loudly', async () => {
  const { result, dir } = await execute(UNSATISFIED_GATE)
  try {
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /unsatisfied goal gates/i)
    assert.ok(result.notes?.includes('gate'), 'the message names the offending gate')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Same shape, but the graph declares somewhere to go back to, and the gate
// succeeds on its second visit.
const UNSATISFIED_THEN_RETRIED = `
digraph UGR {
  graph [retry_target="work"]
  start [shape=Mdiamond]
  done  [shape=Msquare]
  work [shape=box, prompt="work"]
  gate [shape=parallelogram, goal_gate=true, max_retries=0,
        tool_command="if [ -f .seen ]; then printf ok; else touch .seen; printf notyet; exit 1; fi"]
  start -> work -> gate
  gate -> done [condition="outcome=success"]
  gate -> done [condition="outcome=fail"]
}
`

test('an unsatisfied goal gate at the exit routes to the retry target', async () => {
  const { result, dir } = await execute(UNSATISFIED_THEN_RETRIED)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.equal(
      result.path.filter((n) => n === 'work').length,
      2,
      'the exit must have sent the run back to work rather than exiting unearned',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a satisfied goal gate permits exit', async () => {
  const { result, dir } = await execute(GOAL_GATE)
  try {
    assert.equal(result.status, Status.SUCCESS)
    assert.ok(result.path.includes('done'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const STEP_CAP = `
digraph S {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=box, prompt="x"]
  b [shape=box, prompt="y"]
  start -> a
  a -> b
  b -> a
}
`

test('the step cap terminates a non-terminating graph', async () => {
  const dir = tempDir()
  try {
    const engine = new Engine({
      graph: parseDot(STEP_CAP),
      context: Context.from({}),
      runDir: dir,
      cwd: dir,
      handlers: defaultHandlers(new StubBackend({})),
      maxSteps: 12,
    })
    const result = await engine.run()
    assert.equal(result.status, Status.FAIL)
    assert.match(result.notes ?? '', /step cap/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/engine.test.ts
```
Expected: FAIL — cannot resolve `../src/core/engine.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/core/engine.ts`:

```typescript
import { type Graph, type HandlerKind, Handler as Kind } from '../dot/graph.ts'
import { type Context } from './context.ts'
import { Status, type Outcome } from './outcome.ts'
import { selectEdge } from './edge-select.ts'
import { resolveRetryPolicy, resolveRetryTarget, backoffMs } from './retry.ts'
import { saveCheckpoint, type Checkpoint } from './checkpoint.ts'
import { EventLog } from '../run/events.ts'
import { type Backend, type Handler } from '../handlers/types.ts'
import { ToolHandler } from '../handlers/tool.ts'
import { BoxHandler } from '../handlers/box.ts'

export interface EngineOptions {
  graph: Graph
  context: Context
  runDir: string
  cwd: string
  handlers: Map<HandlerKind, Handler>
  maxSteps?: number
  runId?: string
}

export interface RunResult {
  status: Status
  path: string[]
  notes?: string
}

/** A no-op handler: start, exit and diamond nodes exist to shape routing. */
class PassthroughHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: Status.SUCCESS }
  }
}

export function defaultHandlers(backend: Backend): Map<HandlerKind, Handler> {
  const passthrough = new PassthroughHandler()
  return new Map<HandlerKind, Handler>([
    [Kind.START, passthrough],
    [Kind.EXIT, passthrough],
    [Kind.CONDITIONAL, passthrough],
    [Kind.TOOL, new ToolHandler()],
    [Kind.CODERGEN, new BoxHandler(backend)],
  ])
}

const DEFAULT_MAX_STEPS = 500

export class Engine {
  private opts: EngineOptions
  private events: EventLog
  private path: string[] = []
  private completed: string[] = []
  private attempts: Map<string, number> = new Map()
  private goalGatesSatisfied: Set<string> = new Set()

  constructor(opts: EngineOptions) {
    this.opts = opts
    this.events = new EventLog(opts.runDir)
  }

  private checkpoint(current: string | null): void {
    const cp: Checkpoint = {
      runId: this.opts.runId ?? 'run',
      currentNode: current,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: this.opts.context.snapshot(),
      goalGatesSatisfied: [...this.goalGatesSatisfied],
    }
    saveCheckpoint(this.opts.runDir, cp)
  }

  private unsatisfiedGoalGates(): string[] {
    const gates: string[] = []
    for (const node of this.opts.graph.nodes.values()) {
      if (node.attrs.goal_gate === 'true' && !this.goalGatesSatisfied.has(node.id)) {
        gates.push(node.id)
      }
    }
    return gates
  }

  async run(): Promise<RunResult> {
    const { graph, context } = this.opts
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS

    const startNode = [...graph.nodes.values()].find((n) => n.handler === Kind.START)
    if (!startNode) {
      return { status: Status.FAIL, path: [], notes: 'graph has no start node' }
    }

    // Seed context with graph-level values so $goal expands everywhere.
    for (const [k, v] of Object.entries(graph.attrs)) {
      if (!context.has(k)) context.set(k, v)
    }

    let currentId: string | null = startNode.id
    this.events.append({ type: 'pipeline.start', node: startNode.id })

    for (let step = 0; step < maxSteps; step++) {
      if (currentId === null) break
      const node = graph.nodes.get(currentId)
      if (!node) {
        return { status: Status.FAIL, path: this.path, notes: `unknown node ${currentId}` }
      }

      this.path.push(node.id)
      this.checkpoint(node.id)

      const handler = this.opts.handlers.get(node.handler)
      if (!handler) {
        return {
          status: Status.FAIL,
          path: this.path,
          notes: `no handler registered for ${node.handler} (node ${node.id})`,
        }
      }

      const attempt = this.attempts.get(node.id) ?? 0
      let outcome = await handler.execute({
        node,
        graph,
        context,
        runDir: this.opts.runDir,
        cwd: this.opts.cwd,
        events: this.events,
      })

      // RETRY re-executes this node until the policy is exhausted.
      if (outcome.status === Status.RETRY) {
        const policy = resolveRetryPolicy(node, graph)
        if (attempt < policy.maxRetries) {
          this.attempts.set(node.id, attempt + 1)
          const delay = backoffMs(policy, attempt)
          this.events.append({
            type: 'node.retry',
            node: node.id,
            attempt: attempt + 1,
            delayMs: delay,
          })
          if (delay > 0) await new Promise((r) => setTimeout(r, delay))
          continue
        }
        const target = resolveRetryTarget(node, graph)
        this.events.append({ type: 'node.retry.exhausted', node: node.id, target })
        if (target) {
          this.attempts.set(node.id, 0)
          currentId = target
          continue
        }
        outcome = {
          ...outcome,
          status: Status.FAIL,
          notes: `retries exhausted for ${node.id} with no retry target`,
        }
      }

      this.attempts.set(node.id, 0)
      if (!this.completed.includes(node.id)) this.completed.push(node.id)

      if (
        node.attrs.goal_gate === 'true' &&
        (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL)
      ) {
        this.goalGatesSatisfied.add(node.id)
      }

      if (node.handler === Kind.EXIT) {
        const unsatisfied = this.unsatisfiedGoalGates()
        if (unsatisfied.length > 0) {
          const target = resolveRetryTarget(node, graph)
          this.events.append({
            type: 'pipeline.goal_gate_block',
            node: node.id,
            unsatisfied,
            target,
          })
          if (target) {
            currentId = target
            continue
          }
          return {
            status: Status.FAIL,
            path: this.path,
            notes: `exit reached with unsatisfied goal gates: ${unsatisfied.join(', ')}`,
          }
        }
        this.events.append({ type: 'pipeline.end', node: node.id, status: Status.SUCCESS })
        this.checkpoint(null)
        return { status: Status.SUCCESS, path: this.path, notes: outcome.notes }
      }

      const edge = selectEdge(graph, node.id, context, outcome)
      if (!edge) {
        const status = outcome.status === Status.FAIL ? Status.FAIL : Status.SUCCESS
        this.events.append({ type: 'pipeline.end', node: node.id, status })
        this.checkpoint(null)
        return {
          status,
          path: this.path,
          notes:
            status === Status.FAIL
              ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ''}`
              : outcome.notes,
        }
      }

      this.events.append({ type: 'edge.taken', node: node.id, to: edge.to })
      currentId = edge.to
    }

    this.checkpoint(currentId)
    return {
      status: Status.FAIL,
      path: this.path,
      notes: `step cap of ${maxSteps} reached without terminating`,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/engine.test.ts
```
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): traversal loop with goal gates, retries and step cap

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: CLI

**Files:**
- Create: `plugins/attractor/engine/src/cli.ts`
- Test: `plugins/attractor/engine/test/cli.test.ts`

**Interfaces:**
- Consumes: `parseDot`, `lint`, `hasErrors`, `Engine`, `defaultHandlers`, `StubBackend`, `Context`.
- Produces: `main(argv: string[]): Promise<number>` — returns a process exit code.

Commands: `attractor lint <file>`; `attractor run <file> [--param k=v] [--cwd dir] [--run-dir dir] [--stub]`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/cli.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.ts'

function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-cli-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

const GOOD = `
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  echo [shape=parallelogram, tool_command="printf ok"]
  start -> echo -> done
}
`

const BAD = `
digraph B {
  done [shape=Msquare]
  a [shape=box]
  a -> done
}
`

test('lint exits 0 for a valid graph', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    assert.equal(await main(['lint', file]), 0)
  })
})

test('lint exits 1 for a graph with errors', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'bad.dot')
    writeFileSync(file, BAD, 'utf8')
    assert.equal(await main(['lint', file]), 1)
  })
})

// Lints as an ERROR (TOPO-004: `orphan` is unreachable) but would otherwise
// execute start -> a -> done and exit 0. That gap is what makes the next test
// discriminate: BAD would fail inside the engine anyway for lacking a start
// node, so using it here would pass even with the lint gate deleted.
const LINT_FAILS_BUT_WOULD_RUN = `
digraph LR {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  orphan [shape=box, prompt="never reached"]
  start -> a -> done
}
`

test('run refuses to execute a graph that fails lint', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'lintfail.dot')
    const runDir = join(dir, 'r')
    writeFileSync(file, LINT_FAILS_BUT_WOULD_RUN, 'utf8')

    assert.equal(await main(['run', file, '--cwd', dir, '--run-dir', runDir, '--stub']), 1)
    assert.equal(
      existsSync(runDir),
      false,
      'refusing must happen before any run state is created',
    )
  })
})

test('run executes a valid graph and exits 0', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 0)
  })
})

test('--param values reach the graph as context', async () => {
  await withTemp(async (dir) => {
    const src = `
      digraph P {
        start [shape=Mdiamond]
        done  [shape=Msquare]
        w [shape=parallelogram, tool_command="printf $flavour > out.txt; printf ok"]
        start -> w -> done
      }
    `
    const file = join(dir, 'p.dot')
    writeFileSync(file, src, 'utf8')
    const code = await main([
      'run', file, '--param', 'flavour=vanilla',
      '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 0)
    const { readFileSync } = await import('node:fs')
    assert.equal(readFileSync(join(dir, 'out.txt'), 'utf8'), 'vanilla')
  })
})

test('an unknown command exits 2', async () => {
  assert.equal(await main(['wat']), 2)
})

test('a missing pipeline file exits 2 rather than throwing', async () => {
  await withTemp(async (dir) => {
    const missing = join(dir, 'nope.dot')
    assert.equal(await main(['lint', missing]), 2)
    assert.equal(await main(['run', missing, '--run-dir', join(dir, 'r'), '--stub']), 2)
  })
})

test('a malformed --param is a usage error, not silently dropped', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'good.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--param', 'flavour',
      '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 2, 'a typo in --param must stop the run, not start it short a value')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/cli.test.ts
```
Expected: FAIL — cannot resolve `../src/cli.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/cli.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDot } from './dot/parse.ts'
import { lint, hasErrors } from './dot/lint.ts'
import { Context } from './core/context.ts'
import { Engine, defaultHandlers } from './core/engine.ts'
import { StubBackend } from './handlers/stub.ts'
import { Status } from './core/outcome.ts'

const USAGE = `attractor - DOT pipeline runner

Usage:
  attractor lint <file.dot>
  attractor run  <file.dot> [--param key=value]... [--cwd dir] [--run-dir dir] [--stub]

Options:
  --param key=value   Seed a context value. Repeatable.
  --cwd dir           Working directory for shell commands. Default: current directory.
  --run-dir dir       Where checkpoints, events and node artifacts are written.
                      Default: .attractor/runs/<timestamp>
  --stub              Execute LLM nodes with the deterministic stub backend.
`

interface RunArgs {
  file: string
  params: Record<string, string>
  cwd: string
  runDir: string
  stub: boolean
}

function parseRunArgs(argv: string[]): RunArgs | null {
  const file = argv[0]
  if (!file || file.startsWith('--')) return null
  const params: Record<string, string> = {}
  let cwd = process.cwd()
  let runDir = ''
  let stub = false

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--param') {
      const pair = argv[++i] ?? ''
      const eq = pair.indexOf('=')
      if (eq <= 0) {
        // Silently dropping a typo'd param would run the whole pipeline with
        // a missing context value and nothing linking back to the mistake.
        process.stderr.write(`invalid --param "${pair}": expected key=value\n`)
        return null
      }
      params[pair.slice(0, eq)] = pair.slice(eq + 1)
    } else if (arg === '--cwd') {
      cwd = resolve(argv[++i] ?? '.')
    } else if (arg === '--run-dir') {
      runDir = resolve(argv[++i] ?? '.')
    } else if (arg === '--stub') {
      stub = true
    }
  }

  if (runDir === '') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    runDir = resolve(cwd, '.attractor', 'runs', stamp)
  }
  return { file: resolve(file), params, cwd, runDir, stub }
}

/** Read a pipeline file, reporting an operator-readable error instead of a stack trace. */
function readPipeline(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`cannot read ${file}: ${reason}\n`)
    return null
  }
}

function reportDiagnostics(file: string, source: string): boolean {
  const diags = lint(parseDot(source))
  for (const d of diags) {
    const where = d.node ? `${file}:${d.node}` : file
    process.stderr.write(`${d.severity.toUpperCase()} ${d.code} ${where}: ${d.message}\n`)
  }
  return hasErrors(diags)
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0]

  if (command === 'lint') {
    const file = argv[1]
    if (!file) {
      process.stderr.write(USAGE)
      return 2
    }
    const resolved = resolve(file)
    const source = readPipeline(resolved)
    if (source === null) return 2
    if (reportDiagnostics(resolved, source)) return 1
    process.stdout.write(`${file}: no errors\n`)
    return 0
  }

  if (command === 'run') {
    const args = parseRunArgs(argv.slice(1))
    if (!args) {
      process.stderr.write(USAGE)
      return 2
    }
    const source = readPipeline(args.file)
    if (source === null) return 2
    if (reportDiagnostics(args.file, source)) {
      process.stderr.write('refusing to run a graph with lint errors\n')
      return 1
    }

    if (!args.stub) {
      process.stderr.write(
        'no LLM backend is available in this build; re-run with --stub\n',
      )
      return 2
    }

    const graph = parseDot(source)
    const engine = new Engine({
      graph,
      context: Context.from(args.params),
      runDir: args.runDir,
      cwd: args.cwd,
      handlers: defaultHandlers(new StubBackend({})),
    })
    const result = await engine.run()
    process.stdout.write(`status: ${result.status}\n`)
    process.stdout.write(`path:   ${result.path.join(' -> ')}\n`)
    if (result.notes) process.stdout.write(`notes:  ${result.notes}\n`)
    process.stdout.write(`run:    ${args.runDir}\n`)
    return result.status === Status.SUCCESS ? 0 : 1
  }

  process.stderr.write(USAGE)
  return 2
}

// Only run when invoked directly, so tests can import `main` freely.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      // Without this, anything thrown becomes an unhandled rejection and the
      // operator gets a stack trace with no exit code they can act on.
      process.stderr.write(`attractor: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/cli.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(engine): attractor lint and run CLI

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Bundle and full-suite gate

**Files:**
- Create: `plugins/attractor/engine/test/bundle.test.ts`
- Create: `plugins/attractor/README.md`
- Modify: `plugins/attractor/engine/package.json` (no change if Task 1's build script is intact)

**Interfaces:**
- Consumes: everything.
- Produces: `plugins/attractor/dist/attractor.js` — a single dependency-free executable bundle.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/bundle.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BUNDLE = resolve(import.meta.dirname, '..', '..', 'dist', 'attractor.js')

test('the bundle exists after npm run build', () => {
  assert.ok(
    existsSync(BUNDLE),
    'dist/attractor.js missing - run `npm run build` in plugins/attractor/engine',
  )
})

test('the bundle lints a graph with no node_modules present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-'))
  try {
    const file = join(dir, 'g.dot')
    writeFileSync(
      file,
      `digraph G {
         start [shape=Mdiamond]
         done  [shape=Msquare]
         a [shape=parallelogram, tool_command="printf ok"]
         start -> a -> done
       }`,
      'utf8',
    )
    const out = execFileSync('node', [BUNDLE, 'lint', file], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.match(out, /no errors/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the bundle runs a graph end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-run-'))
  try {
    const file = join(dir, 'g.dot')
    writeFileSync(
      file,
      `digraph G {
         start [shape=Mdiamond]
         done  [shape=Msquare]
         a [shape=parallelogram, tool_command="printf hello > out.txt; printf ok"]
         start -> a -> done
       }`,
      'utf8',
    )
    const out = execFileSync(
      'node',
      [BUNDLE, 'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub'],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.match(out, /status: success/)
    assert.match(out, /start -> a -> done/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/bundle.test.ts
```
Expected: FAIL — `dist/attractor.js missing`.

- [ ] **Step 3: Build the bundle and write the README**

```bash
cd plugins/attractor/engine && npm install && npm run build
```

Create `plugins/attractor/README.md`:

```markdown
# attractor

DOT-graph convergence orchestration for Claude Code.

A pipeline is a Graphviz DOT digraph: nodes are computation, edges are
dispatch. The engine walks the graph, executing each node and choosing the
next edge deterministically. Routing is never decided by a model.

## Status

Engine core. Shell nodes execute for real; LLM nodes run against a stub
backend. The `claude -p` backend arrives in the next milestone.

## Usage

    node dist/attractor.js lint pipeline.dot
    node dist/attractor.js run pipeline.dot --param goal="ship it" --stub

## Node shapes

| Shape | Meaning | Status |
|---|---|---|
| `Mdiamond` | start | works |
| `Msquare` | exit | works |
| `box` | LLM task (default when no shape is given) | works, stub backend only |
| `parallelogram` | shell command; routes on exit code and last stdout line | works |
| `diamond` | conditional routing point | works |
| `hexagon` | human gate | parsed and linted; **aborts at run time** |
| `component` / `tripleoctagon` | parallel fan-out / fan-in | parsed and linted; **aborts at run time** |

Shapes marked "aborts at run time" are recognised by the parser and checked by
lint, but have no handler yet. A graph using one fails immediately with
`no handler registered for <kind>` rather than silently skipping the node --
a gate that quietly did nothing would be worse than one that stops the run.
Human gates arrive in the next milestone, parallel execution in the one after.

## Lint rules

`TOPO-001` one start; `TOPO-002` one exit; `TOPO-003` edge targets exist;
`TOPO-004` all nodes reachable; `TOPO-005` nothing enters start or leaves
exit; `HITL-001` a human-gate `timeout` must declare `on_timeout`;
`CMD-001` pipe-masked exit code; `CMD-002` always-true sentinel.

## Development

    cd engine
    npm install
    npm test          # node --test, no build step
    npm run build     # bundles to ../dist/attractor.js

## Attribution

Implements the attractor nlspec from
[strongdm/attractor](https://github.com/strongdm/attractor) (Apache-2.0).
Doctrine and pipeline patterns derive from
[microsoft/amplifier-bundle-attractor](https://github.com/microsoft/amplifier-bundle-attractor)
(MIT, (c) Microsoft Corporation).

MIT (c) 2026 Diego Colombo.
```

- [ ] **Step 4: Run the full suite to verify everything passes**

```bash
cd plugins/attractor/engine && node --test
```
Expected: PASS — all 13 test files, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor
git commit -m "feat(engine): esbuild bundle, README, full-suite gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification

Plan 1 is complete when all of the following hold:

- [ ] `cd plugins/attractor/engine && node --test` reports 0 failures.
- [ ] `node plugins/attractor/dist/attractor.js lint <file>` exits 0 on a valid graph and 1 on an invalid one.
- [ ] A convergence loop (`attempt -> verify -(red)-> attempt -(green)-> done`) iterates and terminates, driven entirely by shell exit codes.
- [ ] The bundle runs from a directory with no `node_modules` present.
- [ ] No dependency beyond `@ts-graphviz/ast` (runtime) and `esbuild` (dev).

## What Plan 1 deliberately does not do

Deferred to later plans, each with its own spec section: the `claude -p`
backend and git worktree isolation (Plan 2); human gates actually parking and
notifying — `HandlerKind.HUMAN` has a lint rule but no handler yet, so a graph
containing a `hexagon` node fails at run time with "no handler registered",
which is honest (Plan 3); `component` and `tripleoctagon` handlers, same
situation (Plan 4); rendering and convergence views (Plan 5); the doctrine
port and marketplace packaging (Plan 6).
