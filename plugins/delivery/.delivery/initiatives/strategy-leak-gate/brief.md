# Product brief: strategy leak gate

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft  ·  Last updated: 2026-10-31

**Mode:** frame (a new capability; the existing leak guard is the status quo) · **Word count:** 760 (cap 900)

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (`delivery:product-owner`) | yes | no: the self-collision of bead ids with the denylist; the Co-Authored-By trailer |
| precision (`delivery:business-analyst`) | yes | no: public-by-design allowlist; heading phrases hitting ordinary prose; calibration numbers |
| absence (`delivery:feature-critic`) | yes | no: the Delivery Manager's GitHub writes; the feature register's path; no after-leak procedure |

**Findings by convergence:** 5 found by 3 lenses · 4 by 2 · 7 by one only. Each lens found material the others missed: the space is **not exhausted**.

## Owner lens and what must survive

**Lens:** you value a public product repository that carries no trace of the private plan, strategy or IP, because the plugin exists to help people and organisations ship to customers without giving their direction away, while keeping the promise to what the plugin can really do · confirmed in part: "nothing of the plan, strategy or private intellectual property ... is leaked in the pr, commits, comments or decision or issues on the public facing product repository" and "Be reasonable in the design do not get blocked by making strong promises you will fail or struggle to meet".

**What must survive:**
- Nothing known to be from the private plan reaches public text the team writes (owner, quoted above).
- No promise the plugin cannot keep: paraphrase is not claimed (owner, quoted above).
- The owner never runs the scan by hand (owner preference 2, `AGENTS.md`).
- Fail closed in the product worktree, as today (assumed; `hooks/scripts/leak-guard.js:3-4`).

**Proposition:** a team shipping from a private plan can rely on delivery to refuse any public text or file change that carries known plan material, and to tell the owner before merge when something gets past.

| Gate | Result | Reason |
| :-- | :-- | :-- |
| correctness | unknown | false-positive rate unmeasured (Open question 3) |
| safety | pass | a gate that refuses; it never deletes or rewrites history |
| accessibility | n.a. | command-line and hook output |
| feasibility | pass | text matching inside existing hooks, and CI on the product remote |

## Problem

Today the leak guard checks commit, PR, release and issue text written from the product worktree against `denylist.txt` (`docs/reference.md:168-175`, `hooks/scripts/leak.js:644-681`). Five gaps leave plan material a path to the public repository:

1. **The diff is never scanned.** Writes into `product/` are checked by path only (`leak.js:680-690`). A story's wording copied into a code comment, README, CHANGELOG or test name passes. [3 lenses]
2. **The denylist knows headings, not the plan.** It holds the initiative, personas, phases, story titles, spike questions and brief and PRD headings, two words or more (`scripts/lib/plan-graph.js:188-207`). Decisions, research, PRD prose, pricing and customer names are absent. Matching is exact: "Secret-Launch-Plan" passes a "secret launch plan" entry. [3]
3. **The plugin publishes its own internal ids.** Every PR must say `Refs <bead id>` (`scripts/review.js:142`), and builder branches are `team/<instance>`. A spike id containing the initiative slug is refused by the plugin's own guard (verified with `scanText`). [3]
4. **The Delivery Manager is unguarded.** Commands outside the product worktree are skipped (`leak.js:660`), so its `gh pr comment` and `gh pr merge --subject` pass unscanned, and a squash subject is permanent history. [1, probed]
5. **The remote backstop is an example, and covers commit messages only** (`docs/reference.md:182-198`). Nothing is installed, and nothing reports a leak found later. [3]

## Who has it

- A solo builder shipping an open-source product from a private plan.
- An organisation with a public repository and private strategy.

Both run a delivery team whose planning repository is private and whose product repository is public.

## Cost of the status quo

A leak in history is permanent: forks and caches keep it, so deletion doesn't recall it. The roadmap, unannounced features, customer names and owner decisions become readable by competitors. The workaround today is trusting each session to remember, which the plugin's own required lines already break.

## What changes if we solve it

Public text and diffs carrying known plan material are refused before they leave, with the matched phrase and its private source named privately. The product remote rejects what slipped through before merge, and the owner hears about it once, with what to do.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Planted canaries blocked on every guarded channel | test suite: one canary per channel (commit, PR, comment, merge subject, release, MCP, diff line, branch) | 4 of 8 channels | 8 of 8 |
| Verbatim plan passages caught in a diff | replay: passages copied from `.delivery/` into product files | 0% | 95% of 8-word passages |
| False positives on real history | replay of this repository's public commit and PR text | unmeasured | set by spike (Open question 3) |

## Out of scope

- Paraphrase and meaning detection; promised as not caught.
- A determined session with unrestricted shell; already stated (`docs/reference.md:177-179`).
- Rewriting public history; the gate documents the steps, the owner decides.
- Access control on the private repository.

## Open questions

1. **Bead ids in public text (owner).** Recommended: replace `Refs <bead>` with a neutral token whose mapping stays private; the review binding moves to the private review record.
2. **Text meant to be public (owner).** Recommended: an allowlist file in the private repo for public names (product name, public customers), reviewed by the Product Manager.
3. **Shingle length and false-positive budget (Product Owner, spike).** Replay this repository's history against 4- to 8-word shingles before the PRD sets numbers.
4. **Feature register location (Solution Architect).** `.delivery/features.json` in the product repo is a guarded path (`scripts/lib/features.js:10`); move it to the private repo and pass it to `map.js`.
