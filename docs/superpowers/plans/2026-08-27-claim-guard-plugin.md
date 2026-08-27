# claim-guard Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `claim-guard` plugin to this marketplace — a Claude Code port of the amplifier static claim-verification gate: 7 adversarial lens agents, a deterministic `claim_ledger` MCP server (trust anchor), a concierge skill, and a PreToolUse write-blocking hook.

**Architecture:** The ledger is a bundled stdio MCP server (TypeScript → esbuild → committed `dist/claim-ledger.js`, the attractor pattern) exposing ONE tool `claim_ledger` dispatched by an `operation` parameter. Agents and skills are markdown ports of the upstream amplifier bundle with platform adaptations (delegate→Agent tool, LSP→Grep). A PreToolUse hook denies Edit/Write/NotebookEdit while `.claim-guard/GUARD_ACTIVE` exists.

**Tech Stack:** Node 20+, TypeScript (compile via esbuild only, tests run against `tsx`-free plain JS — see Task 2), `node --test`, `@modelcontextprotocol/sdk`, no other runtime deps.

**Spec:** `docs/superpowers/specs/2026-08-27-claim-guard-plugin-design.md`. Upstream reference: clone of https://github.com/colombod/amplifier-bundle-claim-guard at `$SCRATCH/amplifier-bundle-claim-guard` (re-clone if missing: `git clone --depth 1 https://github.com/colombod/amplifier-bundle-claim-guard.git`).

## Global Constraints

