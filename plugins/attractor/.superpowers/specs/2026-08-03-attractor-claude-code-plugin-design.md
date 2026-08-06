# Attractor for Claude Code — Design

**Date:** 2026-08-03
**Status:** Approved design, pending implementation plan
**License:** MIT

---

## 1. Summary

Build a native Claude Code plugin that brings **attractor** — DOT-graph-driven
convergence orchestration — to Claude Code, with no dependency on Microsoft's
Amplifier runtime.

The plugin ships three things:

1. **An engine** (TypeScript) that executes a Graphviz DOT graph as a program:
   nodes are computation, edges are dispatch. LLM nodes run as headless
   `claude -p` sessions using the operator's existing Claude Code
   authentication — no API keys.
2. **The authoring doctrine** — an `attractor-expert` agent, an `/attractorify`
   design skill, reference context, and a corpus of example pipelines, ported
   from `microsoft/amplifier-bundle-attractor` and re-derived where it is
   coupled to that engine's runtime semantics.
3. **An operator surface** — human-in-the-loop gates that never time out
   unless explicitly configured, multi-channel notification (Discord as the
   documented primary), and run visualization including a native convergence
   record.

---

## 2. Background and research findings

### 2.1 The landscape

| Project | Status | Content |
|---|---|---|
| [`strongdm/attractor`](https://github.com/strongdm/attractor) | Specification only, Apache-2.0 | Three nlspecs (~277 KB of prose): `attractor-spec.md`, `coding-agent-loop-spec.md`, `unified-llm-spec.md`. No code. |
| [`brynary/attractor`](https://github.com/brynary/attractor) | **Archived** | TypeScript/Bun implementation of the specs. Author moved to a separate Rust product. Dead end. |
| [`microsoft/amplifier-bundle-attractor`](https://github.com/microsoft/amplifier-bundle-attractor) | **Live**, MIT | The only maintained implementation. ~27 k LOC Python across 13 modules, plus the complete authoring doctrine. |

No Claude Code plugin for attractor exists. No `attractor` package is published
to npm or PyPI; the upstream CLI installs only from the Microsoft git
repository, on top of `amplifier-core` (a Rust kernel with Python bindings,
published to PyPI at v1.6.0).

### 2.2 What the Microsoft bundle actually contains

Two separable halves:

**The engine** (`modules/loop-pipeline`, 12.7 k LOC): DOT parser, edge
selection, retry with backoff, checkpointing, goal gates, fidelity modes,
parallel fan-out/fan-in, human gates, model stylesheets. Runs on
`amplifier-core`.

**The doctrine and authoring surface** (~2 k lines): `agents/attractor-expert.md`,
`skills/attractorify/SKILL.md`, `context/{engine-semantics,dot-reference,
pipeline-awareness,attractor-expert-defenses}.md`,
`docs/{DOT-AUTHORING-GUIDE,PIPELINE_DESIGN_PRINCIPLES,PIPELINE_PATTERNS,
ROUTING-REFERENCE}.md`, and 16 example pipelines including the
battle-hardened `examples/patterns/task-runner.dot`.

The doctrine half is the high-value asset. It is written from live failure
post-mortems, not from theory:

- A worker hand-authored a fake `convergence.jsonl` to satisfy its own gate.
  Dual critics *outside its context* caught it and refused to ship. One
  adaptive mega-node with a self-assessed exit would have shipped the
  fabrication.
- A convergence judge marked `goal_gate=true` wrote "NOT CONVERGED — 2 of 7
  criteria pass" and was recorded `outcome=success` by the engine's fail-open
  default. The designed replan loop never fired; the pipeline exited false
  success with zero work product after 2.4 hours.
- A review probe false-SHIPped a run because a critique quoted its own
  instructions ("write VERDICT: SHIP or VERDICT: ITERATE") and a bare
  `grep -qi 'SHIP'` matched the instruction text.
- 14 red iterations were burned re-flipping a coin on a stale-`.pyc` defect
  that no code change could fix.
- A run burned its whole budget on same-class failures that hashed "novel"
  every time, because a random `/tmp/...` path in the failure signature made
  every identical failure look new, so the root-cause wall never fired.

None of this is reproducible from the specification. It is the reason the port
is worth doing.

### 2.3 The integration seam

The engine's LLM execution point is a narrow protocol
(`modules/loop-pipeline/amplifier_module_loop_pipeline/handlers/codergen.py:26`):

```python
class CodergenBackend(Protocol):
    async def run(self, node, prompt, context,
                  incoming_edge=None, graph=None) -> str | Outcome: ...
```

`AmplifierBackend` implements it by spawning an Amplifier child session. This
confirms that the *worker* is pluggable and the *control plane* is not
provider-specific — which is what makes a native port tractable.

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Native engine, zero Amplifier dependencies** | Avoids `amplifier-core`, Python, and the Rust kernel. The plugin must install and run from Claude Code alone. |
| D2 | **TypeScript**, bundled by esbuild into one committed `dist/attractor.js` | Node-first matches the Claude Code ecosystem; bundling means no install step and no runtime dependency resolution; works on macOS/Linux/Windows. |
| D3 | **Conformance target: convergence core + parallel** | Everything `task-runner.dot` needs, plus `component`/`tripleoctagon` fan-out and fan-in. Defers manager loop, folder subgraphs, model stylesheets, remote DOT sources. |
| D4 | **Workers are `claude -p` subprocesses** using the operator's existing login | No API keys. Inherits the operator's model access, settings, and plugins. |
| D5 | **Git worktree per run + `bypassPermissions`** | Unattended work never touches the operator's working copy; blast radius is a deletable branch. |
| D6 | **Human gates never time out unless the graph says so** | See §7. The engine parks rather than guesses. |
| D7 | **MIT license**, with attribution | The Microsoft bundle is MIT (directly compatible). The StrongDM spec is Apache-2.0, but implementing a specification is not copying it; we cite it as upstream authority and do not vendor its prose. |
| D8 | **Distributed via `colombod/ai-augmentation-systems`** as a private plugin marketplace | Verified: private marketplaces authenticate with existing git credentials. Relative-path plugin sources keep everything in one repo. |

### 3.1 Rejected alternatives

- **In-session orchestration** (Claude walks its own graph via subagents).
  Rejected: it puts the control plane inside the worker's context, which is the
  precise failure the doctrine exists to prevent. Verification inside the
  context that produced the evidence is not verification.
- **Wrapping the upstream `attractor run` CLI.** Rejected: requires Python +
  uv + provider API keys, and executes on Amplifier's providers rather than
  the operator's Claude Code auth.
- **Porting `brynary/attractor`.** Rejected: archived, and has no Claude Code
  integration.
- **Authoring-only plugin** (doctrine without an engine). Rejected: an authored
  `.dot` with nothing to run on is a design artifact, not a capability.

---

## 4. Architecture

Three planes, strictly separated. The separation is the design.

```
Interactive Claude Code session (the operator)
  │  /attractorify   → designs a .dot                    AUTHORING plane
  │  /attractor run  → launches, then monitors
  ▼
attractor engine — detached background process           CONTROL plane
  │  parses DOT, selects edges, enforces gates,
  │  retries, checkpoints, records convergence
  │  never asks an LLM what to do next
  ├─ parallelogram node → POSIX shell; routes on exit code + last stdout line
  └─ box node → spawn `claude -p` in a git worktree       WORK plane
```

**The engine is not an in-session orchestrator.** `/attractor run` starts a
detached process and returns. The interactive session becomes a *client* of the
run — it monitors and bridges notifications, and closing it does not stop the
run.

---

## 5. Engine design

### 5.1 Modules

```
dot/       parse.ts       DOT → AST (@ts-graphviz/ast, bundled)
           graph.ts       Graph/Node/Edge model; shape → handler mapping
           lint.ts        TOPO-001..005, CMD-001/002, HITL-001

core/      context.ts     shared key/value store; context_updates merge
           substitute.ts  $name / ${name} expansion; absent keys pass through
           condition.ts   outcome= / preferred_label= / context.k=v / &&
           edge-select.ts 5-step deterministic selection + fail-fast guard
           retry.ts       exponential backoff; retry_target resolution order
           checkpoint.ts  checkpoint.json save/resume
           engine.ts      traversal, goal gates, runs_on, continue_on_fail,
                          max_pipeline_duration

handlers/  box.ts         codergen → ClaudeCodeBackend
           tool.ts        parallelogram → POSIX shell
           conditional.ts diamond (no-op; engine evaluates edges)
           parallel.ts    component fan-out, max_parallel semaphore
           fan-in.ts      tripleoctagon consolidation
           human.ts       hexagon gate → park + notify (§7)

backend/   claude.ts      spawn claude -p, parse stream-json, thread continuity

run/       worktree.ts    git worktree lifecycle
           events.ts      events.jsonl append-only log
           convergence.ts native gate-outcome record (§8.3)
           render.ts      annotated DOT / SVG / PNG / Mermaid

cli.ts     lint | run | status | watch | approve | resume | graph
           | dashboard | doctor
```

### 5.2 Shape-to-handler mapping (v1)

| Shape | Handler | v1 |
|---|---|---|
| `Mdiamond` | start | ✅ |
| `Msquare` | exit | ✅ |
| `box` | codergen (LLM) | ✅ |
| `parallelogram` | tool (shell) | ✅ |
| `diamond` | conditional | ✅ |
| `hexagon` | wait.human | ✅ |
| `component` | parallel fan-out | ✅ |
| `tripleoctagon` | parallel fan-in | ✅ |
| `house` | manager loop | deferred |
| `folder` | nested sub-pipeline | deferred |

### 5.3 Edge selection

Deterministic, in this order, per spec §3.3:

1. Condition matching against context and outcome
2. Preferred label from the handler outcome
3. Explicit `suggested_next_ids`
4. Weight, descending
5. Lexical tiebreak on target node id

Fail-fast is preserved: on `outcome.status=FAIL`, unconditional edges are **not**
followed. Explicit failure routing is required — a `condition="outcome=fail"`
edge, a node-level `retry_target` / `fallback_retry_target`, or a downstream
`runs_on=always|failure`. Otherwise the pipeline terminates loudly.

### 5.4 The fail-closed goal gate

We adopt Microsoft's documented delta from day one rather than inheriting the
upstream fail-open default: a `goal_gate=true` node that returns plain prose —
no structured outcome, no verdict file — returns `RETRY`, not `SUCCESS`. A goal
gate cannot be satisfied by silence or by a response that says the work is not
done.

---

## 6. Claude Code backend

### 6.1 Node invocation

Each `box` node spawns (validated by spike S4, §14.1):

```
printf '%s' "<expanded prompt>" | claude -p
  --output-format json
  --model <resolved>
  --permission-mode bypassPermissions
  --add-dir <worktree>
  --session-id <uuid>            # or --resume <uuid> for fidelity=full
  --max-budget-usd <n>           # per-node spend ceiling
  --allowedTools Bash,Write,Edit,Read      # COMMA-separated, never space
  --json-schema <outcome schema>           # goal-gate nodes
  --append-system-prompt <node contract>
```

**The prompt goes on stdin, never as argv.** `--allowedTools`, `--add-dir`, and
`--tools` are *variadic*: a space-separated tool list followed by a positional
prompt silently swallows the prompt as another tool name, and the CLI then exits
1 with `Input must be provided either through stdin or as a prompt argument`.
Spike S4 hit this. Passing the prompt on stdin removes the entire class of
argv-quoting and variadic-capture bugs — and attractor prompts are long,
multi-line, and full of shell-hostile characters.

### 6.2 Reading the outcome

The `--output-format json` result object supplies everything `Outcome` needs:

| Field | Use |
|---|---|
| `is_error` | Primary success/failure signal |
| `result` | The response, or — with `--json-schema` — **a JSON *string*** that must be `JSON.parse`d, not an object |
| `session_id` | Thread continuity bookkeeping; stable across `--resume` |
| `total_cost_usd`, `usage`, `modelUsage` | Spend records, budget walls, convergence log |
| `num_turns` | Tool-loop depth; loop-detection signal |
| `permission_denials` | Diagnoses a node starved by an allowlist |
| `subtype` | `success` / error classification |

**Never route on `stop_reason`.** It reads `tool_use` even on a fully
successful run (observed in spike S3). Route on `is_error` plus the parsed
verdict.

### 6.3 What native buys us over the reference implementation

| Problem upstream | Native fix |
|---|---|
| `fidelity=full` could not resume a session, so it replayed `parent_messages` into a fresh spawn. Their own design doc calls the prior approach a "type confusion". | `--session-id` / `--resume` is genuine session continuity. `--fork-session` isolates parallel branches. |
| Goal gates false-passed on prose; patched with a fail-closed delta. | `--json-schema` forces a validated outcome object at the source, *in addition to* the file-based verdict + deterministic gate the doctrine prescribes. **Verified — spike S3.** |
| Budget walls hand-rolled in bash (`.ai/iter` counters). | `--max-budget-usd` is a real spend ceiling, alongside iteration counts. |
| Required `ANTHROPIC_API_KEY`. | Inherits the operator's login. |
| Convergence record hand-appended from bash; engine-native support only *proposed* upstream. | Recorded by the engine (§8.3). |

### 6.4 Isolation

Each run creates a dedicated git worktree. Box nodes run with
`bypassPermissions` confined to that tree via `--add-dir`. Work ships back as a
branch. Parallel branches share the worktree by default (correct for read-only
critics); nodes that write opt in to a per-branch worktree.

If the target is not a git repository, the run refuses to start rather than
silently falling back to in-place execution.

---

## 7. Human in the loop

### 7.1 The rule

A human gate exists to get a decision from a person. It never invents one. The
default is to wait indefinitely, and every way of *not* waiting is written into
the graph by the pipeline author.

| Attribute | Effect | Decides? |
|---|---|---|
| *(none — default)* | Block indefinitely; run parks, checkpointed | No |
| `reminder="30m"` | Re-fire notifications every 30 m while parked | No |
| `timeout="4h"` + `on_timeout="<label>"` | After 4 h, take the named edge | Yes — and only because the author named it |

**`timeout` without `on_timeout` is lint error HITL-001.** There is no implicit
fallback anywhere: no "first edge wins", no "abandon on timeout". If the graph
does not say, the engine waits.

### 7.2 Lifecycle

```
hexagon node reached
   │
   ├─ 1. checkpoint.json written (resumable across reboot)
   ├─ 2. pending-approval.json written        ← SOURCE OF TRUTH
   ├─ 3. choices derived from outgoing edge labels ([A] Abandon / [C] Continue)
   ├─ 4. notifications fired (all best-effort, all may fail silently)
   └─ 5. engine polls for resolution — no CPU, no tokens, no spend
              │                            │
     human answers                 nobody answers
              ▼                            ▼
   validate label against outgoing   stay parked indefinitely
   edges → record who/when/channel   (or reminder / declared timeout)
   → checkpoint → resume
```

A parked run costs nothing, survives terminal close, and survives reboot —
`attractor resume <run>` re-enters the gate and finds the same
`pending-approval.json`.

**Notification is transport, never state.** Remote Control sessions die after
~10 minutes offline; phones lose pushes; terminals get closed. If notification
were load-bearing, a dropped message would strand a run. Instead a dropped
message means the operator finds the gate later via `/attractor status`, and
nothing was decided in their absence.

### 7.3 Resolution

```
/attractor approve <run-id> <label>
```

From the launching session, any other Claude Code session, the Discord bridge,
or the raw CLI. The engine validates the label against actual outgoing edges,
records the answer with who / when / which channel into `events.jsonl`, and
resumes. An invalid label is rejected and the gate stays open.

### 7.4 Unattended runs

Presence is declared at launch, not guessed mid-run:

```
attractor run task-runner.dot --unattended
```

Preflight **rejects the run** if any reachable `hexagon` node lacks
`on_timeout`:

```
PREFLIGHT FAIL — unattended run, but node `escalate` can block forever.
  Add on_timeout="<label>" (one of: Abandon, Continue), or drop --unattended.
```

Three modes: **attended** (default, gates block), **unattended** (every gate
must pre-declare its no-human path, checked before spending anything), and
**per-node** (`timeout` + `on_timeout` on specific gates).

### 7.5 Effect on the ported exemplar

`task-runner.dot` currently comments: *"Abandon is listed first so
timeout/auto-approve fails safe."* That is a workaround for an implicit rule we
are removing. On this engine edge order carries no meaning; the ported file gets
`timeout` + `on_timeout="Abandon"` written explicitly, and the comment is
replaced with the real reason.

### 7.6 Scope

The same mechanism serves **any** request for human input, not only approvals:
free-form answers, multiple choice, and confirmations all park the run and route
through the same durable state and notification stack. `hexagon` nodes whose
outgoing edges are unlabelled collect free-form input into context instead of
selecting an edge.

---

## 8. Operator onboarding

This section is the setup path for long-running pipelines. It is what makes an
overnight run usable rather than merely possible.

### 8.1 The monitor session

Channels are MCP servers that push events into a **running Claude Code
session**. The engine cannot post to Discord by itself, and events only arrive
while a session is open. The monitor session is therefore a first-class
component, not a convenience.

```bash
tmux new -s attractor
claude --channels plugin:discord@claude-plugins-official
```

Then `/attractor watch` inside it. `attractor doctor` warns when a run has
reachable gates but no monitor is attached.

### 8.2 Discord setup (documented primary channel)

Discord is preferred over Remote Control push because it is **two-way and
persistent** — the message waits in your DMs whether or not you were looking,
and it does not die when the machine goes offline.

**Prerequisite:** [Bun](https://bun.sh) (`bun --version`).

1. **Create the bot** — [Discord Developer Portal](https://discord.com/developers/applications)
   → New Application → Bot → set a username → **Reset Token**, copy it.
2. **Enable Message Content Intent** — Bot settings → Privileged Gateway
   Intents. Without it the bot cannot read messages.
3. **Invite to a server** — OAuth2 → URL Generator, scope `bot`, permissions:
   View Channels, Send Messages, Send Messages in Threads, Read Message
   History, **Attach Files** (needed for graph renders), Add Reactions.
4. **Install the plugin:**
   ```
   /plugin marketplace add anthropics/claude-plugins-official
   /plugin install discord@claude-plugins-official
   ```
   Choose **user scope**, then `/reload-plugins`.
5. **Configure the token** (writes `~/.claude/channels/discord/.env`):
   ```
   /discord:configure <bot-token>
   ```
6. **Restart with the channel enabled** — the bot is inert without this:
   ```bash
   claude --channels plugin:discord@claude-plugins-official
   ```
7. **Pair and lock down** — DM the bot; it replies with a pairing code:
   ```
   /discord:access pair <code>
   /discord:access policy allowlist
   ```
   The allowlist gates on **sender identity**, not room. An ungated channel is
   a prompt-injection vector into a session holding your files.

**Round trip:**

```
engine parks at hexagon → pending-approval.json          [durable]
        │
   monitor session (running --channels discord)
        │  reads the gate, calls Discord's reply tool, attaches graph PNG
        ▼
   Discord DM: "Run a3f9 parked at `escalate`. Budget exhausted after 6
                iterations.  A = Abandon (keep postmortem)
                             C = Continue (raise budget to 9)"
        │
   operator replies "C" from a phone
        │  Discord plugin forwards it as a <channel> event
        ▼
   monitor session runs: attractor approve a3f9 Continue
        │
   engine validates label → records → resumes
```

**Caveats to document for the operator:**

- Channels are a research preview. `--channels` is not listed in
  `claude --help`; the flag syntax may change.
- Team/Enterprise organizations must have an Owner enable channels in admin
  settings. Pro/Max personal accounts need no approval.
- A custom `attractor` channel plugin (engine → local webhook → session,
  removing the polling monitor) is possible but requires
  `--dangerously-load-development-channels`, since custom channels are not on
  Anthropic's curated allowlist. Deferred; the official Discord plugin is the
  recommended path.

### 8.3 Notification stack

Fired in parallel; each optional and independently failable:

| Channel | Reach | Requires |
|---|---|---|
| OS notification (`osascript` / `notify-send` / PowerShell toast) | Local desktop | Nothing |
| Discord DM | Anywhere, persistent | Monitor session + channel setup |
| Remote Control push | Phone | Remote Control active + `/config` push toggles |
| Passive (`/attractor status`) | On demand | Nothing |

---

## 9. Visualization

All views derive from one substrate: **`events.jsonl`**, appended on every state
transition — node start/end, outcome, edge taken, gate opened/resolved, tokens
and spend.

### 9.1 `/attractor status`

```
run a3f9c2  task-runner.dot   2h14m   $4.82   [PARKED at escalate]
goal: Complete the task in task.md to its full definition of done

  ✔ setup       ok           0.3s
  ✔ orient      success      1m02s
  ↻ attempt     success      4×    (last 8m11s)
  ✔ verify      green        iter 6/6
  ✔ critique    ship
  ⏸ escalate    WAITING FOR YOU — 41m
       [A] Abandon — keep the postmortem
       [C] Continue — raise the budget
```

### 9.2 `attractor graph <run>`

The original DOT re-emitted with run state baked into node attributes: done
green, current blue, failed red, parked amber, unreached grey. Back-edges carry
traversal counts; the path actually taken is drawn bold. Parallel branches
render as concurrent lanes.

Exports `--format svg|png|dot|mermaid`. The Mermaid form renders natively in a
Claude Code artifact, so `/attractor graph` in-session produces a clickable
picture. The PNG form is what the Discord gate message attaches.

**Renderer:** bundle `@hpcc-js/wasm` (WASM Graphviz), lazy-loaded, so SVG/PNG
need no system `dot` binary. Cost is a few MB in `dist/`, paid only on render.
Reversible: without it we emit DOT/Mermaid text and require system Graphviz for
images.

### 9.3 Convergence view

```
iter      1    2    3    4    5    6
verify    ✗    ✗    ✓    ✗    ✓    ✓
critique  ·    ·    ✗    ·    ✗    ✓
                    └── oscillating ──┘   └ descending
```

This answers the question the postmortem node actually asks — was the loop
**DESCENDING, OSCILLATING, or WANDERING**? Upstream hand-rolls this by
appending JSONL from bash inside `task-runner.dot`, and engine-native support is
only *proposed* there. We record gate outcomes in the engine from day one, so
the descent curve is data rather than an LLM's impression.

### 9.4 Status line and dashboard

- **Status line:** `⚙ a3f9 · verify · iter 4/6 · 2h14m · $4.82`
- **`attractor dashboard`:** optional localhost HTML, auto-refreshing — live
  graph, event log, convergence chart.

---

## 10. Doctrine port

Mechanical copying would be actively harmful here. The `attractor-expert`
agent's own instructions state that engine runtime semantics are the source of
truth and that *"reasoning from DOT syntax or the spec alone makes you
confidently wrong about the running engine."* Ported verbatim it would describe
**Amplifier's** engine, and be confidently wrong about ours.

| Asset | Treatment |
|---|---|
| `agents/attractor-expert.md` | **Rewrite.** Keep the design-time self-check (CMD-001/002, judge verdict contracts, delta-assertion gates, deferral/observer routing) — engine-independent. Replace all integration guidance (`DirectProviderBackend` vs `AmplifierBackend`, spawn capability) with ours. |
| `skills/attractorify/SKILL.md` | **Port near-verbatim.** The three-question test, the evidence-quoting diagnosis artifact, the fail-closed bash gate, the independent-verifier delegation, and the anti-self-dealing rule are all engine-independent and excellent. Only the lint command and handover format change. |
| `context/engine-semantics.md` | **Write from scratch**, from our tests. Non-negotiable: it is the expert's declared source of truth. |
| `context/dot-reference.md`, `docs/ROUTING-REFERENCE.md` | Port, then correct to our edge-selection implementation. |
| `docs/PIPELINE_DESIGN_PRINCIPLES.md`, `docs/PIPELINE_PATTERNS.md` | **Port near-verbatim.** Control-plane vs recipe-plane, tier discipline, SF/MLE/V+R output strategies, the live post-mortems. The most valuable text in the bundle. |
| `docs/DOT-AUTHORING-GUIDE.md` | Port; correct lint rules and attribute tables to ours; add HITL-001. |
| `examples/pipelines/*`, `examples/patterns/task-runner.dot` | Port and **re-verify each one runs** on our engine. An example that does not run is worse than none. |

Roughly a third of the ported corpus must be re-derived rather than copied.

---

## 11. Packaging and distribution

### 11.1 The target repository already exists

`colombod/ai-augmentation-systems` is live, private, and **actively developed by
another session** (last push 2026-08-03T09:48Z, three commits, currently shipping
a `delivery` plugin). This design conforms to its established conventions rather
than imposing new ones:

| Existing convention | Consequence for attractor |
|---|---|
| Root `.claude-plugin/marketplace.json`, plugins under `plugins/<name>/` | Matches this design exactly. |
| **Explicit semver** in both `marketplace.json` (`"version": "0.2.0"`) and each `plugin.json` | **Supersedes the earlier decision to omit `version`.** Attractor ships `0.1.0` and bumps on every user-visible change; commit-SHA versioning is not used here. |
| Capabilities live in `skills/<name>/SKILL.md`, not `commands/*.md` | Operator commands become skills: `skills/attractor-run/`, `attractor-status/`, `attractor-approve/`, `attractor-graph/`, `attractor-watch/`. |
| `agents/*.md` flat, `templates/` for shared assets | `agents/attractor-expert.md`; `context/` for expert reference material. |
| MIT, © 2026 Diego Colombo; `.gitignore` covers `node_modules/` but **not** `dist/` | The committed bundle needs no `.gitignore` change. |

**Coordination:** `marketplace.json` is a shared file and the other session is
actively editing the repo. Attractor lands on a branch, touching
`marketplace.json` with a single appended array entry to keep the merge
trivial. No rewrite of the file, no reordering of existing entries.

### 11.2 Layout

```
colombod/ai-augmentation-systems
├── .claude-plugin/marketplace.json     ← append one entry only
├── NOTICE                              ← attribution (new)
└── plugins/attractor/
    ├── .claude-plugin/plugin.json      ← explicit "version": "0.1.0"
    ├── README.md
    ├── agents/attractor-expert.md
    ├── skills/attractorify/SKILL.md
    ├── skills/attractor-run/SKILL.md
    ├── skills/attractor-status/SKILL.md
    ├── skills/attractor-approve/SKILL.md
    ├── skills/attractor-graph/SKILL.md
    ├── skills/attractor-watch/SKILL.md
    ├── context/                        ← engine semantics, DOT reference
    ├── examples/pipelines/
    ├── dist/attractor.js               ← committed; no install step
    └── engine/                         ← TS source + tests
```

**Install:**
```
/plugin marketplace add colombod/ai-augmentation-systems
/plugin install attractor
```

Private marketplaces authenticate with existing git credentials (`gh auth
login`, macOS Keychain, SSH agent). **Caveat:** background auto-update disables
credential helpers for HTTPS private pulls; SSH remotes update more reliably.

### 11.3 Cross-platform reality

The engine is cross-platform. The **pipelines** are not: every real attractor
`tool_command` is POSIX shell (`printf ok || printf fail`, `md5sum`, `$(...)`).
On Windows that means Git Bash or WSL. `attractor doctor` detects and reports
this. Rewriting the doctrine's shell idioms for `cmd.exe` would fork the entire
example corpus and is not worth it.

---

## 12. Documented deltas from the upstream spec

Following the upstream discipline that extensions are written down rather than
silently diverging, these land in `EXTENSIONS.md`:

| # | Delta | Rationale |
|---|---|---|
| E1 | Human gates never time out by default; `timeout` requires `on_timeout`; new lint rule HITL-001 | The spec's `wait.human` assumes an interactive `Interviewer` and leans on timeout-with-first-edge. Silent selection after a multi-hour run is unacceptable. |
| E2 | `reminder="<duration>"` — re-notify without deciding | Separates "operator absent, nag harder" from "operator absent, take a declared path". |
| E3 | `--unattended` preflight | Moves the no-human decision to launch time, where it is cheap, instead of hours into a run. |
| E4 | Engine-native convergence record | Upstream hand-rolls it in bash; engine support is only proposed there. Required for §9.3. |
| E5 | Fail-closed goal gates adopted as default | Matches Microsoft's Delta 1; the upstream fail-open default is the root cause of a documented false-success incident. |
| E6 | `hexagon` nodes with unlabelled outgoing edges collect free-form input into context rather than selecting an edge (§7.6) | The spec's `wait.human` derives choices from edge labels and so only models selection. Requests for free-form input, confirmations, and questions need the same durable park-and-notify machinery. |

---

## 13. Testing strategy

- **Unit:** condition evaluation, edge selection (all five steps and the
  fail-fast guard), substitution with absent keys, retry ordering, checkpoint
  round-trip.
- **Golden graphs:** each ported example pipeline runs to a known terminal state
  against a **stub backend** (deterministic, no LLM). This is what makes
  `context/engine-semantics.md` truthful — it is written *from* these tests.
- **Adversarial:** the documented failure modes are regression tests —
  pipe-masked exit codes (CMD-001), always-true sentinels (CMD-002), verdict
  grep false-SHIP, prose-only goal gate, stale `tool.last_line` on a failing
  tool node, volatile tokens in a failure signature.
- **Integration:** a live end-to-end run of `task-runner.dot` against a real
  `claude -p` on a scratch repository.
- **Human-gate:** park, notify, resolve, resume-across-restart; `--unattended`
  preflight rejection.

---

## 14. Risks and spikes

| # | Risk | Status |
|---|---|---|
| R1 | `--json-schema` may not compose with an agentic tool loop | **RESOLVED — positive** (spike S3). |
| R2 | `/attractor approve` may not be invokable from claude.ai/mobile (the local-only list covers built-ins such as `/plugin`, `/resume`) | **OPEN** — not spikeable without a second device. Fallback already designed: answer in prose to the monitor session, which runs the command locally. Not on the critical path. |
| R3 | Node may be absent for users on the native Claude Code installer | **Low** — Node 26.5.0 present on the dev machine. `attractor doctor` detects and reports; compiled binaries remain an option. |
| R4 | Channels are a research preview; flag syntax may change | **Accepted.** Document the version dependency; OS notification is the always-available fallback. **Bun is absent on the dev machine** — it is a prerequisite for the Discord channel plugin and belongs in `doctor`. |
| R5 | Bundled WASM Graphviz adds several MB to `dist/` | **Accepted.** Lazy-load; reversible to text-only output plus system `dot` (present on the dev machine at graphviz 15.1.0, but not assumable for others). |
| R6 | `claude -p` result schema may evolve | **Accepted.** Parse defensively; pin a tested CLI version range in `doctor`. Contract captured in §6.2 against CLI 2.1.220. |
| R7 | Concurrent development in the shared marketplace repo | **Mitigated** — branch plus single-entry append to `marketplace.json` (§11.1). |

### 14.1 Spike results (2026-08-03, Claude Code 2.1.220, Node 26.5.0)

| Spike | Question | Result |
|---|---|---|
| **S1** | Can `@ts-graphviz/ast` (3.0.6) parse the hardest real pipeline without mangling it? | **PASS.** `task-runner.dot` → 20 nodes, 30 edges. `verify.tool_command` (628 chars) round-trips byte-exact: escaped quotes unescape correctly, `$(...)`, `${VF%.md}`, `$task_file`, and embedded JSON `printf` formats all survive; no spurious newlines. Edge conditions and graph attrs parse as expected. |
| **S2** | What does `claude -p --output-format json` return? | **Contract captured** — see §6.2. |
| **S3** | Does `--json-schema` compose with an agentic tool loop? (R1) | **PASS.** 3 turns, Bash genuinely executed (verdict `notes` contained file contents read at runtime), result validated against the schema. Two gotchas: `result` is a JSON **string**, and `stop_reason` reads `tool_use` even on success. |
| **S4** | Does `--resume` give real session continuity, and does the worktree isolate writes? | **PASS.** Node 2 recalled `MAGIC-7391` from conversation alone with no file access; `session_id` stable across resume. Node 1's file landed in the worktree and never appeared in the main tree. |
| **S4b** | *(incidental)* Variadic flag hazard | **Found and fixed in design.** Space-separated `--allowedTools "Bash Write"` swallowed the positional prompt; CLI exited 1. Engine passes the prompt on **stdin** and uses comma-separated tool lists (§6.1). |

Spike cost: ~$0.14 total.

---

## 15. Open items

- R2 (approve from mobile) stays open until testable on a second device. It does
  not block implementation.
- Manager loop (`house`), folder subgraphs, model stylesheets, and remote DOT
  sources are deferred to a second milestone.
- Annotated-DOT **re-emission** (§9.2) needs a round-trip escaping check: S1
  proved parsing is faithful, but re-serializing `tool_command` strings back into
  valid DOT is the inverse problem and is untested.
- A purpose-built `attractor` channel plugin (§8.2) is deferred pending
  allowlist considerations.

---

## Attribution

This design ports material from
[`microsoft/amplifier-bundle-attractor`](https://github.com/microsoft/amplifier-bundle-attractor)
(MIT, © Microsoft Corporation) and implements the attractor nlspec published at
[`strongdm/attractor`](https://github.com/strongdm/attractor) (Apache-2.0).
Ported files carry per-file attribution headers; see `NOTICE`.
