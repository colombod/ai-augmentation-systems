# claim-guard

A Claude Code plugin that runs an **adversarial claim-verification gate** over a changeset before
you merge it — a port of the static gate from
[amplifier-bundle-claim-guard](https://github.com/colombod/amplifier-bundle-claim-guard).

For every claim a change makes — commit messages, docstrings, spec and design docs, and the
*implicit* promises of its purpose — claim-guard locates the load-bearing code and tries to
**prove that claim FALSE against the actual shipped source**. It emits an auditable
**claim-verification matrix** and a deterministic **BLOCK / PASS / INDETERMINATE** verdict.

The operating question flips from *"does it work?"* to ***"how is this claim false?"*** The
commit message is a **hypothesis to disprove**, not a fact.

## Install

```
/plugin install claim-guard@ai-augmentation-systems
```

The plugin bundles everything it needs: the lens agents, the skills, the write-blocking hook, and
the `claim_ledger` MCP server (`dist/claim-ledger.js`, committed — no build step at install time).

Add `.claim-guard/` to the consuming repo's `.gitignore` — it holds per-run ledgers, which are
working state, not source.

## What ships

| Capability | What it is |
|---|---|
| **7 lens agents** | the adversarial bench — two harvesters, two mandatory core auditors, three conditional lenses (see [The bench](#the-bench)) |
| **`claim_ledger` MCP tool** (15 ops) | the trust anchor — deterministic worst-wins aggregation, `file:line` evidence enforcement, the evidence ratchet, and the gate rule |
| **`/claim-guard:claim-guard`** | the concierge playbook — runs the whole gate in the current session |
| **`/claim-guard:claim-guard-review`** | the same gate in an isolated forked session, for a changeset the current session has not seen |
| **Write-blocking hook** | while a run holds the review posture, Edit/Write/NotebookEdit are denied — the gate never edits the code it reviews |
| **4 discipline skills** | claim-harvesting, verify-against-source, adverse-state-catalog, properly-delivered-claim |

## Usage

**The agent path — just ask, in any session with the plugin enabled:**

> *"Review this changeset before I merge — is it safe to ship? Gate `git diff main...HEAD`. Here
> are the commit messages and the linked design doc. Harvest explicit + implicit claims, fan the
> lenses out cold, and give me the matrix plus the BLOCK/PASS verdict with `file:line` evidence.
> Do not edit any code."*

The model loads the `claim-guard` concierge skill itself and drives the bench.

**The human path — the slash commands:**

```text
/claim-guard:claim-guard <BASE>..<HEAD>          # inline, in this session
/claim-guard:claim-guard-review <BASE>..<HEAD>   # isolated forked session
```

## How to read the output

A run produces a **claim-verification matrix** (one row per claim) and a **gate verdict** — both
computed by the `claim_ledger` tool: deterministic arithmetic over the ledger, never an LLM
judgement.

| Verdict | Meaning |
|---|---|
| **BLOCK** | at least one gate limb fired — do not merge |
| **INDETERMINATE** | the run is **incomplete or broken**, so no pass can be claimed |
| **PASS** | every claim verified, no limb fired |

**The gate never passes on doubt.** The limbs:

1. any claim aggregates to **REFUTED** → BLOCK (substantive — the claim is false);
2. any **safety** claim has **no adverse-state test that fails on violation** → BLOCK, independent
   of limb 1 (a CONFIRMED safety claim with no adverse-state test still blocks);
3. any claim aggregates to **UNTESTABLE** with no recorded human waiver → BLOCK (procedural);
4. any claim is **PENDING** (never ruled on), or any lens recorded an error → **INDETERMINATE**;
5. **zero claims harvested** → **INDETERMINATE** — an empty claim list is a harvest failure, not a
   clean bill of health.

Aggregation across lenses for one claim is **worst-wins**:
`REFUTED > UNTESTABLE > CONFIRMED > N/A`. A claim with no recorded verdict is `PENDING` — never a
pass. `gate_policy` modulates limbs 1–3 only (`advisory` | `blocking-with-waiver` (default) |
`blocking`); INDETERMINATE is never downgraded by any policy.

## The bench

**Harvesters** (cold, independent, UNIONed — inference can only *add* claims, never remove one)
- **`claim-harvester`** — *"What does this change explicitly say it does?"*
- **`purpose-inquisitor`** — *"What does this change exist FOR, and what does that silently promise?"*

**Mandatory core** (runs on every claim)
- **`correspondence-auditor`** — *"Does the load-bearing code actually do what the claim says — and where is the line that proves it?"*
- **`test-correspondence-auditor`** — *"Is there a test that goes RED when this property is violated, in the adverse state?"*

**Conditional lenses** (triggered by claim type / changeset shape; exclusion recorded with a reason)
- **`chokepoint-mapper`** — *"Which paths into this mechanism are NOT guarded?"* (the "one branch over" catcher)
- **`boundary-adversary`** — *"What input value inverts this invariant?"*
- **`empirical-verifier`** — *"Stop reading — what happens when I actually RUN it?"* The bench's
  only lens that executes; its verdicts carry the exact command and observed output. It runs only
  in safe, disposable environments it fully controls — never against anything real.

Orchestration is council-shaped: the concierge fans the bench out cold, runs a
debate-to-consensus loop (verbatim relay, no curation, evidence ratchet), and synthesizes with
recorded dissent. Harvesters *return* claims; the concierge owns the single `add_claims` write —
so a harvest can never strand itself on a forked run.

## The review posture

`/claim-guard` activates a write block at run start (`claim_ledger activate_guard`): a PreToolUse
hook denies **Edit/Write/NotebookEdit** while `.claim-guard/GUARD_ACTIVE` exists, and close-out
clears it. Bash is not blocked — shell discipline is carried by the skill, same scope as the
upstream mode (which blocked `write_file`/`edit_file`). The hook fails open: if it breaks, editing
still works.

## Storage is private to the tool

Runs live in `.claim-guard/<run_id>/ledger.json`. **Never read or edit those files directly** —
inspect the ledger only via `claim_ledger list_claims` / `report`. Every interaction goes through
the tool; that is what makes a run's evidence enforcement, worst-wins aggregation, and ratchet
un-fudgeable.

## Differences from the upstream amplifier bundle

- **Static gate only.** Phase-2 dynamic pen-testing (probe-designer, pen-tester,
  regression-graduator, the Digital Twin Universe) is not ported; the ledger schema keeps the
  Phase-2 fields so it can land later without a migration. A safety claim missing its
  adverse-state test is remediated by writing the test after the run, or by a recorded waiver.
- **No recipes.** The concierge skill drives all phases inline — upstream already treats the
  concierge path as canonical.
- **Chokepoint enumeration is Grep-based** (no LSP `incomingCalls`); the lens records the search
  patterns it used so an incomplete caller map is visible rather than silent.
- **The ledger is a bundled Node MCP server** instead of a Python amplifier module; the contract
  (ops, gate limbs, ratchet, stable claim ids, write confinement) is ported faithfully and pinned
  by `ledger/test/`.

## Repository layout

```
plugins/claim-guard/
├── .claude-plugin/plugin.json     manifest
├── .mcp.json                      claim-ledger MCP server declaration
├── agents/                        the 7-lens bench
├── skills/
│   ├── claim-guard/               the concierge playbook (inline gate)
│   ├── claim-guard-review/        isolated forked gate
│   ├── claim-harvesting/          the claim contract (grid + rigid template)
│   ├── verify-against-source/     evidence-or-it-didn't-happen discipline
│   ├── adverse-state-catalog/     the six adverse-state categories
│   └── properly-delivered-claim/  the three-part "done" for a safety claim
├── hooks/                         PreToolUse write block (guard-writes.js)
├── ledger/                        TypeScript source + node --test suite
└── dist/claim-ledger.js           committed server bundle
```

## License

MIT — see the repository [LICENSE](../../LICENSE).
