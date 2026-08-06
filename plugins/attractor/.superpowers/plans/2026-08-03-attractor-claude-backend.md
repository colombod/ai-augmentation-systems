# Attractor Claude Code Backend Implementation Plan (Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub backend with real `claude -p` subprocesses, so an attractor pipeline does actual work using the operator's existing Claude Code authentication, confined to a git worktree.

**Architecture:** `ClaudeCodeBackend` implements the one-method `Backend` seam Plan 1 established. The two riskiest parts — building the argv and interpreting the result JSON — are **pure functions** with no I/O, so they are tested exhaustively offline against captured fixtures. Only a thin layer actually spawns. A run gets a dedicated git worktree; box nodes execute inside it with `bypassPermissions`, so unattended work cannot touch the operator's working copy.

**Tech Stack:** Same as Plan 1 — TypeScript on Node 24+, native type stripping, `node --test`, no new dependencies. The `claude` CLI is an external runtime requirement, not a package dependency.

## Global Constraints

Identical to Plan 1, repeated because they bind every task:

- **Node >= 24.** Native TypeScript type stripping: tests run via `node --test` with no build step.
- **No codegen constructs.** Never `enum`, `namespace`, `declare`, or constructor parameter properties. Use `const` objects with `as const` plus a derived union.
- **Explicit `.ts` extensions** on relative imports; `node:` prefix on builtins.
- **ESM only.**
- **Dependencies stay exactly `@ts-graphviz/ast` (runtime) and `esbuild` (dev).** Adding any other requires a recorded decision.
- **No emoji** anywhere.
- **Do NOT run `npm install`.** This machine's npm registry is a corporate proxy and `registry.npmjs.org` is unreachable; dependencies are already installed and `package-lock.json` is git-ignored.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

### Verified CLI facts (from spikes; do not re-derive)

These were established empirically against Claude Code 2.1.220 and are the contract this plan builds on:

1. **Variadic flags swallow a positional prompt.** `--allowedTools "Bash Write"` followed by a prompt consumes the prompt as a third tool name, and the CLI exits 1 with `Input must be provided either through stdin or as a prompt argument`. **The prompt always goes on stdin**, and tool lists are comma-separated.
2. **`result` is a JSON *string*, not an object**, even with `--json-schema`. It must be `JSON.parse`d.
3. **`stop_reason` reads `tool_use` even on a fully successful run.** Never route on it. Route on `is_error` plus the parsed verdict.
4. **`--json-schema` composes with an agentic tool loop** — verified with 3 turns and a real Bash call whose output appeared in the structured verdict.
5. **`--resume <session-id>` gives genuine session continuity**, and `session_id` is stable across the resume.
6. The result object carries `is_error`, `result`, `session_id`, `total_cost_usd`, `usage`, `num_turns`, `permission_denials`, `subtype`.

## Test discipline for this plan

Plan 1 shipped eight tests that passed with their feature deleted. The cause was writing reference code and its tests together, so tests inherited the code's assumptions. This plan inverts that: **every task below states its contract in prose first, and the assertions are derived from that prose, not from the implementation.**

Every task's self-review includes an explicit mutation check: break the behaviour, confirm the test fails, restore it. A task is not done until that check is recorded in its report.

## File Structure

| File | Responsibility |
|---|---|
| `src/backend/argv.ts` | Pure: node attributes + options -> `claude` argv array |
| `src/backend/result.ts` | Pure: `claude -p` result JSON -> `Outcome` |
| `src/backend/claude.ts` | Spawns `claude`, feeds stdin, applies abort/timeout |
| `src/backend/threads.ts` | Thread-keyed session ids for `fidelity=full` continuity |
| `src/run/worktree.ts` | Git worktree lifecycle for a run |
| `src/doctor.ts` | Environment preflight |
| `src/cli.ts` | Extended: backend selection, model, worktree, `doctor` |

---

### Task 1: Argv construction (pure)

**Contract, stated before any code:**

Given a node, an expanded prompt, and run options, produce the exact argument list for `claude`. The prompt is NEVER in the argv — it goes on stdin, because a variadic flag before it would silently consume it. Tool lists are comma-separated for the same reason. A goal-gate node gets `--json-schema` so its verdict is structurally validated rather than parsed out of prose. `--resume` and `--session-id` are mutually exclusive. Absent options contribute no flag at all rather than an empty one.

**Files:**
- Create: `plugins/attractor/engine/src/backend/argv.ts`
- Test: `plugins/attractor/engine/test/argv.test.ts`

**Interfaces:**
- Consumes: `Node` from `src/dot/graph.ts`.
- Produces: `interface ArgvOptions { model?: string; addDir?: string; sessionId?: string; resumeId?: string; maxBudgetUsd?: number; allowedTools?: string[]; appendSystemPrompt?: string }`, `const OUTCOME_SCHEMA`, `function buildArgv(node: Node, opts: ArgvOptions): string[]`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/argv.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArgv, OUTCOME_SCHEMA } from '../src/backend/argv.ts'
import { Handler, type Node } from '../src/dot/graph.ts'

function node(attrs: Record<string, string> = {}): Node {
  return { id: 'work', attrs, handler: Handler.CODERGEN }
}

test('the prompt never appears in argv', () => {
  const argv = buildArgv(node(), { allowedTools: ['Bash', 'Write'] })
  assert.ok(!argv.includes('do the thing'), 'prompt must go on stdin')
  // The last element must be a flag value, never a bare positional.
  assert.ok(argv[0].startsWith('-'), 'argv starts with flags, not a positional')
})

test('tool lists are comma-separated, never space-separated', () => {
  const argv = buildArgv(node(), { allowedTools: ['Bash', 'Write', 'Edit'] })
  const i = argv.indexOf('--allowedTools')
  assert.ok(i >= 0)
  assert.equal(argv[i + 1], 'Bash,Write,Edit')
  assert.ok(!argv[i + 1].includes(' '), 'a space here would swallow the next argument')
})

test('print and json output are always requested', () => {
  const argv = buildArgv(node(), {})
  assert.ok(argv.includes('-p'))
  assert.equal(argv[argv.indexOf('--output-format') + 1], 'json')
})

test('permissions are bypassed so unattended work does not stall', () => {
  const argv = buildArgv(node(), {})
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'bypassPermissions')
})

test('absent options contribute no flag', () => {
  const argv = buildArgv(node(), {})
  for (const flag of ['--model', '--add-dir', '--session-id', '--resume', '--max-budget-usd']) {
    assert.ok(!argv.includes(flag), `${flag} must be absent when unset`)
  }
})

test('present options are passed through', () => {
  const argv = buildArgv(node(), {
    model: 'opus',
    addDir: '/tmp/wt',
    maxBudgetUsd: 2.5,
    appendSystemPrompt: 'node contract',
  })
  assert.equal(argv[argv.indexOf('--model') + 1], 'opus')
  assert.equal(argv[argv.indexOf('--add-dir') + 1], '/tmp/wt')
  assert.equal(argv[argv.indexOf('--max-budget-usd') + 1], '2.5')
  assert.equal(argv[argv.indexOf('--append-system-prompt') + 1], 'node contract')
})

test('a node model attribute overrides the run-level model', () => {
  const argv = buildArgv(node({ llm_model: 'sonnet' }), { model: 'opus' })
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet')
})

test('session-id and resume are mutually exclusive, resume wins', () => {
  const argv = buildArgv(node(), { sessionId: 'aaa', resumeId: 'bbb' })
  assert.ok(!argv.includes('--session-id'), 'resuming must not also pin a new session id')
  assert.equal(argv[argv.indexOf('--resume') + 1], 'bbb')
})

test('a goal gate requests a structured verdict', () => {
  const argv = buildArgv(node({ goal_gate: 'true' }), {})
  const i = argv.indexOf('--json-schema')
  assert.ok(i >= 0, 'a goal gate must not be left to prose')
  assert.deepEqual(JSON.parse(argv[i + 1]), OUTCOME_SCHEMA)
})

test('an ordinary node is not forced into a schema', () => {
  assert.ok(!buildArgv(node(), {}).includes('--json-schema'))
})