- Plugin name `claim-guard`, version `0.1.0`; MCP server name `claim-ledger`; tool name `claim_ledger`.
- Model-visible tool name (used verbatim in agent/skill prompts): `mcp__plugin_claim-guard_claim-ledger__claim_ledger` — but prompts refer to it as "the `claim_ledger` tool" and list the full name once.
- Ledger writes ONLY under `<project>/.claim-guard/` (runs in `.claim-guard/<run_id>/ledger.json`, marker at `.claim-guard/GUARD_ACTIVE`). Project root = `process.cwd()` of the server (Claude Code launches plugin MCP servers in the project dir), overridable via env `CLAIM_GUARD_REPO`.
- Every op returns `{ ok: true, ... }` or `{ ok: false, error: "<code>", message: "<human>" }`. Never throw across the tool boundary.
- Verdict vocab: `CONFIRMED | REFUTED | UNTESTABLE | N/A`. Aggregates add `PENDING`. Claim types: `correspondence | safety | quantitative | temporal | concurrency | coverage`. Gate policies: `advisory | blocking-with-waiver | blocking` (default `blocking-with-waiver`).
- Phase-2 fields exist in the schema but no Phase-2 ops: `probe_eligibility` (set from type at add), `probe: null`, `standing_test: null`.
- All new files ASCII-safe markdown/TS; follow existing repo style (2-space JSON indent, LF).
- Commit after every task (baseline commits per user's global CLAUDE.md); Co-Authored-By trailer.
- Validate with `claude plugin validate ./plugins/claim-guard` before each commit from Task 7 on.

## File Structure (final)

```
plugins/claim-guard/
  .claude-plugin/plugin.json
  .mcp.json
  README.md
  agents/{claim-harvester,purpose-inquisitor,correspondence-auditor,
          test-correspondence-auditor,chokepoint-mapper,boundary-adversary,
          empirical-verifier}.md
  skills/{claim-guard,claim-guard-review,claim-harvesting,verify-against-source,
          adverse-state-catalog,properly-delivered-claim}/SKILL.md
  hooks/hooks.json
  hooks/scripts/guard-writes.js
  ledger/package.json
  ledger/src/{types.ts,identity.ts,store.ts,aggregate.ts,ops.ts,gate.ts,matrix.ts,server.ts}
  ledger/test/{identity,store,add-claims,verdicts,aggregate,gate,matrix,guard,hook}.test.js
  dist/claim-ledger.js
.github/workflows/claim-guard-tests.yml
.claude-plugin/marketplace.json          (modify)
README.md                                (modify: plugins table + registry bump note)
```

Module responsibilities: `types.ts` shared types/constants; `identity.ts` claim-id normalizer; `store.ts` load/save run JSON + write confinement + run ids; `aggregate.ts` worst-wins; `ops.ts` all op handlers (pure functions over store); `gate.ts` limbs + policies; `matrix.ts` markdown/json rendering; `server.ts` MCP stdio wiring + operation dispatch.

---

### Task 1: Plugin scaffold + registry entry

**Files:**
- Create: `plugins/claim-guard/.claude-plugin/plugin.json`, `plugins/claim-guard/.mcp.json`, `plugins/claim-guard/README.md` (stub: title + one-paragraph purpose + "under construction")
- Modify: `.claude-plugin/marketplace.json` (add plugin entry; bump registry `version` to `1.1.0`)

**Interfaces:**
- Produces: plugin id `claim-guard@ai-augmentation-systems`; `${CLAUDE_PLUGIN_ROOT}/dist/claim-ledger.js` as the server entry (built in Task 7 — validate passes because `.mcp.json` is declaration-only).

- [ ] **Step 1: Write plugin.json** — mirror delivery's manifest shape:

```json
{
  "name": "claim-guard",
  "version": "0.1.0",
  "description": "Adversarial claim-verification gate for changesets: harvests explicit and implicit claims, fans 7 adversarial lens agents out cold to refute each against the shipped source, and emits an auditable claim-verification matrix with a deterministic BLOCK / PASS / INDETERMINATE verdict computed by a bundled claim_ledger MCP tool. Reviews; never edits the code it reviews.",
  "author": { "name": "Diego Colombo", "url": "https://github.com/colombod" },
  "homepage": "https://github.com/colombod/ai-augmentation-systems",
  "repository": "https://github.com/colombod/ai-augmentation-systems",
  "license": "MIT",
  "keywords": ["verification", "adversarial-review", "claims", "pre-merge", "gate", "code-review", "quality"]
}
```

- [ ] **Step 2: Write .mcp.json**

```json
{
  "mcpServers": {
    "claim-ledger": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/claim-ledger.js"],
      "env": { "CLAIM_GUARD_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}" }
    }
  }
}
```

- [ ] **Step 3: Add marketplace entry** — append to `plugins[]` in `.claude-plugin/marketplace.json`, and bump top-level `version` `1.0.0`→`1.1.0`:

```json
{
  "name": "claim-guard",
  "source": "./plugins/claim-guard",
  "version": "0.1.0",
  "description": "Adversarial claim-verification gate: harvest a changeset's explicit and implicit claims, refute each against the shipped source via 7 lens agents, and gate merge with a deterministic BLOCK / PASS / INDETERMINATE verdict.",
  "keywords": ["verification", "adversarial-review", "claims", "pre-merge", "gate", "quality"]
}
```

- [ ] **Step 4: Validate + commit**

Run: `claude plugin validate ./plugins/claim-guard` → expect pass (warnings about missing dist are acceptable at this stage; if validate hard-fails on the missing dist file, create an empty placeholder `dist/claim-ledger.js` with `#!/usr/bin/env node` + `// built in Task 7`).
Commit: `feat(claim-guard): scaffold plugin manifest, MCP declaration, registry entry`

---

### Task 2: Ledger engine scaffold + stable claim IDs

**Files:**
- Create: `plugins/claim-guard/ledger/package.json`, `ledger/src/types.ts`, `ledger/src/identity.ts`, `ledger/test/identity.test.js`

**Interfaces:**
- Produces: `claimId(text: string, type: ClaimType, sourceRelPath: string): string` (returns `clm_<8hex>`); `normalizeClaimText(text: string): string`; types `ClaimType`, `Verdict`, `Aggregate`, `GatePolicy`, `ClaimRecord`, `VerdictRecord`, `RunRecord`, `OpResult`.
- Test import path note: tests import **built** output helpers via a small `ledger/test/build.js`? NO — simpler: package.json declares `"test": "npm run build:test && node --test"` where `build:test` esbuild-bundles each `src/*.ts` to `ledger/.build/*.js` (esm, external none). Tests import from `../.build/<mod>.js`. `.build/` is gitignored.

- [ ] **Step 1: package.json**

```json
{
  "name": "@colombod/claim-ledger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "esbuild src/server.ts --bundle --platform=node --format=esm --banner:js='#!/usr/bin/env node' --outfile=../dist/claim-ledger.js",
    "build:test": "esbuild src/types.ts src/identity.ts src/store.ts src/aggregate.ts src/ops.ts src/gate.ts src/matrix.ts --outdir=.build --platform=node --format=esm",
    "test": "npm run build:test && node --test test/"
  },
  "dependencies": { "@modelcontextprotocol/sdk": "^1.0.0" },
  "devDependencies": { "esbuild": "^0.25.0" }
}
```

Add `plugins/claim-guard/ledger/.build/` and `plugins/claim-guard/ledger/node_modules/` to root `.gitignore`.

- [ ] **Step 2: types.ts** — exact constants and record shapes from the spec's data model (claim record incl. `lens_errors: []`, `waiver: null`, Phase-2 nulls; verdict record with `lens, verdict, evidence, counter_case, round, recorded_at`; run record with `run_id, gate_policy, created_at, claims, debate, audit` — `audit: []` holds ratchet-rejection entries).

- [ ] **Step 3: failing tests for identity** (`test/identity.test.js`), the upstream F-9 behaviors:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimId, normalizeClaimText } from '../.build/identity.js';

