# Product brief: onboarding an existing, multi-repo product

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft (revision 2, after `reviews/brownfield-onboarding-brief-01.md`) · Last updated: 2026-10-24
> Depends on: `initiatives/feature-map/` (the inventory, held to its freshness constraint)

**Mode:** frame (a new capability; the Vault is the grounding example and future test bed) ·
**Word count:** 906 (cap 900; declared overrun: the owner's three statements are kept verbatim, 240 words; without them 666), tables excluded.

## Owner's ask

> "A feature I need you to shape is how to onboard brown field projects onto delivery plugin customer will need that to work on products and make sure the delivery plugin can handle products that spans many components and repo. How to decide when an unbrella space is needed to model the product and work progress while working on each individual parts . The example I want to use later to work on is the vault project which is not performing well as delivery and this plugin will help me manage that product"

> "Check my private repo there is a private repo https://github.com/colombod-personal/the-vault-planning that might be the right umbrella ?"

> "For question 1 yes I confirm the umbrella for both repos, the vault ai agents should be coming now from the delivery plush in but since there are special thing to this system ther should be the “bespoke” infra manager” for the vault, remember that to simplify and focus work the delivery plugin should have the handful of subagents definiton that live in the product repos (or the umbrella ? That is usually private and might be a better place) to handle the specific of the product requirements in infra security and scalability for example"

No operator record exists; defaults are labelled **default**.

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (product-owner) | yes, isolated | yes: tracker churn (B5) |
| precision (business-analyst) | yes, isolated | yes: "component" undefined (B6); a falsifiable umbrella rule |
| absence (feature-critic) | yes, isolated | yes: deploy is several shas (B8); onboarding is irreversible (B10) |

**Findings by convergence:** 3 by all three · 3 by two · 4 by one. **Not exhausted.** The
challenge panel corrected B1, B4, B5, B7 and the rule. Vault facts: full clone of
`colombod-personal/the-vault` (315 commits, root 2026-09-27); commit days in UTC.

## Problem

The plugin assumes a new product in one repo with no process of its own. Real products arrive
with history, a tracker, CI, users, plan text already public, and several components or repos.

| # | Finding | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| B1 | No way to point the plugin at a beads database it did not create: `start.js` checks for `.beads` and otherwise runs `bd init`; the Vault's beads are reached through a wrapper on the owner's server | 3 | `scripts/start.js:353-362`; `prepare-role.js:107-111`; the-vault `AGENTS.md:188-189` |
| B2 | One product repo is assumed in the manifest, checkouts, merge gate, CI and reviews | 3 | `lib/manifest.js:131`, `lib/gh-pr.js:21`, `start.js:308-333`, `prepare-role.js:61-73`, `merge-gate.js:105-114` |
| B3 | Plan text is already public: roles, delegation and host topology in the Vault's `AGENTS.md`, cited by number by its scripts and CI | 3 | the-vault `AGENTS.md:226-296`; `scripts/prepush.py`, `scripts/issue_progress.py` |
| B4 | Delivery slowed, cause unknown: 265 commits 10-03..09, 49 commits 10-10..19 (UTC). This repo is silent on the same days (10-14..17, 10-20..23), so the owner's time is as likely a cause as the Vault's process | 2 | `git log` in both repos |
| B5 | Tracking was redefined three times (10-07, 10-07, 10-11) and has held since: 16 of 22 PRs merged from 10-12 name a bead (`vault-[a-z0-9]{3}(\.[0-9]+)?` in the subject); an old issue workflow still runs | 2 | the-vault `6797eb6`, `7f5f540`, `802fe6b`; `issue-progress.yml` |
| B6 | "Component" is undefined: the conventions count manifests (6 files: `pyproject.toml`, `web/package.json`, two `plugin.json` in each of two plugins; plus registry files) while releases go through Vercel and GitHub Pages | 2 | `references/conventions.md:13`; the-vault `deploy.yml`, `guide-pages.yml` |
| B7 | A second repo is a real dependency: `mtg-toolkits`, pinned in `requirements-vcs.txt` (2 pin commits), read by 7 workflows, imported on 39 lines of `vault/`, `api/`, `jobs/` | 1 | the-vault `requirements-vcs.txt`, `.github/workflows/` |
| B8 | "Deployed" is one sha per surface; the Vault ships a site, an MCP remote and assistant plugins by separate paths, and installed plugins depend on the MCP tool contract | 1 | `docs/reference.md:344-362`; the-vault `plugins/the-vault/.mcp.json`, `server.json` |
| B9 | Surfaces are declared per initiative; the Vault's surfaces are product-wide | 1 | `scripts/lib/surface.js:13` |
| B10 | Onboarding cannot be undone: nothing restores an in-repo process or exports beads and decisions back | 1 | absence |
| B11 | No slot for a product's own agents: role sessions get the plugin's reviewer agents only; a product's infra, security or scalability specialists have nowhere to live (the Vault has an Infra Manager role the plugin lacks) | owner | `scripts/prepare-role.js`; the-vault `AGENTS.md:267`; trial in `the-vault-planning` (G9) |

The plugin was extracted from the Vault's own practice (`.superpowers/specs/2026-10-12-shipping-team-design.md:40`,
"The Vault is not migrated as part of this work"). Onboarding recovers what was already built.