test('the outcome schema demands a routing signal', () => {
  assert.deepEqual(OUTCOME_SCHEMA.required, ['status', 'preferred_label', 'notes'])
  assert.deepEqual(OUTCOME_SCHEMA.properties.status.enum, ['success', 'fail', 'retry'])
  assert.equal(OUTCOME_SCHEMA.additionalProperties, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/argv.test.ts
```
Expected: FAIL — cannot resolve `../src/backend/argv.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/backend/argv.ts`:

```typescript
import { type Node } from '../dot/graph.ts'

export interface ArgvOptions {
  model?: string
  addDir?: string
  sessionId?: string
  resumeId?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  appendSystemPrompt?: string
}

/**
 * The structured verdict demanded of a goal-gate node.
 *
 * `preferred_label` is required, which is the whole point: a gate that
 * returns prose cannot satisfy the fail-closed check in BoxHandler, so
 * forcing the field at the source turns a soft convention into a schema
 * violation the CLI itself rejects.
 */
export const OUTCOME_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['success', 'fail', 'retry'] },
    preferred_label: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['status', 'preferred_label', 'notes'],
  additionalProperties: false,
} as const

/**
 * Build the argument list for `claude`.
 *
 * The prompt is deliberately NOT here. Several of these flags are variadic,
 * and a variadic flag immediately before a positional prompt consumes the
 * prompt as another value -- the CLI then exits 1 complaining that no input
 * was provided. Feeding the prompt on stdin removes the entire class.
 */
export function buildArgv(node: Node, opts: ArgvOptions): string[] {
  const argv: string[] = ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions']

  const model = node.attrs.llm_model ?? opts.model
  if (model !== undefined) argv.push('--model', model)

  if (opts.addDir !== undefined) argv.push('--add-dir', opts.addDir)

  // Resuming an existing conversation and pinning a fresh id are mutually
  // exclusive; resuming wins because continuity is the stronger intent.
  if (opts.resumeId !== undefined) argv.push('--resume', opts.resumeId)
  else if (opts.sessionId !== undefined) argv.push('--session-id', opts.sessionId)

  if (opts.maxBudgetUsd !== undefined) argv.push('--max-budget-usd', String(opts.maxBudgetUsd))

  if (opts.allowedTools !== undefined && opts.allowedTools.length > 0) {
    // Comma-separated, never space-separated: a space makes the following
    // argument look like another tool name.
    argv.push('--allowedTools', opts.allowedTools.join(','))
  }

  if (opts.appendSystemPrompt !== undefined) {
    argv.push('--append-system-prompt', opts.appendSystemPrompt)
  }

  if (node.attrs.goal_gate === 'true') {
    argv.push('--json-schema', JSON.stringify(OUTCOME_SCHEMA))
  }

  return argv
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/argv.test.ts
```
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(backend): pure argv construction for claude -p

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Result interpretation (pure)

**Contract, stated before any code:**

Given the JSON object `claude -p --output-format json` prints, produce an `Outcome`. Success is decided by `is_error` and nothing else — in particular NOT by `stop_reason`, which reads `tool_use` even on a fully successful run. `result` is a JSON *string*; when it parses into an object carrying a `status`, that structured verdict governs and its `preferred_label` becomes the routing signal. When it does not parse, the text becomes `notes` and no routing signal is produced — which is what lets a prose-only goal gate fail closed downstream. Cost and turn counts are always recorded in `metrics`, because a run that spends money must say so even when it fails. A malformed or truncated result must produce a FAIL outcome, never a throw.

**Files:**
- Create: `plugins/attractor/engine/src/backend/result.ts`
- Test: `plugins/attractor/engine/test/result.test.ts`

**Interfaces:**
- Consumes: `Status`, `Outcome` from `src/core/outcome.ts`.
- Produces: `interface ClaudeResult { is_error?: boolean; result?: unknown; session_id?: string; total_cost_usd?: number; num_turns?: number; usage?: Record<string, unknown>; permission_denials?: unknown[]; subtype?: string }`, `function interpretResult(raw: string): { outcome: Outcome; sessionId?: string }`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/result.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpretResult } from '../src/backend/result.ts'
import { Status } from '../src/core/outcome.ts'

function raw(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    is_error: false,
    result: 'did the thing',
    session_id: 'sess-1',
    total_cost_usd: 0.027,
    num_turns: 3,
    stop_reason: 'tool_use',
    subtype: 'success',
    ...over,
  })
}

test('success is decided by is_error, never by stop_reason', () => {
  // stop_reason reads tool_use even on a fully successful run.
  const { outcome } = interpretResult(raw({ stop_reason: 'tool_use' }))
  assert.equal(outcome.status, Status.SUCCESS)
})

test('is_error true fails the node', () => {
  const { outcome } = interpretResult(raw({ is_error: true, result: 'boom' }))
  assert.equal(outcome.status, Status.FAIL)
})

test('a structured verdict governs status and routing', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'retry', preferred_label: 'iterate', notes: 'not yet' }) }),
  )
  assert.equal(outcome.status, Status.RETRY)
  assert.equal(outcome.preferredLabel, 'iterate')
  assert.equal(outcome.notes, 'not yet')
})

test('a structured verdict of fail is honoured', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'fail', preferred_label: 'abort', notes: 'broken' }) }),
  )
  assert.equal(outcome.status, Status.FAIL)
})

test('prose produces NO routing signal so a goal gate can fail closed', () => {
  const { outcome } = interpretResult(raw({ result: 'NOT CONVERGED - 2 of 7 criteria pass' }))
  assert.equal(outcome.preferredLabel, undefined, 'prose must not look like a verdict')
  assert.equal(outcome.contextUpdates, undefined)
  assert.equal(outcome.notes, 'NOT CONVERGED - 2 of 7 criteria pass')
})

test('cost and turns are recorded even on failure', () => {
  const { outcome } = interpretResult(raw({ is_error: true, total_cost_usd: 0.5, num_turns: 9 }))
  assert.equal(outcome.metrics?.costUsd, 0.5)
  assert.equal(outcome.metrics?.turns, 9)
})

test('the session id is returned for thread continuity', () => {
  assert.equal(interpretResult(raw()).sessionId, 'sess-1')
})

test('unparseable output fails rather than throwing', () => {
  const { outcome } = interpretResult('not json at all')
  assert.equal(outcome.status, Status.FAIL)
  assert.match(outcome.notes ?? '', /could not parse/i)
})

test('a truncated result object fails rather than throwing', () => {
  const { outcome } = interpretResult('{"is_error":fal')
  assert.equal(outcome.status, Status.FAIL)
})

test('an empty result string fails rather than reporting success', () => {
  const { outcome } = interpretResult('')
  assert.equal(outcome.status, Status.FAIL)
})

test('a top-level JSON array fails rather than reporting empty success', () => {
  // typeof [] === 'object', so a naive object check lets an array through,
  // every field reads undefined, and the result looks like a silent success.
  const { outcome } = interpretResult('[1,2,3]')
  assert.equal(outcome.status, Status.FAIL)
  assert.match(outcome.notes ?? '', /could not parse/i)
})

test('valid JSON that is not an object at all fails', () => {
  for (const raw of ['42', '"a string"', 'null', 'true']) {
    assert.equal(interpretResult(raw).outcome.status, Status.FAIL, `${raw} must fail`)
  }
})

test('permission denials surface in the notes', () => {
  const { outcome } = interpretResult(
    raw({ is_error: true, permission_denials: [{ tool_name: 'Bash' }] }),
  )
  assert.match(outcome.notes ?? '', /permission/i)
})

test('a structured verdict with an unknown status falls back to fail', () => {
  const { outcome } = interpretResult(
    raw({ result: JSON.stringify({ status: 'banana', preferred_label: 'x', notes: 'y' }) }),
  )
  assert.equal(outcome.status, Status.FAIL)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/result.test.ts
```
Expected: FAIL — cannot resolve `../src/backend/result.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/backend/result.ts`:

```typescript
import { Status, type Outcome } from '../core/outcome.ts'

export interface ClaudeResult {
  is_error?: boolean
  result?: unknown
  session_id?: string
  total_cost_usd?: number
  num_turns?: number
  usage?: Record<string, unknown>
  permission_denials?: unknown[]
  subtype?: string
}

const STATUS_BY_NAME: Record<string, Status> = {
  success: Status.SUCCESS,
  partial_success: Status.PARTIAL,
  retry: Status.RETRY,
  fail: Status.FAIL,
}

interface Verdict {
  status?: unknown
  preferred_label?: unknown
  notes?: unknown
}

/** `result` is a JSON string; a structured verdict is JSON nested inside it. */
function parseVerdict(result: unknown): Verdict | null {
  if (typeof result !== 'string') return null
  const trimmed = result.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Verdict
  } catch {
    return null
  }
}

/**
 * Turn a `claude -p --output-format json` payload into an Outcome.
 *
 * Success is decided by `is_error` alone. `stop_reason` is deliberately
 * ignored: it reads "tool_use" even on a fully successful run, so routing on
 * it would fail every node that used a tool.
 *
 * Prose deliberately produces NO preferredLabel and NO contextUpdates. That
 * is what lets BoxHandler's fail-closed check downgrade a goal gate that
 * answered in prose -- the emptiness IS the signal.
 */
export function interpretResult(rawText: string): { outcome: Outcome; sessionId?: string } {
  let parsed: ClaudeResult
  try {
    const value = JSON.parse(rawText) as unknown
    // Array.isArray is not redundant: `typeof [] === 'object'`, so without it
    // a top-level array slips through, every field reads undefined, and the
    // function reports SUCCESS with empty notes -- fail-open in the one
    // place that must fail closed.
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object')
    }
    parsed = value as ClaudeResult
  } catch {
    return {
      outcome: {
        status: Status.FAIL,
        notes: `could not parse claude output: ${rawText.slice(0, 200)}`,
      },
    }
  }

  const metrics: Record<string, number> = {}
  if (typeof parsed.total_cost_usd === 'number') metrics.costUsd = parsed.total_cost_usd
  if (typeof parsed.num_turns === 'number') metrics.turns = parsed.num_turns

  const denials = parsed.permission_denials ?? []
  const denialNote =
    denials.length > 0 ? ` (${denials.length} permission denial(s): ${JSON.stringify(denials)})` : ''

  const verdict = parseVerdict(parsed.result)
  if (verdict !== null && typeof verdict.status === 'string') {
    const status = STATUS_BY_NAME[verdict.status] ?? Status.FAIL
    return {
      outcome: {
        status: parsed.is_error === true ? Status.FAIL : status,
        preferredLabel:
          typeof verdict.preferred_label === 'string' ? verdict.preferred_label : undefined,
        notes: `${typeof verdict.notes === 'string' ? verdict.notes : ''}${denialNote}`,
        metrics,
      },
      sessionId: parsed.session_id,
    }
  }

  const text = typeof parsed.result === 'string' ? parsed.result : ''
  return {
    outcome: {
      status: parsed.is_error === true ? Status.FAIL : Status.SUCCESS,
      notes: `${text}${denialNote}`,
      metrics,
    },
    sessionId: parsed.session_id,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/result.test.ts
```
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(backend): pure result interpretation, routing on is_error not stop_reason

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Thread continuity

**Contract, stated before any code:**

A node may declare `thread_id` and `fidelity`. With `fidelity=full`, successive nodes sharing a thread continue one conversation: the first records the session id the CLI reports, and later nodes resume it. Any other fidelity starts fresh. A thread's id is recorded only when the node actually produced one. Branch isolation matters: a cloned store must not leak sessions back to its parent, because parallel branches sharing a conversation would interleave.

**Files:**
- Create: `plugins/attractor/engine/src/backend/threads.ts`
- Test: `plugins/attractor/engine/test/threads.test.ts`

**Interfaces:**
- Consumes: `Node` from `src/dot/graph.ts`.
- Produces: `class ThreadStore` with `resumeIdFor(node): string | undefined`, `record(node, sessionId): void`, `clone(): ThreadStore`; and `function isFullFidelity(node: Node): boolean`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/threads.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadStore, isFullFidelity } from '../src/backend/threads.ts'
import { Handler, type Node } from '../src/dot/graph.ts'

function node(attrs: Record<string, string>): Node {
  return { id: 'n', attrs, handler: Handler.CODERGEN }
}

const full = node({ thread_id: 'work', fidelity: 'full' })

test('full fidelity is recognised, other modes are not', () => {
  assert.equal(isFullFidelity(full), true)
  assert.equal(isFullFidelity(node({ thread_id: 'work', fidelity: 'compact' })), false)
  assert.equal(isFullFidelity(node({ thread_id: 'work' })), false)
  assert.equal(isFullFidelity(node({ fidelity: 'full' })), false, 'a thread id is required')
})

test('the first node in a thread has nothing to resume', () => {
  assert.equal(new ThreadStore().resumeIdFor(full), undefined)
})

test('a later node in the same thread resumes the recorded session', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(full), 'sess-1')
})