test('reword-stable: case, quotes, articles, contractions do not fork identity', () => {
  const a = claimId('The server won’t corrupt data', 'safety', 'commit');
  const b = claimId("the server will not corrupt data", 'safety', 'commit');
  assert.equal(a, b);
});
test('negation is never stripped', () => {
  assert.notEqual(
    claimId('the cache is cleared on boot', 'correspondence', 'commit'),
    claimId('the cache is not cleared on boot', 'correspondence', 'commit'));
});
test('numbers and identifiers preserved atomically', () => {
  assert.notEqual(
    claimId('stays under 100ms', 'quantitative', 'commit'),
    claimId('stays under 200ms', 'quantitative', 'commit'));
  const a = claimId('`max_delete` is validated', 'safety', 'commit');
  const b = claimId('max_delete is validated', 'safety', 'commit');
  assert.equal(a, b); // backticks fold, identifier survives casefolded
});
test('type-sensitive', () => {
  assert.notEqual(
    claimId('retries are bounded', 'safety', 'commit'),
    claimId('retries are bounded', 'quantitative', 'commit'));
});
test('embedded file:line trailing line number stripped in code spans', () => {
  assert.equal(
    claimId('guard lives at registry.py:648', 'correspondence', 'commit'),
    claimId('guard lives at registry.py:9', 'correspondence', 'commit'));
});
test('shape', () => {
  assert.match(claimId('x', 'coverage', 'pr-body'), /^clm_[0-9a-f]{8}$/);
});
```

- [ ] **Step 4: run to verify fail** — `cd plugins/claim-guard/ledger && npm install && npm test` → FAIL (module missing).

- [ ] **Step 5: implement identity.ts** — `normalizeClaimText`: NFKC; fold typographic quotes to ASCII; split into code-spans (backtick-delimited, `path.ext[:line]` tokens with the `:line` suffix stripped, `snake_case`/`camelCase` identifiers, bare numbers) preserved atomically casefolded, and prose-spans: casefold, expand a closed contraction map (`won't→will not`, `don't→do not`, `can't→cannot`, `isn't→is not`, `doesn't→does not`, `aren't→are not`, `didn't→did not`, `wasn't→was not`, `couldn't→could not`, `shouldn't→should not`, `wouldn't→would not`), fold punctuation to spaces, remove a closed filler set (`a an the is are was were be been being will would to of that this it and`, plus lead-ins `the code ensures that|this change ensures that|ensures that`), collapse whitespace. NEVER remove: `not never no cannot must may might all any some none` or numbers. `claimId = 'clm_' + sha1(norm + '|' + type + '|' + sourceRelPath).slice(0,8)` via `node:crypto`.

- [ ] **Step 6: run tests → PASS; commit** `feat(claim-guard): ledger scaffold + stable claim identity (F-9 normalizer)`

---

### Task 3: Store, runs, add_claim/add_claims/list ops

**Files:**
- Create: `ledger/src/store.ts`, `ledger/src/ops.ts` (first ops), `ledger/test/store.test.js`, `ledger/test/add-claims.test.js`

