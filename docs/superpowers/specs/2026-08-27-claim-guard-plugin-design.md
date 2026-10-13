# claim-guard plugin — design

**Date:** 2026-08-27
**Status:** approved (static gate only; MCP-server ledger; PreToolUse write block)
**Reference implementation:** [amplifier-bundle-claim-guard](https://github.com/colombod/amplifier-bundle-claim-guard)

## Purpose

Port the amplifier claim-guard **static gate** to a Claude Code plugin in this
marketplace. The gate runs an adversarial claim-verification pass over a changeset
before merge: harvest every claim the change makes (explicit and implicit), fan a
bench of adversarial lens agents out cold to prove each claim FALSE against the
shipped source, debate to consensus, and emit an auditable **claim-verification
matrix** plus a deterministic **BLOCK / PASS / INDETERMINATE** verdict.

The operating question is *"how is this claim false?"* — a commit message is a
hypothesis to disprove, not a fact.

## Scope

**In:** the static gate — 7 lens agents, the `claim_ledger` trust anchor as a
bundled MCP server, the concierge skill (`/claim-guard`), an isolated-review skill
(`/claim-guard-review`), 4 discipline skills, a PreToolUse write-blocking hook,
tests, CI, registry entry.

**Out (deliberately):** Phase-2 dynamic pen-testing (probe-designer, pen-tester,
regression-graduator, DTU integration) and the amplifier recipes. The ledger's
data model keeps the Phase-2 schema fields (unfilled) so Phase 2 can land later
without a migration. Claude Code has no recipe runner; the concierge skill drives
the phases itself, which upstream already treats as the canonical path.

## Plugin layout

```
plugins/claim-guard/
  .claude-plugin/plugin.json     manifest v0.1.0; declares the MCP server
  README.md
  agents/                        7 static lenses (Claude Code agent format)
    claim-harvester.md           harvester — "what does this change SAY it does?"
    purpose-inquisitor.md        harvester — "what does it exist FOR / silently promise?"
    correspondence-auditor.md    mandatory core — code ↔ claim correspondence
    test-correspondence-auditor.md mandatory core — red-on-violation test exists?
    chokepoint-mapper.md         conditional — unguarded paths into a mechanism
    boundary-adversary.md        conditional — input values that invert invariants
    empirical-verifier.md        conditional — verifies by EXECUTION, not reading
  skills/
    claim-guard/SKILL.md         concierge playbook; slash command /claim-guard
    claim-guard-review/SKILL.md  same gate, isolated in a subagent
    claim-harvesting/SKILL.md
    verify-against-source/SKILL.md
    adverse-state-catalog/SKILL.md
    properly-delivered-claim/SKILL.md
  hooks/
    hooks.json                   PreToolUse on Edit|Write|NotebookEdit
    scripts/guard-writes.js      denies while .claim-guard/GUARD_ACTIVE exists
  ledger/                        TypeScript source + node --test suite
    package.json                 esbuild bundle → ../dist/claim-ledger.js
    src/  test/
  dist/claim-ledger.js           committed bundle (attractor pattern)
```

## The trust anchor — `claim_ledger` MCP server

A Node/TypeScript MCP (stdio) server bundled in the plugin, built with esbuild and
committed to `dist/` exactly like attractor's engine. It exposes **one tool,
`claim_ledger`**, dispatched by an `operation` parameter — one name to reason
about, mirroring the amplifier tool.

**Ops (15 = 13 static + 2 guard):**

| Group | Ops |
|---|---|
| Concierge | `start_run`, `add_claims`, `report` |
| Primitives | `add_claim`, `list_claims`, `list_runs`, `record_verdict`, `record_lens_error`, `record_debate`, `waive`, `aggregate`, `gate`, `render_matrix` |
| Guard | `activate_guard`, `deactivate_guard` |

The three Phase-2 ops (`record_probe`, `defer_claim`, `graduate_test`) are **not**
implemented in this version; their schema fields (`probe_eligibility`, `probe`,
`standing_test`) exist in the claim record from day one.

**Ported contract semantics** (from `docs/tool-claim-ledger-contract.md` upstream —
build to that contract):

- **Worst-wins aggregation** per claim: `REFUTED > UNTESTABLE > CONFIRMED > N/A`;
  a claim with zero recorded verdicts is `PENDING`, never a pass.
- **The 5 gate limbs**, computed deterministically, never by an LLM:
  1. any claim `REFUTED` → BLOCK;
  2. any `safety` claim with `adverse_state_test.exists == false` → BLOCK
     (independent of limb 1);
  3. any `UNTESTABLE` claim with no recorded waiver → BLOCK (policy-dependent);
  4. any `PENDING` claim or recorded lens error → INDETERMINATE
     (`claim-pending:<id>` / `lens-error:<lens>@<id>`);
  5. zero claims harvested → INDETERMINATE (`zero-claims-harvested`).
  Policies: `advisory` / `blocking-with-waiver` (default) / `blocking`;
  INDETERMINATE is never downgraded by any policy.
- **Evidence enforcement:** `record_verdict` rejects CONFIRMED/REFUTED without a
  `path:line` anchor (`evidence_required`) and REFUTED without a counter-case
  (`counter_case_required`).
- **Evidence ratchet:** revising away from REFUTED requires at least one anchor
  not already present in that claim's evidence (`ratchet_violation`); the
  rejection is appended to the run's audit trail.
- **Stable claim IDs:** `clm_` + sha1(normalize(text) + "|" + type + "|" +
  source-relpath)[:8], with the upstream normalizer rules (NFKC, quote folding,
  code-span preservation, closed filler-word list; negation/modals/quantifiers/
  numbers never stripped; `-2` disambiguation on genuine collisions).
- **Write confinement:** the server writes only under
  `<repo>/.claim-guard/<run_id>/` (plus the `GUARD_ACTIVE` marker directly under
  `.claim-guard/`). Repo root = the server process cwd (Claude Code launches
  plugin MCP servers in the project directory), overridable via the
  `CLAIM_GUARD_REPO` env var.
- **Storage is private.** Callers read the ledger via `list_claims` / `report`,
  never by opening `.claim-guard/` files; the skills state this rule.
- `render_matrix` emits the 8-column markdown matrix (Claim, Type,
  Source (inferred?), Verdict, Evidence, Counter-case, Adverse-state test,
  Lens errors) followed by the coverage line
  (`harvested / verified / probed / deferred / waived` — probed/deferred read 0
  in this static-only version).
- `report` = `gate` + `render_matrix` in one call, including
  `blocking_summary` ({substantive, procedural, total_claims_blocked}) with each
  blocked claim appearing once, its limbs grouped in `reasons`.
- `list_runs` supports `stranded_only` (claims > 0 and pending > 0) for the
  close-out check.

**Guard ops:** `activate_guard` writes `.claim-guard/GUARD_ACTIVE`;
`deactivate_guard` removes it. Both idempotent.

## Write-blocking hook

`hooks/hooks.json` registers a PreToolUse hook with matcher
`Edit|Write|NotebookEdit` running `scripts/guard-writes.js` (plain Node, no deps —
delivery's hook pattern). While `GUARD_ACTIVE` exists in the project's
`.claim-guard/`, the script returns a deny decision with the message *"claim-guard
review posture active — the gate never edits the code it reviews. Finish or
abandon the run (close-out) to re-enable writes."* Otherwise it allows. Bash is
not blocked — parity with the amplifier mode, whose reach was also
`write_file`/`edit_file`; the concierge skill carries the discipline rule for the
rest. The ledger's own writes are unaffected (the MCP server writes directly, not
through Write).

## Agents — platform adaptations

Each upstream agent's prompt is ported into Claude Code agent format
(frontmatter: `name`, `description` with when-to-use, `tools`). All lenses get
Read/Grep/Glob plus the `claim_ledger` MCP tool; `empirical-verifier` also gets
Bash (it executes tests/repros; N/A when it cannot actually run anything — a
read-only opinion is not an empirical verdict). Adaptations:

- `delegate(context_depth="none")` → the Agent tool; Claude Code subagents start
  cold by default, which is exactly the required isolation.
- `foundation:explorer` neutral digest → the built-in Explore agent.
- `chokepoint-mapper` loses LSP `incomingCalls` → Grep-based caller tracing; its
  prompt states this degradation and requires it to enumerate the search patterns
  it used, so an incomplete caller map is visible rather than silent.
- Every lens prompt embeds the hard rule: record verdicts via `claim_ledger
  record_verdict` with the **literal `run_id`** pasted into its instruction; a
  missing run_id loses the verdict.

## Skills

- **`claim-guard`** (user-invocable, `/claim-guard <base>..<head>`): the concierge
  playbook — the full phase structure ported from `claim-guard-here`:
  Phase 0 `start_run` (+ `activate_guard`); Phase 1 resolve the bench (2
  harvesters + 2 mandatory core + 3 conditional with recorded
  inclusion/exclusion); Phase 2 neutral digest + cold UNIONed harvest, concierge
  owns the single `add_claims` call, Gate A human checkpoint on the claim list;
  Phase 3 cold independent fan-out via Agent, coverage check before aggregation,
  `record_lens_error` backstop; Phase 4 single `report` call, matrix printed
  verbatim, never re-weighed in prose; Phase 5 debate-to-consensus (max 3 rounds,
  verbatim relay recorded via `record_debate`, evidence ratchet, dissent
  recorded, never averaged); Phase 6 synthesis (roster manifest first, verdict as
  computed, substantive vs procedural blockers separated, every finding
  attributed to a named lens, waivers only ever for procedural blocks);
  Phase 7 close-out (`list_claims` for pending, `list_runs stranded_only`,
  `deactivate_guard`; a harvested run is a commitment to gate it).
- **`claim-guard-review`** (user-invocable): the same gate driven inside one
  isolated general-purpose subagent for a changeset this session has not seen;
  returns the matrix + verdict.
- **Discipline skills** (model-invocable, referenced by the agents/concierge):
  `claim-harvesting`, `verify-against-source`, `adverse-state-catalog`,
  `properly-delivered-claim` — ported with terminology adapted (tool names,
  Agent-tool phrasing), content otherwise faithful.

## Tests & CI

`ledger/test/` under `node --test`, mirroring the upstream test-first list:

1. worst-wins — every precedence pair; missing-lens → PENDING;
2. gate limbs — each of the 5 independently; limb-2-with-CONFIRMED; the three
   policies; both limb-4 reason shapes; `record_lens_error` never creates a
   verdict or moves an aggregate;
3. evidence enforcement — anchor-less CONFIRMED/REFUTED rejected; counter-case
   required for REFUTED;
4. evidence ratchet — no-new-anchor rejected, new-anchor accepted, rejection
   audited;
5. stable IDs — reword-stable, type-sensitive, run-independent, collision
   disambiguation;
6. write confinement — writes only under `.claim-guard/`;
7. `add_claims` batch — malformed element lands in `errors` without aborting the
   batch; blank run_id threads from first successful add;
8. guard ops + hook script — marker set/cleared; guard-writes.js denies/allows on
   marker presence.

CI: `.github/workflows/claim-guard-tests.yml`, same shape as the existing
delivery/attractor workflows (checkout, setup-node, build, `node --test`), plus
`claude plugin validate ./plugins/claim-guard` locally before commits.

## Registry & versioning

- Add the plugin to `.claude-plugin/marketplace.json` with
  `"source": "./plugins/claim-guard"`, version `0.1.0`, keywords
  (verification, adversarial-review, claims, pre-merge, gate, quality).
- Plugin manifest `plugins/claim-guard/.claude-plugin/plugin.json` at `0.1.0`.
- Bump the registry `version` (1.0.0 → 1.1.0): the plugin set changed.
- Update the root README plugins table.

## Error handling principles (carried from upstream)

- The gate never passes on doubt: incomplete → INDETERMINATE, never PASS.
- A lens error is recorded, never silently dropped; a crashed lens is
  distinguishable from a not-yet-verified claim.
- A malformed harvest element never truncates the batch silently.
- An empty claim list is a harvest failure, not a clean bill of health.
- The concierge, never a sub-agent, owns the `add_claims` write; every delegated
  lens carries the literal run_id.