test('a different thread does not resume another thread session', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(node({ thread_id: 'other', fidelity: 'full' })), undefined)
})

test('a non-full node never resumes even within a recorded thread', () => {
  const s = new ThreadStore()
  s.record(full, 'sess-1')
  assert.equal(s.resumeIdFor(node({ thread_id: 'work', fidelity: 'compact' })), undefined)
})

test('recording is ignored for a non-full node', () => {
  const s = new ThreadStore()
  s.record(node({ thread_id: 'work', fidelity: 'compact' }), 'sess-x')
  assert.equal(s.resumeIdFor(full), undefined)
})

test('a clone does not leak new sessions back to its parent', () => {
  const parent = new ThreadStore()
  parent.record(full, 'sess-1')
  const branch = parent.clone()
  branch.record(full, 'sess-branch')
  assert.equal(parent.resumeIdFor(full), 'sess-1', 'the parent must be unaffected')
  assert.equal(branch.resumeIdFor(full), 'sess-branch')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/threads.test.ts
```
Expected: FAIL — cannot resolve `../src/backend/threads.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/backend/threads.ts`:

```typescript
import { type Node } from '../dot/graph.ts'

/**
 * A node participates in a continued conversation only when it names a
 * thread AND asks for full fidelity. Every other mode starts fresh, which is
 * the conservative default: sharing a conversation by accident is far worse
 * than losing context that a prompt can restate.
 */
export function isFullFidelity(node: Node): boolean {
  return node.attrs.fidelity === 'full' && typeof node.attrs.thread_id === 'string'
}

export class ThreadStore {
  private sessions: Map<string, string>

  constructor(initial: Map<string, string> = new Map()) {
    this.sessions = new Map(initial)
  }

  resumeIdFor(node: Node): string | undefined {
    if (!isFullFidelity(node)) return undefined
    return this.sessions.get(node.attrs.thread_id as string)
  }

  record(node: Node, sessionId: string): void {
    if (!isFullFidelity(node)) return
    this.sessions.set(node.attrs.thread_id as string, sessionId)
  }

  /**
   * Branch-local copy. Parallel branches that shared a store would resume the
   * same conversation and interleave their turns, so a clone must not write
   * back to its parent.
   */
  clone(): ThreadStore {
    return new ThreadStore(this.sessions)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/threads.test.ts
```
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(backend): thread-keyed session continuity for fidelity=full

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The spawning backend

**Contract, stated before any code:**

`ClaudeCodeBackend` implements `Backend`. It builds argv, spawns `claude` with the prompt on **stdin**, collects stdout, and interprets it. A non-zero exit whose stdout is not valid JSON becomes a FAIL carrying stderr, because the operator needs to know the CLI itself refused. A spawn failure — `claude` not on PATH — becomes a FAIL naming the cause, not a throw, since Plan 1's engine converts throws to RETRY and retrying a missing binary is pointless. An abort signal terminates the child. The session id from a successful call is recorded against the node's thread.

**Files:**
- Create: `plugins/attractor/engine/src/backend/claude.ts`
- Test: `plugins/attractor/engine/test/claude-backend.test.ts`

**Interfaces:**
- Consumes: `Backend` from `src/handlers/types.ts`; `buildArgv`, `ArgvOptions`; `interpretResult`; `ThreadStore`; `Status`, `Outcome`; `Node`, `Graph`; `Context`.
- Produces: `interface ClaudeBackendOptions extends ArgvOptions { command?: string; cwd?: string; threads?: ThreadStore }`, `class ClaudeCodeBackend implements Backend`.

The tests substitute a fake `command` — a small shell script — so they exercise the real spawn path without invoking Claude or spending anything.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/claude-backend.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { ThreadStore } from '../src/backend/threads.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'

const GRAPH: Graph = { name: 'g', attrs: {}, nodes: new Map(), edges: [] }
function node(attrs: Record<string, string> = {}): Node {
  return { id: 'work', attrs, handler: Handler.CODERGEN }
}

/** A stand-in for the claude CLI: prints a canned payload, echoes stdin to a file. */
function fakeClaude(dir: string, body: string): string {
  const path = join(dir, 'fake-claude.sh')
  writeFileSync(path, `#!/bin/sh\ncat > "${join(dir, 'stdin.txt')}"\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
  return path
}

function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-claude-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('the prompt is delivered on stdin, not as an argument', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok","session_id":"s1"}'`)
    const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
    await backend.run(node(), 'ADVANCE THE GOAL', Context.from({}), GRAPH)

    const { readFileSync } = await import('node:fs')
    assert.equal(readFileSync(join(dir, 'stdin.txt'), 'utf8'), 'ADVANCE THE GOAL')
  })
})