**Interfaces:**
- Produces (store): `repoRoot(): string` (env `CLAIM_GUARD_REPO` || cwd); `runDir(runId)`; `newRunId(): string` (`run_<8hex>` random); `loadRun(runId): RunRecord | null`; `saveRun(run: RunRecord): void` (mkdir -p, atomic tmp+rename, ONLY under `.claim-guard/`); `listRunIds(): string[]`.
- Produces (ops): every op handler has signature `op<Name>(input: any): OpResult`. This task: `opStartRun({gate_policy?})`, `opAddClaim({run_id, text, type, source, inferred, basis?, quote?})`, `opAddClaims({run_id?, claims:[...]})`, `opListClaims({run_id, type?, aggregate?})`, `opListRuns({stranded_only?})`.
- Semantics: `add_claim` idempotent on claim_id (re-add updates source/basis, never resets verdicts, `was_new:false`); empty `run_id` on `add_claim` auto-creates a run; `add_claims` threads run_id from first successful add, per-element errors in `errors[{index,error,message}]` without aborting; rejects wholly on non-array/empty `claims`; `probe_eligibility` from type (`safety|quantitative|temporal|concurrency`→`eligible`, else `not_eligible`); `list_runs` returns `[{run_id, created_at, claims, pending, stranded}]` + `stranded_count` where `stranded = claims>0 && pending>0`.

- [ ] **Step 1: failing tests.** store.test.js: saveRun/loadRun roundtrip in a tmp repo (`CLAIM_GUARD_REPO` env pointed at `fs.mkdtempSync`); write-confinement (path of every file created starts with `<tmp>/.claim-guard/`); loadRun of unknown id → null. add-claims.test.js:

```js
test('add_claim auto-creates run on empty run_id and is idempotent', ...);
test('re-add updates source, keeps verdicts, was_new=false', ...);
test('add_claims: malformed element recorded in errors, rest land', () => {
  const r = opAddClaims({ run_id: '', claims: [
    { text: 'a', type: 'safety', source: 'commit:x', inferred: false },
    { text: 'b', type: 'bogus-type', source: 'commit:x', inferred: false },
    { text: 'c', type: 'coverage', source: 'commit:x', inferred: true, basis: 'implied' }
  ]});
  assert.equal(r.ok, true); assert.equal(r.added, 2);
  assert.equal(r.errors.length, 1); assert.equal(r.errors[0].index, 1);
});
test('add_claims rejects empty claims array wholly', ...);
test('start_run rejects unknown gate_policy, nothing written', ...);
test('list_runs stranded_only flags claims>0 && pending>0', ...);
```

- [ ] **Step 2: run → FAIL. Step 3: implement store.ts + these ops in ops.ts. Step 4: run → PASS.**
- [ ] **Step 5: commit** `feat(claim-guard): ledger store with write confinement + run/claim CRUD ops`

---

### Task 4: record_verdict — evidence enforcement, ratchet, worst-wins aggregation

**Files:**
- Create: `ledger/src/aggregate.ts`, `ledger/test/verdicts.test.js`, `ledger/test/aggregate.test.js`
- Modify: `ledger/src/ops.ts` (add `opRecordVerdict`)

**Interfaces:**
- Produces: `aggregate(claim: ClaimRecord): Aggregate` — worst-wins over `claim.verdicts`; zero verdicts → `PENDING`; only `N/A` → `N/A`.
- `opRecordVerdict({run_id, claim_id, lens, verdict, evidence?, counter_case?, adverse_state_test?, round?})` → `{ok, claim_id, lens, verdict, aggregate}` | errors `evidence_required` / `counter_case_required` / `ratchet_violation` / `run_not_found` / `claim_not_found` / `invalid_input`. Same lens re-recording replaces its previous verdict (a revision, tagged with `round`). Optional `adverse_state_test {exists, test_ref, reason}` updates the claim's field (the test-correspondence-auditor's channel). Anchor regex: `/\S+\.[A-Za-z]{1,8}:\d+/` at least one token in `evidence[]` for CONFIRMED/REFUTED; UNTESTABLE/N/A require a non-empty reason in `counter_case` or `evidence[0]` but no anchor. Ratchet: if this claim's current aggregate is REFUTED (or this lens's prior verdict was REFUTED) and the new verdict moves toward CONFIRMED, reject unless `evidence` has ≥1 anchor not already present across ALL the claim's existing verdict evidence; on rejection append `{type:'ratchet_rejection', lens, claim_id, at}` to `run.audit` (this write DOES persist even though the verdict does not).