## Who has it

One **operator**, the owner, running a live product across components and repos with users on
surfaces they do not control. Reach beyond this one operator is unknown; later phases must not
generalise from n=1.

## Cost of the status quo

- The plugin's gates, daily plan and watchdog exist but do not run on the product they came from.
- CI minutes the owner pays: 5 of 7 parallel branches failed CI on 10-07 (the-vault `AGENTS.md:77-80`).
- The plan sits in a public repo (B3); cross-repo reach (B7, B8) is invisible to planning.

## What changes if we solve it

One read-only run inventories an existing product (through the feature map), names whether it
needs an umbrella space and why, and connects the plugin to what exists (tracker, CI, surfaces,
work in flight) without writing to any of it until the owner records each step.

## Umbrella rule (revision 2)

**Umbrella** (one project repo planning several components, each area declared against
components) when any criterion holds **with evidence observable before onboarding**:

| Criterion | Observable before onboarding as |
| :-- | :-- |
| (a) work crosses components | past changes touching 2+ components in one change window (commits or PRs within a day) |
| (b) the team changes a dependency it owns | pin-bump commits on a repo the team owns, **together with** (a); a pin alone is a dependency, not an umbrella |
| (c) components share a customer surface or contract | two deploy paths behind one host, or a tool or API schema consumed by an installed client |
| (d) releasing one forces releasing another | co-release history; shared registry entries (`marketplace.json`) excluded |

No evidence for a criterion reads **unknown**, never "no". The dry run shows which criteria fired
and the owner can override. **Falsified** if, over 3 sprints (**default**), an umbrella sees no
cross-component bead or PR, or a per-component setup sees a forced co-release.

## Success signals

| Signal | How measured | Current (Vault) | Target |
| :-- | :-- | :-- | :-- |
| Delivery | beads closed with evidence per week | to measure at onboarding | rising over 4 weeks |
| One tracker | PRs merged after onboarding naming a bead, pattern above | 16 of 22 since 10-12 | all |
| Cross-repo reach seen | `mtg-toolkits` pin bumps linked to the Vault work they enable | 0 of 2 | all |
| Stalls caught | claimed beads idle 3+ days flagged by the watchdog the same day | not measured | all |
| Nothing regressed | day-one invariants (MVP 4) hold on the first merge after onboarding | n/a | all hold |
| Verdict holds | umbrella verdict against the falsification test after 3 sprints | n/a | not falsified |

## MVP boundary

**Release 1 (answers "when an umbrella" and avoids a second tracker):**
1. `start.js --adopt --dry-run`: inventory (components, repos, workflows, surfaces, contracts,
   tracker, in-repo process) with the umbrella verdict per criterion and its evidence. Writes nothing.
2. Point at an existing beads endpoint: check its prefix, never `bd init` over it, no schema
   change; list live claims and worktrees as a drain list the owner signs.
3. Classify existing beads (adopt into a story, leave, close with a note), signed by the owner.
4. Do-not-write list (deploy, hosting, pins, the tracker's schema, public issues) and day-one
   invariants (prepush passes, tests and deploy green, `bd ready` unchanged, site up).
5. Rollback: a tagged snapshot of in-repo rules and a beads export, revert tested on a clone;
   owner decisions already made in prose ratified once as operator records.
6. Bespoke agents: a handful (default at most 5) of product-specific agent definitions in the
   project repo's `.delivery/agents/`, each naming its area (infra, security, scalability) and
   the gate or role that calls it; `prepare-role` installs them into every role session; each
   cites the product files it was written from, so a stale one is detectable.

**Release 2, gated on the verdict:** several components in one team, or several teams under one
umbrella briefing (open question 2); per-component and whole-product progress.

## Explicitly out of scope

- Moving plan text out of a public repo: its own initiative (it must list inbound references
  first; it stops publishing, it does not erase git history).
- Migrating the Vault itself (a later initiative using this one); secrets and production data.

## Current-state workflow

The owner runs the Vault from its public `AGENTS.md`, sessions on three hosts, beads on a home
server; the plugin sits unused beside it.

## Open questions

| # | Question | Owner | Blocks | Default |
| :-- | :-- | :-- | :-- | :-- |
| 1 | ~~Is `mtg-toolkits` work on the Vault's board?~~ **Answered 2026-10-24:** umbrella confirmed for both repos | operator | criterion (b) | answered |
| 2 | One team across the components, or one team per component under one briefing? | operator | release 2 | decided by the release 1 verdict |
| 3 | ~~Use `the-vault-planning` as the umbrella?~~ **Answered:** the owner allowed it for this experiment; it now holds the scaffold, inventory and the bespoke Infra Manager | operator | release 1 setup | answered |
| 7 | Bespoke agents in the private umbrella repo or the product repo? | operator | MVP 6 | the umbrella (private; the agents encode hosts and data stores) |
| 4 | What hurts most: broken things reaching users, work stopping unnoticed, or your time steering sessions? | operator | signal priority | work stopping |
| 5 | Does the Vault team keep working during onboarding? | operator | drain list | yes, read-only adopt |
| 6 | If it is not helping after a month, what must you get back? | operator | rollback | in-repo rules and beads |