test('a successful payload becomes a successful outcome', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"done","total_cost_usd":0.03}'`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(outcome.metrics?.costUsd, 0.03)
  })
})

test('a CLI that exits non-zero with no JSON fails with its stderr', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `echo "usage error" >&2\nexit 2`)
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH,
    )
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /usage error/)
  })
})

test('a missing binary fails cleanly rather than throwing', async () => {
  await withDir(async (dir) => {
    const backend = new ClaudeCodeBackend({ command: join(dir, 'does-not-exist'), cwd: dir })
    const outcome = await backend.run(node(), 'p', Context.from({}), GRAPH)
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /could not run|ENOENT/i)
  })
})

test('the session id is recorded against the node thread', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok","session_id":"s-42"}'`)
    const threads = new ThreadStore()
    const n = node({ thread_id: 'work', fidelity: 'full' })
    await new ClaudeCodeBackend({ command: cmd, cwd: dir, threads }).run(
      n, 'p', Context.from({}), GRAPH,
    )
    assert.equal(threads.resumeIdFor(n), 's-42')
  })
})

test('an already-aborted signal with a missing binary fails, it does not crash', async () => {
  // The dangerous combination: a long-lived signal aborted by an earlier node,
  // then reused for a node whose command does not exist. If the abort path
  // returns before the error listener is attached, Node emits an unlistened
  // 'error' event, which is an uncaught exception that kills the whole
  // orchestrator instead of failing this one node.
  await withDir(async (dir) => {
    const controller = new AbortController()
    controller.abort()
    const backend = new ClaudeCodeBackend({ command: join(dir, 'nope'), cwd: dir })
    const outcome = await backend.run(
      node(), 'p', Context.from({}), GRAPH, controller.signal,
    )
    assert.equal(outcome.status, Status.FAIL)
  })
})

test('an already-aborted signal with a real binary still fails cleanly', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `printf '{"is_error":false,"result":"ok"}'`)
    const controller = new AbortController()
    controller.abort()
    const outcome = await new ClaudeCodeBackend({ command: cmd, cwd: dir }).run(
      node(), 'p', Context.from({}), GRAPH, controller.signal,
    )
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /abort/i)
  })
})