- [ ] **Step 1: failing tests** — aggregate.test.js covers every precedence pair (`R+C→R`, `U+C→U`, `R+U→R`, `C+NA→C`, `NA only→NA`, `[]→PENDING`); verdicts.test.js:

```js
test('CONFIRMED without file:line anchor rejected, nothing written', ...);
test('REFUTED without counter_case rejected', ...);
test('UNTESTABLE needs reason but no anchor', ...);
test('ratchet: REFUTED→CONFIRMED with only re-cited anchors rejected + audited', ...);
test('ratchet: new anchor accepted, aggregate recomputed', ...);
test('same lens re-record replaces, different lens appends', ...);
test('adverse_state_test payload lands on the claim', ...);
```

- [ ] **Steps 2–4: fail → implement → pass. Step 5: commit** `feat(claim-guard): record_verdict with structural evidence enforcement + worst-wins`

---

### Task 5: record_lens_error, record_debate, waive

**Files:**
- Modify: `ledger/src/ops.ts`
- Create: `ledger/test/lens-errors.test.js`

**Interfaces:**
- `opRecordLensError({run_id, claim_id, lens, error})` → appends `{lens, error, recorded_at}` to `claim.lens_errors`; NEVER touches verdicts/aggregate/adverse_state_test.
- `opRecordDebate({run_id, round, to_lens, relayed_payload, from_lenses})` → appends to `run.debate`.
- `opWaive({run_id, claim_id, by, reason})` → sets `claim.waiver = {by, reason, at}`.

- [ ] **Step 1: failing tests** — lens error on a claim with an existing CONFIRMED leaves aggregate CONFIRMED; lens error creates no verdict; debate record persists verbatim payload; waive stores by/reason. **Steps 2–4: fail → implement → pass. Step 5: commit** `feat(claim-guard): lens-error, debate-relay and waiver ops`

---

### Task 6: gate, render_matrix, report

**Files:**
- Create: `ledger/src/gate.ts`, `ledger/src/matrix.ts`, `ledger/test/gate.test.js`, `ledger/test/matrix.test.js`
- Modify: `ledger/src/ops.ts` (`opAggregate`, `opGate`, `opRenderMatrix`, `opReport`)