test('an aborted call fails rather than hanging', async () => {
  await withDir(async (dir) => {
    const cmd = fakeClaude(dir, `sleep 30`)
    const controller = new AbortController()
    const backend = new ClaudeCodeBackend({ command: cmd, cwd: dir })
    const running = backend.run(node(), 'p', Context.from({}), GRAPH, controller.signal)
    controller.abort()
    const outcome = await running
    assert.equal(outcome.status, Status.FAIL)
    assert.match(outcome.notes ?? '', /abort/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/claude-backend.test.ts
```
Expected: FAIL — cannot resolve `../src/backend/claude.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/backend/claude.ts`:

```typescript
import { spawn } from 'node:child_process'
import { type Context } from '../core/context.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { type Graph, type Node } from '../dot/graph.ts'
import { type Backend } from '../handlers/types.ts'
import { type ArgvOptions, buildArgv } from './argv.ts'
import { interpretResult } from './result.ts'
import { ThreadStore } from './threads.ts'

export interface ClaudeBackendOptions extends ArgvOptions {
  /** Overridable so tests can substitute a stand-in without spending money. */
  command?: string
  cwd?: string
  threads?: ThreadStore
}

interface SpawnResult {
  code: number
  stdout: string
  stderr: string
  failure?: string
}

function runProcess(
  command: string,
  argv: string[],
  prompt: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (r: SpawnResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }

    const onAbort = (): void => {
      // Guard on pid: when the spawn is about to fail, the child has no pid
      // and killing it hangs indefinitely on Node 26. There is nothing to
      // kill in that case, and finish() still settles the promise.
      if (child.pid !== undefined) child.kill('SIGKILL')
      finish({ code: 1, stdout, stderr, failure: 'aborted' })
    }

    // Listeners are attached BEFORE any abort handling, and there is no early
    // return past this point. Node throws on an 'error' event with no
    // listener, so a spawn failure reaching an unlistened child would take
    // down the whole orchestrator rather than failing one node -- strictly
    // worse than the throw this backend exists to avoid, because the engine
    // cannot even convert it to a RETRY.
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      finish({ code: 1, stdout, stderr, failure: `could not run ${command}: ${String(err)}` })
    })
    child.on('close', (code) => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
      finish({ code: code ?? 1, stdout, stderr })
    })

    // A killed child's stdin can EPIPE. The outcome is already decided by
    // then, so swallow it rather than letting it surface as an unhandled
    // stream error.
    child.stdin.on('error', () => {})

    // The prompt goes on stdin. Passing it in argv risks a preceding variadic
    // flag swallowing it, which the CLI reports as "no input provided".
    child.stdin.end(prompt)

    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export class ClaudeCodeBackend implements Backend {
  private opts: ClaudeBackendOptions
  private threads: ThreadStore

  constructor(opts: ClaudeBackendOptions = {}) {
    this.opts = opts
    this.threads = opts.threads ?? new ThreadStore()
  }

  async run(
    node: Node,
    prompt: string,
    _context: Context,
    _graph: Graph,
    signal?: AbortSignal,
  ): Promise<Outcome> {
    const command = this.opts.command ?? 'claude'
    const argv = buildArgv(node, {
      ...this.opts,
      resumeId: this.threads.resumeIdFor(node),
    })

    const proc = await runProcess(command, argv, prompt, this.opts.cwd, signal)

    if (proc.failure !== undefined) {
      return { status: Status.FAIL, notes: proc.failure }
    }
    if (proc.code !== 0 && proc.stdout.trim() === '') {
      // The CLI itself refused. Its stderr is the only useful information.
      return {
        status: Status.FAIL,
        notes: `claude exited ${proc.code}: ${proc.stderr.trim() || '(no stderr)'}`,
      }
    }

    const { outcome, sessionId } = interpretResult(proc.stdout)
    if (sessionId !== undefined) this.threads.record(node, sessionId)
    return outcome
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/claude-backend.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(backend): spawn claude -p with the prompt on stdin

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Worktree isolation

**Contract, stated before any code:**

A run may execute in a dedicated git worktree so unattended work never touches the operator's working copy. Creating one requires a git repository; in a non-repo directory the attempt fails with a clear message rather than silently running in place. The branch name is derived from the run id and must not collide with an existing branch. Removal is safe to call twice and never deletes the main working tree. Removal deliberately does NOT discard the branch — the whole point is that work survives as something reviewable.

**Files:**
- Create: `plugins/attractor/engine/src/run/worktree.ts`
- Test: `plugins/attractor/engine/test/worktree.test.ts`

**Interfaces:**
- Produces: `interface Worktree { path: string; branch: string }`, `function createWorktree(repoDir: string, runId: string): Worktree`, `function removeWorktree(repoDir: string, wt: Worktree): void`, `function isGitRepo(dir: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/worktree.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWorktree, removeWorktree, isGitRepo } from '../src/run/worktree.ts'

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-wt-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'seed.txt'), 'seed', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

test('a git directory is recognised and a plain one is not', () => {
  const r = repo()
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    assert.equal(isGitRepo(r), true)
    assert.equal(isGitRepo(plain), false)
  } finally {
    rmSync(r, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  }
})

test('a worktree is created on its own branch with the seed content', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run1')
    assert.ok(existsSync(wt.path), 'the worktree directory exists')
    assert.ok(existsSync(join(wt.path, 'seed.txt')), 'it has the repo content')
    assert.match(wt.branch, /run1/)
    removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('work in the worktree does not appear in the main tree', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run2')
    writeFileSync(join(wt.path, 'only-here.txt'), 'x', 'utf8')
    assert.equal(existsSync(join(r, 'only-here.txt')), false, 'the main tree is untouched')
    removeWorktree(r, wt)
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal leaves the main working tree intact', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run3')
    removeWorktree(r, wt)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the main tree survives removal')
    assert.equal(existsSync(wt.path), false, 'the worktree is gone')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal is safe to call twice', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run4')
    assert.equal(removeWorktree(r, wt).removed, true)
    assert.equal(removeWorktree(r, wt).removed, true, 'a second removal is a no-op, not an error')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree git has forgotten is still deleted from disk', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run6')
    // Simulate git losing the administrative record while the directory
    // remains. `git worktree prune` alone will NOT clean this up -- prune
    // only reconciles metadata for directories that are already gone.
    rmSync(join(r, '.git', 'worktrees', 'run6'), { recursive: true, force: true })

    const result = removeWorktree(r, wt)
    assert.equal(existsSync(wt.path), false, 'the directory must not be leaked')
    assert.equal(result.removed, true)
    assert.match(result.warning ?? '', /git could not remove/, 'the operator is told git failed')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('the root guard survives a symlinked path to the same repository', () => {
  // resolve() is lexical, so a repo reached through a symlink compares
  // unequal to itself and slips a naive guard. On macOS /tmp and /var are
  // symlinks, so this is ordinary rather than exotic.
  const r = repo()
  const link = join(mkdtempSync(join(tmpdir(), 'attractor-link-')), 'repo-link')
  try {
    symlinkSync(r, link)
    const result = removeWorktree(link, { path: realpathSync(r), branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(link, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a directory this module did not create', () => {
  // Worktree is a plain record, so a hand-built one must not be able to aim
  // an unconditional recursive delete at an arbitrary directory.
  const r = repo()
  const stranger = mkdtempSync(join(tmpdir(), 'attractor-stranger-'))
  try {
    writeFileSync(join(stranger, 'important.txt'), 'keep me', 'utf8')
    const result = removeWorktree(r, { path: stranger, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /not a worktree this module created/)
    assert.equal(existsSync(join(stranger, 'important.txt')), true, 'the directory must survive')
  } finally {
    rmSync(stranger, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('uncommitted work is preserved, not deleted', () => {
  // The failure this guards: a pipeline runs for hours, its box node writes
  // real output, the goal gate passes, and cleanup deletes everything while
  // reporting success.
  const r = repo()
  let wt: { path: string; branch: string } | undefined
  try {
    wt = createWorktree(r, 'run9')
    writeFileSync(join(wt.path, 'VALUABLE-OUTPUT.txt'), 'hours of work', 'utf8')

    const result = removeWorktree(r, wt)
    assert.equal(result.removed, false, 'must refuse rather than destroy')
    assert.equal(existsSync(join(wt.path, 'VALUABLE-OUTPUT.txt')), true, 'work survives')
    assert.match(result.warning ?? '', /uncommitted work/)
    assert.match(result.warning ?? '', new RegExp(wt.branch), 'the warning names the branch')
  } finally {
    if (wt !== undefined) rmSync(wt.path, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree whose work is committed is removed normally', () => {
  // The permit half: committing is what makes cleanup safe.
  const r = repo()
  try {
    const wt = createWorktree(r, 'run10')
    writeFileSync(join(wt.path, 'shipped.txt'), 'done', 'utf8')
    execFileSync('git', ['add', '-A'], { cwd: wt.path })
    execFileSync('git', ['commit', '-qm', 'ship'], { cwd: wt.path })

    const result = removeWorktree(r, wt)
    assert.equal(result.removed, true, 'committed work leaves nothing to protect')
    assert.equal(existsSync(wt.path), false)

    const onBranch = execFileSync('git', ['ls-tree', '-r', '--name-only', wt.branch], {
      cwd: r, encoding: 'utf8',
    })
    assert.match(onBranch, /shipped\.txt/, 'the work is on the branch')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('the mkdtemp parent is cleaned up after a normal removal', () => {
  // The POSITIVE half of the ownership gate. Without this, a refactor that
  // computes ownership after deletion still passes every test while silently
  // leaking a temp directory per run: realOrResolved falls back to a lexical
  // path once the directory is gone, and lexical /var/... does not match a
  // realpath'd /private/var/..., so the check answers "not ours".
  const r = repo()
  try {
    const wt = createWorktree(r, 'run8')
    const parent = dirname(wt.path)
    assert.equal(existsSync(parent), true, 'the parent exists while the worktree does')
    removeWorktree(r, wt)
    assert.equal(existsSync(parent), false, 'an emptied parent we created must not be leaked')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a worktree outside our convention keeps its parent directory', () => {
  // Reached via the branch where git's own removal SUCCEEDS, which skips the
  // rmSync ownership gate entirely. The parent cleanup must be gated too.
  const r = repo()
  const parent = mkdtempSync(join(tmpdir(), 'attractor-notours-'))
  const manual = join(parent, 'child')
  try {
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'manual/branch', manual], { cwd: r })
    const result = removeWorktree(r, { path: manual, branch: 'manual/branch' })
    assert.equal(result.removed, true, 'git removes a worktree it registered')
    assert.equal(
      existsSync(parent),
      true,
      'a parent outside our naming convention is not ours to delete',
    )
  } finally {
    rmSync(parent, { recursive: true, force: true })
    rmSync(r, { recursive: true, force: true })
  }
})

test('a clean removal and a repeat call produce no warning', () => {
  const r = repo()
  try {
    const wt = createWorktree(r, 'run7')
    const first = removeWorktree(r, wt)
    assert.equal(first.warning, undefined, 'a clean removal has nothing to report')
    const second = removeWorktree(r, wt)
    assert.equal(second.removed, true)
    assert.equal(second.warning, undefined, 'an already-gone target is a clean no-op')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('removal refuses a path that is the repository root', () => {
  const r = repo()
  try {
    const result = removeWorktree(r, { path: r, branch: 'attractor/bogus' })
    assert.equal(result.removed, false)
    assert.match(result.warning ?? '', /repository root/)
    assert.equal(existsSync(join(r, 'seed.txt')), true, 'the repository must survive')
  } finally {
    rmSync(r, { recursive: true, force: true })
  }
})

test('a non-repository refuses rather than running in place', () => {
  const plain = mkdtempSync(join(tmpdir(), 'attractor-plain-'))
  try {
    // Assert OUR message, not git's. Git also says "not a git repository",
    // so matching that phrase would pass even with our guard deleted -- the
    // test would be verifying git's behaviour rather than ours, and would
    // silently stop covering us if git ever reworded its error.
    assert.throws(() => createWorktree(plain, 'run5'), /cannot create an isolated worktree/)
  } finally {
    rmSync(plain, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/worktree.test.ts
```
Expected: FAIL — cannot resolve `../src/run/worktree.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/run/worktree.ts`:

```typescript
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

/** Every worktree directory this module creates carries this prefix. */
const WT_PREFIX = 'attractor-wt-'

export interface Worktree {
  path: string
  branch: string
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function isGitRepo(dir: string): boolean {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Create a dedicated worktree for a run.
 *
 * Unattended work runs with permissions bypassed, so it must not execute in
 * the operator's working copy. Refusing outright in a non-repository is
 * deliberate: falling back to in-place execution would silently remove the
 * isolation the caller asked for.
 */
export function createWorktree(repoDir: string, runId: string): Worktree {
  if (!isGitRepo(repoDir)) {
    throw new Error(`not a git repository: ${repoDir} -- cannot create an isolated worktree`)
  }
  const branch = `attractor/${runId}`
  const parent = mkdtempSync(join(tmpdir(), WT_PREFIX))
  const path = join(parent, runId)
  try {
    git(repoDir, ['worktree', 'add', '-q', '-b', branch, path])
  } catch (err) {
    // The temp parent already exists by now. Leaving it behind on a failed
    // add -- a branch-name collision being the likely cause -- would leak a
    // directory per failed attempt.
    rmSync(parent, { recursive: true, force: true })
    throw err
  }
  return { path, branch }
}

export interface RemovalResult {
  removed: boolean
  /** Set when something went wrong the operator should see. */
  warning?: string
}

/**
 * Remove the worktree, keeping its branch. The branch IS the deliverable --
 * a reviewable record of what the run did -- so discarding it here would
 * throw away the work the isolation existed to protect.
 *
 * Safe to call twice, so cleanup paths in `finally` need no guard. It
 * returns a result rather than throwing, for the same reason: throwing from
 * a `finally` would mask the run's real outcome.
 *
 * `git worktree prune` alone is NOT sufficient cleanup. Prune only
 * reconciles metadata for directories that are already gone; it will not
 * delete a directory git has forgotten about. Relying on it leaked the
 * worktree permanently with no diagnostic.
 */
/**
 * Resolve through symlinks where possible.
 *
 * `resolve()` alone is purely lexical -- it never consults the filesystem --
 * so two strings naming the SAME directory through different symlink chains
 * compare unequal. On macOS `/tmp` and `/var` are symlinks, so this is the
 * common case rather than an exotic one, and a lexical-only comparison let a
 * repository reach a direct rmSync in testing.
 */
function realOrResolved(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    // A path that does not exist cannot be realpath'd; lexical is the best
    // available, and a non-existent path is not one we will delete anyway.
    return abs
  }
}

/**
 * Is this a directory THIS module created?
 *
 * `createWorktree` always builds `join(mkdtempSync(join(tmpdir(), PREFIX)), runId)`,
 * so a genuine worktree lives under the OS temp directory with a parent named
 * for that prefix. Requiring both is a far tighter containment than merely
 * refusing the repository root: `Worktree` is a plain `{ path, branch }`
 * record, so any caller that hand-builds one -- from a config file, a resumed
 * run record, or a typo -- could otherwise aim an unconditional recursive
 * delete at an arbitrary directory.
 */
function isOurWorktree(target: string): boolean {
  const tmpRoot = realOrResolved(tmpdir())
  const t = realOrResolved(target)
  return t.startsWith(`${tmpRoot}${sep}`) && basename(dirname(t)).startsWith(WT_PREFIX)
}

/**
 * Does this worktree hold anything not yet committed, including untracked
 * files? `--porcelain` lists both, so an empty result means everything the
 * run produced is safely on the branch.
 */
function hasUncommittedWork(worktreePath: string): boolean {
  try {
    return git(worktreePath, ['status', '--porcelain']).trim() !== ''
  } catch {
    // If git cannot answer, assume there IS work. Guessing "nothing here"
    // would delete on exactly the reading we are least sure about.
    return true
  }
}

/**
 * Is `target` a worktree git currently has registered against `repoDir`?
 *
 * This gates when it is even meaningful to ask `hasUncommittedWork`.
 * `git status --porcelain` fails identically -- "fatal: not a git
 * repository", exit 128 -- whether `target` never was a worktree at all (a
 * hand-built record, or a stray directory) or WAS one but git's own
 * administrative link for it is gone (its `.git/worktrees/<name>` metadata
 * deleted out from under it). `hasUncommittedWork`'s conservative
 * assume-true-on-error fallback would misread either of those as "uncommitted
 * work present" and block legitimate cleanup that has nothing to do with
 * unreviewed pipeline output -- there is no worktree there for git to check.
 * `git worktree list` reads the SAME administrative records `git status`
 * needs, so a target missing from this list is exactly the set of paths
 * `hasUncommittedWork` cannot answer for, and asking it is skipped rather
 * than guessed.
 */
function isRegisteredWorktree(repoDir: string, target: string): boolean {
  try {
    const out = git(repoDir, ['worktree', 'list', '--porcelain'])
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ') && realOrResolved(line.slice('worktree '.length)) === target) {
        return true
      }
    }
    return false
  } catch {
    // Cannot enumerate worktrees at all -- treat as unregistered, the same
    // "nothing for hasUncommittedWork to check" outcome as a target absent
    // from a successfully-read list.
    return false
  }
}

export function removeWorktree(repoDir: string, wt: Worktree): RemovalResult {
  const target = realOrResolved(wt.path)
  const root = realOrResolved(repoDir)

  // Decide ownership ONCE, while the directory still exists. Asking later
  // would be unreliable: realOrResolved falls back to a lexical path for
  // something already deleted, and a lexical /tmp/... does not match a
  // realpath'd /private/tmp/... -- so a just-removed worktree would look
  // like it was never ours and its parent would be left behind.
  const ours = isOurWorktree(target)

  // Belt: never touch the repository itself. `git worktree remove` refuses
  // the main working tree on its own, so this guard exists only because of
  // the direct rmSync below, which has no such protection.
  if (target === root || root.startsWith(`${target}${sep}`)) {
    return {
      removed: false,
      warning: `refusing to remove ${target}: it is, or contains, the repository root`,
    }
  }

  let gitError: string | undefined
  try {
    git(repoDir, ['worktree', 'remove', '--force', target])
  } catch (err) {
    // Keep the whole message: git puts the actual reason ("is not a working
    // tree", "is a main working tree") on a later line, so taking only the
    // first would make every failure read identically.
    gitError = (err instanceof Error ? err.message : String(err)).trim()
  }

  // Reconcile git's administrative record either way.
  try {
    git(repoDir, ['worktree', 'prune'])
  } catch {
    // Metadata only; a failure here does not affect the directory.
  }

  // Gated on `isRegisteredWorktree`: only ask `hasUncommittedWork` about a
  // path git currently recognises as a worktree of this repository. For
  // anything else -- never registered, or its administrative record already
  // gone -- there is no reliable answer, and the existing fallback below
  // (force remove, then the ownership-gated direct delete) already handles
  // those cases correctly.
  if (
    existsSync(target) &&
    isRegisteredWorktree(repoDir, target) &&
    hasUncommittedWork(target)
  ) {
    return {
      removed: false,
      warning:
        `keeping ${target}: it has uncommitted work on branch ${wt.branch}. ` +
        `Commit it there, or delete the directory once you have salvaged it.`,
    }
  }

  const survivedGit = existsSync(target)
  if (survivedGit) {
    // Braces: only a directory this module created may be deleted directly.
    if (!ours) {
      return {
        removed: false,
        warning:
          `refusing to delete ${target}: it is not a worktree this module created ` +
          `(expected a ${WT_PREFIX}* directory under the system temp directory)`,
      }
    }
    try {
      rmSync(target, { recursive: true, force: true })
    } catch (err) {
      return { removed: false, warning: `could not remove worktree ${target}: ${String(err)}` }
    }
  }

  // The mkdtemp parent holds only this worktree; drop it if it is now empty.
  // Gated by the SAME ownership check as the deletion above. Without it this
  // block still ran when git's own removal succeeded, so a git-registered
  // worktree at a non-conventional path had its parent removed too -- which
  // the "only ours" invariant exists to forbid, and which made the invariant
  // non-uniform across the function.
  if (ours) {
    const parent = dirname(target)
    try {
      if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
    } catch {
      // A shared or non-empty parent is not ours to remove.
    }
  }

  // Warn only when git actually failed AND left something behind for us to
  // clean up. A second call, or a target that was already gone, is a clean
  // no-op -- reporting a git failure there would be factually wrong and
  // would recreate the ambiguity this result type exists to remove.
  if (survivedGit && gitError !== undefined) {
    return {
      removed: true,
      warning: `git could not remove the worktree cleanly, directory was deleted directly: ${gitError}`,
    }
  }
  return { removed: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/worktree.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(run): git worktree isolation for a run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Doctor

**Contract, stated before any code:**

`attractor doctor` reports whether this machine can run a pipeline. It checks: the `claude` CLI is present and reports a version; `git` is present; a POSIX shell is available; and it reports the optional pieces later plans need (Bun for the Discord channel, Graphviz for image rendering) without failing on their absence. Exit code is 0 when everything required is present, 1 otherwise. Each check reports independently — one missing tool must not mask the rest, because an operator fixing their environment needs the whole list, not the first failure.

**Files:**
- Create: `plugins/attractor/engine/src/doctor.ts`
- Test: `plugins/attractor/engine/test/doctor.test.ts`

**Interfaces:**
- Produces: `interface Check { name: string; ok: boolean; required: boolean; detail: string }`, `function runChecks(): Check[]`, `function formatChecks(checks: Check[]): string`, `function checksPass(checks: Check[]): boolean`.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/doctor.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, formatChecks, checksPass, probeTool as probe, type Check } from '../src/doctor.ts'

test('every required tool is checked', () => {
  const names = runChecks().map((c) => c.name)
  for (const required of ['claude', 'git', 'sh']) {
    assert.ok(names.includes(required), `${required} must be checked`)
  }
})

test('optional tools are checked but marked optional', () => {
  const checks = runChecks()
  for (const optional of ['bun', 'dot']) {
    const c = checks.find((x) => x.name === optional)
    assert.ok(c, `${optional} must be reported`)
    assert.equal(c?.required, false, `${optional} must not be required`)
  }
})

test('git and sh are present on any machine that can run this suite', () => {
  const checks = runChecks()
  assert.equal(checks.find((c) => c.name === 'git')?.ok, true)
  assert.equal(checks.find((c) => c.name === 'sh')?.ok, true)
})

test('a tool that exists but fails is reported as present, not missing', () => {
  // git exists on any machine running this suite; a bogus subcommand makes it
  // exit non-zero. Reporting that as "not found" would send an operator
  // looking for a binary that is already installed.
  const checks = runChecks()
  assert.equal(checks.find((c) => c.name === 'git')?.ok, true, 'precondition: git works')

  const broken = probe('git', ['definitely-not-a-subcommand'], true)
  assert.equal(broken.ok, false)
  assert.match(broken.detail, /present but failing/)
  assert.doesNotMatch(broken.detail, /not found/)
})

test('a genuinely absent binary is reported as not found', () => {
  const absent = probe('attractor-no-such-binary-xyz', ['--version'], false)
  assert.equal(absent.ok, false)
  assert.equal(absent.detail, 'not found')
})

test('a missing optional tool does not fail the overall verdict', () => {
  const checks: Check[] = [
    { name: 'claude', ok: true, required: true, detail: '2.1.220' },
    { name: 'bun', ok: false, required: false, detail: 'not found' },
  ]
  assert.equal(checksPass(checks), true)
})

test('a missing required tool fails the overall verdict', () => {
  const checks: Check[] = [
    { name: 'claude', ok: false, required: true, detail: 'not found' },
    { name: 'bun', ok: true, required: false, detail: '1.0' },
  ]
  assert.equal(checksPass(checks), false)
})

test('the report names every check and marks optional ones', () => {
  const text = formatChecks([
    { name: 'claude', ok: true, required: true, detail: '2.1.220' },
    { name: 'bun', ok: false, required: false, detail: 'not found' },
  ])
  assert.match(text, /claude/)
  assert.match(text, /2\.1\.220/)
  assert.match(text, /bun/)
  assert.match(text, /optional/i, 'an absent optional tool must be visibly optional')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/doctor.test.ts
```
Expected: FAIL — cannot resolve `../src/doctor.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/attractor/engine/src/doctor.ts`:

```typescript
import { execFileSync } from 'node:child_process'

export interface Check {
  name: string
  ok: boolean
  required: boolean
  detail: string
}

function probe(name: string, args: string[], required: boolean): Check {
  try {
    const out = execFileSync(name, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { name, ok: true, required, detail: out.trim().split('\n')[0] || 'present' }
  } catch (err) {
    // "missing" and "present but broken" need different answers. Telling an
    // operator whose claude install has an auth problem that it is "not
    // found" sends them hunting for a binary already on their PATH -- the
    // opposite of what this command exists to do.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { name, ok: false, required, detail: 'not found' }
    }
    const reason = err instanceof Error ? err.message.trim().split('\n')[0] : String(err)
    return { name, ok: false, required, detail: `present but failing: ${reason}` }
  }
}

/**
 * Every check runs independently. An operator repairing their environment
 * needs the complete list in one pass, so a missing tool must not short
 * circuit the ones after it.
 */
/** Exported for tests: the two failure modes must be distinguishable. */
export function probeTool(name: string, args: string[], required: boolean): Check {
  return probe(name, args, required)
}

export function runChecks(): Check[] {
  return [
    probe('claude', ['--version'], true),
    probe('git', ['--version'], true),
    probe('sh', ['-c', 'echo ok'], true),
    // Optional: the Discord channel plugin is a Bun script (Plan 3), and
    // Graphviz renders images (Plan 5). Neither blocks running a pipeline.
    probe('bun', ['--version'], false),
    probe('dot', ['-V'], false),
  ]
}

export function checksPass(checks: Check[]): boolean {
  return checks.every((c) => c.ok || !c.required)
}

export function formatChecks(checks: Check[]): string {
  const lines = checks.map((c) => {
    const mark = (c.ok ? 'ok' : c.required ? 'MISSING' : 'absent').padEnd(7)
    const tag = c.required ? '' : ' (optional)'
    return `  ${mark}  ${c.name}${tag}: ${c.detail}`
  })
  return `attractor doctor\n${lines.join('\n')}\n`
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test test/doctor.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(cli): environment preflight checks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: CLI wiring

**Contract, stated before any code:**

`attractor run` uses the real backend by default; `--stub` selects the deterministic one. New flags: `--model`, `--max-budget-usd`, `--worktree` (isolate in a git worktree), `--allow-tools`. A new `doctor` subcommand reports the environment and exits 0 or 1. When `--worktree` is requested in a non-repository the run refuses before doing anything. The worktree is removed when the run finishes, and its branch is reported so the operator knows where the work went. Every existing Plan 1 behaviour — lint before run, exit codes, `--param` validation — is unchanged.

**Files:**
- Modify: `plugins/attractor/engine/src/cli.ts`
- Test: `plugins/attractor/engine/test/cli-backend.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-6.
- Produces: no new exports; `main` gains the flags above.

- [ ] **Step 1: Write the failing test**

Create `plugins/attractor/engine/test/cli-backend.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli.ts'

const GOOD = `
digraph G {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  start -> a -> done
}
`

function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-cli-be-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('doctor reports the environment and exits meaningfully', async () => {
  const code = await main(['doctor'])
  assert.ok(code === 0 || code === 1, 'doctor returns a definite verdict')
})

test('--worktree in a non-repository refuses before running anything', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--worktree', '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 1, 'a non-repository must not silently run in place')
  })
})

test('an unknown flag is a usage error rather than being ignored', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main(['run', file, '--nonsense', '--cwd', dir, '--stub'])
    assert.equal(code, 2)
  })
})

test('--stub still runs a graph unchanged', async () => {
  await withTemp(async (dir) => {
    const file = join(dir, 'g.dot')
    writeFileSync(file, GOOD, 'utf8')
    const code = await main([
      'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub',
    ])
    assert.equal(code, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/attractor/engine && node --test test/cli-backend.test.ts
```
Expected: FAIL — `doctor` is an unknown command (exit 2, not 0 or 1); `--worktree` is ignored so the run succeeds; `--nonsense` is silently ignored.

- [ ] **Step 3: Write minimal implementation**

Modify `plugins/attractor/engine/src/cli.ts`. Add imports:

```typescript
import { ClaudeCodeBackend } from './backend/claude.ts'
import { createWorktree, removeWorktree, isGitRepo } from './run/worktree.ts'
import { runChecks, formatChecks, checksPass } from './doctor.ts'
```

Extend `RunArgs` and its parser with the new options, rejecting anything unrecognised:

```typescript
interface RunArgs {
  file: string
  params: Record<string, string>
  cwd: string
  runDir: string
  stub: boolean
  model?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
  worktree: boolean
}
```

Inside `parseRunArgs`'s loop, add these branches before the final `else`:

```typescript
    } else if (arg === '--model') {
      model = argv[++i]
    } else if (arg === '--max-budget-usd') {
      const raw = argv[++i] ?? ''
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`invalid --max-budget-usd "${raw}": expected a positive number\n`)
        return null
      }
      maxBudgetUsd = n
    } else if (arg === '--allow-tools') {
      allowedTools = (argv[++i] ?? '').split(',').filter((t) => t !== '')
    } else if (arg === '--worktree') {
      worktree = true
    } else if (arg.startsWith('--')) {
      // Ignoring an unrecognised flag would let a typo change what runs.
      process.stderr.write(`unknown option ${arg}\n`)
      return null
    }
```

Add the `doctor` command to `main`, before the `run` branch:

```typescript
  if (command === 'doctor') {
    const checks = runChecks()
    process.stdout.write(formatChecks(checks))
    return checksPass(checks) ? 0 : 1
  }
```

Replace the backend selection in the `run` branch:

```typescript
    let worktree: Worktree | undefined
    let cwd = args.cwd
    if (args.worktree) {
      if (!isGitRepo(args.cwd)) {
        process.stderr.write(
          `--worktree requires a git repository; ${args.cwd} is not one\n`,
        )
        return 1
      }
      worktree = createWorktree(args.cwd, runId)
      cwd = worktree.path
      process.stdout.write(`worktree: ${worktree.path} (branch ${worktree.branch})\n`)
    }

```

and wrap the engine run so the worktree is always cleaned up. Replace the
existing reporting block with exactly this:

```typescript
    // The try opens IMMEDIATELY after createWorktree, not at engine.run().
    // Engine's constructor builds an EventLog, whose constructor calls
    // mkdirSync -- real I/O that throws on a bad or inaccessible --run-dir.
    // With the guard opening later, that throw leaks the worktree it had
    // already created.
    try {
      const backend = args.stub
        ? new StubBackend({})
        : new ClaudeCodeBackend({
            cwd,
            model: args.model,
            addDir: worktree?.path,
            maxBudgetUsd: args.maxBudgetUsd,
            allowedTools: args.allowedTools ?? ['Bash', 'Read', 'Write', 'Edit'],
          })
      const engine = new Engine({
        graph: parseDot(source),
        context: Context.from(args.params),
        runDir: args.runDir,
        cwd,
        handlers: defaultHandlers(backend),
        runId,
      })
      const result = await engine.run()
      process.stdout.write(`status: ${result.status}\n`)
      process.stdout.write(`path:   ${result.path.join(' -> ')}\n`)
      if (result.notes) process.stdout.write(`notes:  ${result.notes}\n`)
      process.stdout.write(`run:    ${args.runDir}\n`)
      if (worktree !== undefined) {
        // The branch is the deliverable; say where it is even on failure,
        // because a failed run's partial work is often what gets reviewed.
        process.stdout.write(`work is on branch ${worktree.branch}\n`)
      }
      return result.status === Status.SUCCESS ? 0 : 1
    } finally {
      if (worktree !== undefined) {
        const removal = removeWorktree(args.cwd, worktree)
        // Surface a cleanup problem rather than leaving a stale worktree
        // behind silently; the run's own exit code is unaffected.
        if (removal.warning !== undefined) process.stderr.write(`${removal.warning}\n`)
      }
    }
```

Add `Worktree` to the type imports. Generate `runId` as the run directory's
basename plus a short random suffix:

```typescript
const runId = `${basename(args.runDir)}-${randomUUID().slice(0, 8)}`
```

The suffix is not decoration. `removeWorktree` deliberately preserves branches,
so a bare basename means a second run against the same `--run-dir` -- an
ordinary retry -- collides with the branch the previous run left behind, `git
worktree add` fails, and the run dies with an uncaught exception instead of a
clean message. Import `randomUUID` from `node:crypto` and `basename` from
`node:path`. Update `USAGE` to list every new flag and the `doctor` command. Remove the "no LLM backend is available in this build" guard — there is one now.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd plugins/attractor/engine && node --test
```
Expected: PASS — the full suite including the 4 new CLI tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor/engine
git commit -m "feat(cli): real backend, worktree isolation, doctor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Live integration and bundle

**Contract, stated before any code:**

One test actually invokes `claude`, proving the whole path end to end. It is **opt-in** via an environment variable, because it costs money and requires a logged-in CLI; skipped by default it must not fail. The bundle is rebuilt so `dist/attractor.js` matches the source, and the README is updated to say the real backend now exists.

**Files:**
- Create: `plugins/attractor/engine/test/live.test.ts`
- Modify: `plugins/attractor/README.md`
- Rebuild: `plugins/attractor/dist/attractor.js`

- [ ] **Step 1: Write the opt-in live test**

Create `plugins/attractor/engine/test/live.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeCodeBackend } from '../src/backend/claude.ts'
import { Context } from '../src/core/context.ts'
import { Status } from '../src/core/outcome.ts'
import { Handler, type Graph, type Node } from '../src/dot/graph.ts'

const LIVE = process.env.ATTRACTOR_LIVE === '1'

test('a real claude -p call writes a file and reports success', { skip: !LIVE }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-live-'))
  try {
    const node: Node = { id: 'work', attrs: {}, handler: Handler.CODERGEN }
    const graph: Graph = { name: 'g', attrs: {}, nodes: new Map(), edges: [] }
    const backend = new ClaudeCodeBackend({
      cwd: dir,
      addDir: dir,
      model: 'haiku',
      maxBudgetUsd: 1,
      allowedTools: ['Bash', 'Write'],
    })
    const outcome = await backend.run(
      node,
      'Write a file named live.txt containing exactly: ATTRACTOR-LIVE. Then reply DONE.',
      Context.from({}),
      graph,
    )
    assert.equal(outcome.status, Status.SUCCESS)
    assert.equal(readFileSync(join(dir, 'live.txt'), 'utf8').trim(), 'ATTRACTOR-LIVE')
    assert.ok((outcome.metrics?.costUsd ?? 0) > 0, 'a real call records real spend')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Confirm it skips by default**

```bash
cd plugins/attractor/engine && node --test test/live.test.ts
```
Expected: 1 test, 1 skipped, 0 failed.

- [ ] **Step 3: Run it live once**

```bash
cd plugins/attractor/engine && ATTRACTOR_LIVE=1 node --test test/live.test.ts
```
Expected: PASS. This spends a few cents. Record the output in the report.

- [ ] **Step 4: Update the README and rebuild**

In `plugins/attractor/README.md`, change the Status section to say shell nodes and LLM nodes both execute for real, that LLM nodes run as `claude -p` subprocesses using the operator's existing Claude Code login with no API key, and that `--stub` remains available for deterministic runs. Change the `box` row of the shape table from "works, stub backend only" to "works". Add the new flags and the `doctor` command to the usage section. State that `--worktree` requires a git repository.

Then:

```bash
cd plugins/attractor/engine && npm run build
```

- [ ] **Step 5: Full suite and commit**

```bash
cd plugins/attractor/engine && node --test
git add plugins/attractor
git commit -m "feat(backend): live integration test, README, rebuilt bundle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification

Plan 2 is complete when:

- [ ] `node --test` is green with the live test skipped.
- [ ] `ATTRACTOR_LIVE=1 node --test test/live.test.ts` passes against a real `claude`.
- [ ] `attractor doctor` reports `claude`, `git` and `sh` present.
- [ ] A pipeline whose box node edits a file runs to success in a worktree, and the main working tree is untouched afterwards.
- [ ] No dependency beyond `@ts-graphviz/ast` and `esbuild`.
- [ ] Every task's report records a mutation check for its new tests.

## Carry-forward items this plan closes

From `plugins/attractor/.superpowers/carry-forward.md`:

- **`signal?: AbortSignal` and `Outcome.metrics` are now actually wired** —
  Task 4 uses the signal to kill a child, Task 2 populates metrics with spend
  and turn counts.
- **The `carriesVerdict` / raw-`contextUpdates` concern is resolved by
  construction, not by a fix.** `interpretResult` never produces
  `contextUpdates` at all: a Claude-backed node returns only `status`,
  `preferredLabel`, `notes` and `metrics`. So a real backend has no channel
  through which to forge the `tool.` namespace or manufacture evidence from a
  junk update map. Plan 1's `tool.` filter in `BoxHandler` remains as defence
  for any future backend that does return updates. Record this in the ledger
  rather than leaving the carry-forward item open.

Still open after Plan 2: the engine does not merge `Outcome.contextUpdates`
centrally (only `BoxHandler` does), which stays a Plan 4 concern when parallel
branches need consistent merge semantics.

## What Plan 2 deliberately does not do

Human gates still abort with "no handler registered" (Plan 3). Parallel execution likewise (Plan 4). No visualization (Plan 5). No doctrine port or marketplace packaging (Plan 6). `--json-schema` is requested only for goal-gate nodes, not universally, because forcing structure on ordinary work nodes would constrain them for no routing benefit.