**Interfaces:**
- `computeGate(run: RunRecord, policy?: GatePolicy)` → `{verdict, blocking_claims:[{claim_id,text,category:'substantive'|'procedural',reasons:[...]}], indeterminate_reasons:[], coverage:{harvested,verified,probed,deferred,waived}, blocking_summary:{substantive,procedural,total_claims_blocked}}`. Limbs per spec: (1) REFUTED→BLOCK substantive; (2) safety && !adverse_state_test.exists→BLOCK procedural `no-adverse-state-test` (independent of limb 1 — a claim can carry both reasons, listed ONCE with reasons grouped); (3) UNTESTABLE && !waiver→BLOCK procedural (policy: advisory reports-not-blocks limbs 1–3; blocking-with-waiver: waiver clears that claim's limbs 1–3 contribution; blocking: waiver recorded but clears nothing); (4) any PENDING → INDETERMINATE `claim-pending:<id>`; any lens_errors entry → `lens-error:<lens>@<id>`; (5) `harvested==0` → `zero-claims-harvested`. INDETERMINATE wins over BLOCK-downgrades: advisory never downgrades INDETERMINATE. Precedence of final verdict: any limb 4/5 reason → INDETERMINATE; else any un-cleared limb 1–3 under a blocking policy → BLOCK; else PASS.
- `renderMatrix(run, format)` → markdown 8 columns exactly: `Claim | Type | Source (inferred?) | Verdict | Evidence (file:line) | Counter-case | Adverse-state test | Lens errors`, then blank line, then `Coverage: harvested N / verified N / probed 0 / deferred 0 / waived N`; json format returns the raw run record.
- `opReport({run_id, gate_policy?, format?})` = gate + matrix in one result `{ok, run_id, verdict, blocking_claims, indeterminate_reasons, coverage, blocking_summary, matrix}`; gate errors returned unchanged; matrix never rendered when gate fails.
- `verified` = claims with aggregate ∉ {PENDING}. 

- [ ] **Step 1: failing tests** — each limb independently; limb-2 fires on CONFIRMED safety claim without adverse test; both limb-4 reason shapes; zero-claims; the three policies incl. `advisory keeps INDETERMINATE`; `blocking: waiver does not clear`; waived REFUTED clears under blocking-with-waiver (documented tool reach — the discipline lives in the skill); blocked claim appears once with reasons grouped; report is gate+matrix consistent from one read. Matrix tests: column order, coverage line, lens-error cell `lens: error`, `-` when none.
- [ ] **Steps 2–4: fail → implement → pass. Step 5: commit** `feat(claim-guard): deterministic gate (5 limbs, 3 policies) + matrix + report`

---

### Task 7: Guard ops + MCP server + committed dist

**Files:**
- Create: `ledger/src/server.ts`, `ledger/test/guard.test.js`
- Modify: `ledger/src/ops.ts` (`opActivateGuard`, `opDeactivateGuard`), `plugins/claim-guard/dist/claim-ledger.js` (build output, committed)

**Interfaces:**
- `opActivateGuard({})` → writes `<repo>/.claim-guard/GUARD_ACTIVE` (content: ISO timestamp); `opDeactivateGuard({})` → removes it; both idempotent, both `{ok:true, active:boolean}`.
- server.ts: `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`; registers ONE tool `claim_ledger` with inputSchema `{operation: enum[15], ...open object}` (pass through to a dispatch map `{start_run, add_claim, add_claims, list_claims, list_runs, record_verdict, record_lens_error, record_debate, waive, aggregate, gate, render_matrix, report, activate_guard, deactivate_guard}`); tool description states the trust-anchor role, the op list, and "storage under .claim-guard/ is private to this tool — never read it directly". Result = `content:[{type:'text', text: JSON.stringify(opResult)}]`. Unknown operation → `{ok:false, error:'unknown_operation'}`.

- [ ] **Step 1: failing guard tests** (marker created exactly at `.claim-guard/GUARD_ACTIVE`, idempotency, deactivate removes). **Step 2–3: implement, pass.**
- [ ] **Step 4: build + smoke** — `npm run build`; smoke-test the stdio server end-to-end with a here-doc JSON-RPC exchange:

```bash
cd plugins/claim-guard && printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"claim_ledger","arguments":{"operation":"start_run"}}}' \
 | CLAIM_GUARD_REPO=$(mktemp -d) node dist/claim-ledger.js
```

Expected: a `tools/call` result whose text contains `"ok":true` and a `run_id`.
- [ ] **Step 5: validate + commit** (`claude plugin validate ./plugins/claim-guard`) `feat(claim-guard): claim_ledger MCP stdio server + guard marker ops (committed dist)`

---

### Task 8: Write-blocking hook

**Files:**
- Create: `plugins/claim-guard/hooks/hooks.json`, `hooks/scripts/guard-writes.js`, `ledger/test/hook.test.js`

**Interfaces:**
- hooks.json:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard-writes.js"] }
        ]
      }
    ]
  }
}
```

(match delivery's `command`+`args` style; if `claude plugin validate` rejects the split form, fall back to the single-string `"command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard-writes.js"`.)
- guard-writes.js (no deps): read stdin JSON `{cwd, tool_name, tool_input}`; resolve project root as `process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()`; if `<root>/.claim-guard/GUARD_ACTIVE` exists → print deny JSON and exit 0:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"claim-guard review posture active — the gate never edits the code it reviews. Finish the run (Phase 7 close-out runs claim_ledger deactivate_guard) or abandon it explicitly to re-enable writes."}}
```

else exit 0 with no output (allow). Any internal error → allow (exit 0, empty) — the hook must never brick editing when the plugin is broken; log to stderr.
- hook.test.js: spawn `node hooks/scripts/guard-writes.js` with stdin fixtures in a tmp repo, assert deny JSON when marker present, empty stdout when absent, allow on unreadable marker dir.

- [ ] **Steps: failing tests → implement → pass → validate → commit** `feat(claim-guard): PreToolUse hook blocks Edit/Write/NotebookEdit while guard active`

---

### Task 9: Port the 7 lens agents

**Files:**
- Create: `plugins/claim-guard/agents/<name>.md` × 7 (names in File Structure)

**Interfaces:**
- Produces agent names used verbatim by the skills: `claim-harvester`, `purpose-inquisitor`, `correspondence-auditor`, `test-correspondence-auditor`, `chokepoint-mapper`, `boundary-adversary`, `empirical-verifier`.

Port procedure per agent — source bodies are at `$SCRATCH/amplifier-bundle-claim-guard/agents/<same-name>.md`:

- [ ] **Step 1:** for each agent, write Claude Code frontmatter. Template (tools line varies):

```yaml
---
name: correspondence-auditor
description: "Claim-guard lens — verifies claim ↔ shipped-code correspondence: does the load-bearing code actually do what the claim says, and where is the line that proves it? Dispatch cold (no shared context) with the literal run_id embedded in the instruction. Records verdicts itself via the claim_ledger tool."
tools: Read, Grep, Glob, Bash, mcp__plugin_claim-guard_claim-ledger__claim_ledger
---
```

`empirical-verifier` keeps Bash prominently (it executes); harvesters (`claim-harvester`, `purpose-inquisitor`) get `tools: Read, Grep, Glob` ONLY (they return claims, never record — the concierge owns `add_claims`; give them no ledger tool so the stranded-fork failure mode is structurally impossible).
- [ ] **Step 2:** port each body verbatim-in-spirit with these mandatory adaptations (apply to every file):
  1. `claim_ledger` tool references → "the `claim_ledger` tool (full name `mcp__plugin_claim-guard_claim-ledger__claim_ledger`)" on first mention, short name after.
  2. Remove amplifier-isms: `delegate`, `context_depth`, bundle/behavior/recipe references. A lens is dispatched via the Agent tool by the concierge.
  3. Every verdict lens body ends with the hard rule block: *"Record every verdict via `claim_ledger` `record_verdict` with the literal `run_id` from your instruction. CONFIRMED/REFUTED require a `path:line` anchor; REFUTED requires a counter-case. If you cannot rule, record UNTESTABLE or N/A with a reason — never skip a claim silently."*
  4. `chokepoint-mapper`: replace LSP `incomingCalls` instructions with Grep-based caller tracing (grep for the symbol name, its exported aliases, and re-export sites; enumerate the search patterns used in the verdict evidence so an incomplete caller map is visible). State the degradation explicitly in the body.
  5. `empirical-verifier`: DTU references → "a disposable environment only if one is trivially available; otherwise the shipped test, a minimal in-process repro, or the real function directly, in a temp dir". Keep the rule: could-not-execute → N/A, never CONFIRMED.
- [ ] **Step 3:** `claude plugin validate ./plugins/claim-guard` → pass. **Step 4: commit** `feat(claim-guard): port the 7 static lens agents`

---

### Task 10: Port the skills

**Files:**
- Create: `plugins/claim-guard/skills/{claim-guard,claim-guard-review,claim-harvesting,verify-against-source,adverse-state-catalog,properly-delivered-claim}/SKILL.md`

**Interfaces:**
- Consumes: agent names from Task 9, tool name from Task 7, guard ops.

- [ ] **Step 1: `skills/claim-guard/SKILL.md`** — the concierge. Frontmatter:

```yaml
---
name: claim-guard
description: "Run the adversarial claim-verification gate on a changeset IN THE CURRENT SESSION — harvest explicit+implicit claims, fan the lens bench out cold via the Agent tool, debate to consensus, aggregate via the claim_ledger tool, and emit the claim-verification matrix with a deterministic BLOCK/PASS/INDETERMINATE verdict. Load whenever asked to verify, gate, or adversarially review a diff/PR/branch. Never drive claim_ledger op-by-op without this playbook."
user-invocable: true
argument-hint: "<base>..<head> [notes]"
---
```

Body: port `$SCRATCH/amplifier-bundle-claim-guard/skills/claim-guard-here/SKILL.md` phases 0–7 with adaptations: `delegate`→Agent tool (lens agent names above; note subagents start cold by default — the isolation the bench requires); `foundation:explorer`→the Explore agent; mode activation→"Phase 0: call `claim_ledger` `activate_guard`" and close-out Phase 7 additionally calls `deactivate_guard` (ALWAYS — also on abandon); harvesters RETURN claims (they have no ledger tool) and the concierge records them in ONE `add_claims` call with the literal run_id; drop the recipes/`verify-claims` alternative path (no recipe runner — the phases are always driven inline) and the work-tracker cross-reference; keep verbatim-in-spirit: run_id propagation rules, Gate A human checkpoint, coverage check before report, `record_lens_error` backstop, single `report` call, debate ratchet, substantive-vs-procedural synthesis, waiver discipline (only ever waive a procedural block), stranded-run close-out via `list_runs stranded_only`.
- [ ] **Step 2: `skills/claim-guard-review/SKILL.md`** — frontmatter `name: claim-guard-review`, `user-invocable: true`, `argument-hint: "<base>..<head>"`, `context: fork`, `agent: general-purpose`. Body: instruct the forked agent to load the `claim-guard` skill and run the full gate on the named changeset, returning roster manifest + matrix + verdict verbatim; it must not edit code.
- [ ] **Step 3: discipline skills** — port bodies from `$SCRATCH/amplifier-bundle-claim-guard/skills/<name>/SKILL.md` (claim-harvesting, verify-against-source, adverse-state-catalog, properly-delivered-claim) with the same terminology adaptations; frontmatter for each: `name`, `description` (from upstream description), no `user-invocable` (model-invocable reference material). Skip `probe-patterns` and `work-tracker-with-claim-guard` (Phase 2 / amplifier-specific).
- [ ] **Step 4: validate + commit** `feat(claim-guard): concierge + review + discipline skills`

---

### Task 11: README, CI, root README, final validation

**Files:**
- Create: `plugins/claim-guard/README.md` (replace stub), `.github/workflows/claim-guard-tests.yml`
- Modify: root `README.md` (plugins table row)

- [ ] **Step 1: plugin README** — structure mirrors upstream's but Claude-Code-native: what it does (gate rule + worst-wins, the flip to "how is this claim false?"), install (`/plugin install claim-guard@ai-augmentation-systems`), the bench table (7 lenses), usage (`/claim-guard:claim-guard <base>..<head>` and the agent path "just ask"), how to read the matrix/verdict (verdict + per-claim states + limb list), the write-blocking posture and its scope (Edit/Write/NotebookEdit; Bash by discipline), storage note (`.claim-guard/` private to the tool; gitignore it in consuming repos), differences from upstream (no Phase-2 probing yet; LSP→Grep chokepoint degradation; no recipes), repository layout tree.
- [ ] **Step 2: CI workflow** — copy the shape of `.github/workflows/attractor-tests.yml`, adapted: trigger on `paths: plugins/claim-guard/**`; steps: checkout, setup-node 20, `npm ci` + `npm test` in `plugins/claim-guard/ledger`, then `npm run build` and `git diff --exit-code ../dist/` to assert the committed dist matches the source.
- [ ] **Step 3: root README table row** for claim-guard.
- [ ] **Step 4: full check** — `cd plugins/claim-guard/ledger && npm test` all green; `claude plugin validate ./plugins/claim-guard` pass; `claude --plugin-dir ./plugins/claim-guard` smoke if available non-interactively, else skip with a note.
- [ ] **Step 5: commit** `feat(claim-guard): README, CI workflow, registry docs — plugin complete at 0.1.0`

---

## Self-Review Notes

- Spec coverage: layout→T1; ledger contract semantics→T2–T7 (identity F-9→T2; confinement/batch→T3; enforcement+ratchet+worst-wins→T4; lens-error/debate/waive→T5; limbs/policies/matrix/report/blocking_summary→T6; guard+server→T7); hook→T8; agents+adaptations→T9; skills incl. Gate A/close-out/waiver discipline→T10; tests+CI+registry/README→T1,T11. Phase-2 exclusion honored throughout (schema fields in T2 types).
- Type consistency: op names match the 15-op dispatch list in T7; agent names in T9 = names referenced in T10; anchor regex defined once (T4) and referenced by T9's hard-rule block.
- No placeholders: porting tasks reference exact upstream source paths + concrete adaptation lists; all code-bearing steps carry code.
