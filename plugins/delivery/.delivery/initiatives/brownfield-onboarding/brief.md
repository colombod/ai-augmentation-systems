# Product brief: onboarding an existing, multi-repo product

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-10-24 · Depends on: `initiatives/feature-map/` (the inventory)

**Mode:** frame (a new capability; the Vault is the grounding example and future test bed) ·
**Word count:** 644 (cap 900, tables excluded, `grep -v '^|' | wc -w`).

## Owner's ask

> "A feature I need you to shape is how to onboard brown field projects onto delivery plugin customer will need that to work on products and make sure the delivery plugin can handle products that spans many components and repo. How to decide when an unbrella space is needed to model the product and work progress while working on each individual parts . The example I want to use later to work on is the vault project which is not performing well as delivery and this plugin will help me manage that product"

No operator record exists; defaults are labelled **default**.

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (product-owner) | yes, isolated | yes: the Vault's throughput collapse and tracker churn (B4, B5) |
| precision (business-analyst) | yes, isolated | yes: "component" undefined; manifest count is not release count (B6); falsifiable umbrella rule |
| absence (feature-critic) | yes, isolated | yes: a second empty tracker on day one (B1); deploy is several shas (B8); onboarding is irreversible (B10) |

**Findings by convergence:** 3 by all three · 3 by two · 4 by one. **Not exhausted.**
Vault facts read from a full clone of `colombod-personal/the-vault` (315 commits, root
2026-09-27); plugin facts from `plugins/delivery` at `main` (v0.30.0).

## Problem

The plugin assumes a new product in one repo with no process of its own. Real products arrive
with history, a tracker, CI, users, plan text already public, and several repos.

| # | Finding | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| B1 | Onboarding starts a second, empty tracker: `start.js` runs `bd init` when `.beads` is absent; the Vault's beads live on a shared Dolt server; nothing adopts them | 3 | `scripts/start.js:353-362`; the-vault `AGENTS.md:97-117` |
| B2 | One product repo, everywhere: `product_github` is one owner/name; one checkout; the merge gate refuses any other repo; CI and reviews read one repo | 3 | `lib/manifest.js:131`, `lib/gh-pr.js:21`, `start.js:308-333`, `prepare-role.js:61-73`, `merge-gate.js:105-114` |
| B3 | The plan is already public: the Vault's `AGENTS.md` (319 lines) holds roles, the Chief of Staff's delegation and host topology; its CI enforces that process; the leak guard has no rule for content that predates it | 3 | the-vault `AGENTS.md:226-296`; `.github/workflows/issue-progress.yml`; `hooks/scripts/leak.js` |
| B4 | Delivery stalled: 265 commits 10-03..09 (~38/day), 47 commits 10-10..19 (~5/day), none 10-14..16 or since 10-20 | 2 | `git log` (commit dates) |
| B5 | Tracking redefined three times in five days (issues as board, repo as backlog, beads only); 17 of 263 merged PRs name a bead; the old issue workflow still runs | 2 | the-vault `6797eb6`, `7f5f540`, `802fe6b`; `issue-progress.yml` |
| B6 | "Component" is undefined: the conventions count manifests (the Vault has 5) but the Vault deploys one Vercel project | 2 | `references/conventions.md:13`; the-vault `deploy.yml` |
| B7 | A second repo is a real dependency: `mtg-toolkits` pinned in `requirements-vcs.txt`, read by three workflows; a change there is two PRs in order, which the plan cannot link | 1 | the-vault `requirements-vcs.txt`, `tests.yml`, `deploy.yml` |
| B8 | "Deployed" is one sha per surface; the Vault ships a site, an MCP remote and assistant plugins from separate paths | 1 | `docs/reference.md:344-362` |
| B9 | Surfaces are per initiative; the Vault's six surfaces are product-wide | 1 | `scripts/lib/surface.js:13` |
| B10 | Onboarding cannot be undone: nothing restores an in-repo process or exports beads and decisions back | 1 | absence; `docs/quickstart.md:347` covers only the watchdog |

The plugin's own design was extracted from the Vault (`.superpowers/specs/2026-10-12-shipping-team-design.md:7`,
"The Vault is not migrated as part of this work"). Onboarding is mostly recovering what was
already built, not inventing it.

## Who has it

An **operator** running a live product across several components and repos, with users on
surfaces they do not control. Evidence for one: the Vault's owner. Others: unknown.

## Cost of the status quo

- Delivery near standstill (B4) while gates, daily plan and watchdog exist, unused, in the plugin.
- CI minutes the owner pays: 5 of 7 parallel branches failed CI on 10-07 (the-vault `AGENTS.md:77-80`).
- Progress split across issues, beads and commit text (B5); the plan exposed in a public repo (B3).

## What changes if we solve it

An existing product moves onto the plugin in one guided run that takes inventory first (the
feature map), adopts what exists (tracker, CI, surfaces, work in flight), moves plan content
private, and decides, by a stated rule, whether the product needs an umbrella space over its
parts, with progress visible per part and for the whole.

## Umbrella rule (proposed, falsifiable)

**Umbrella** (one project repo planning N components, areas mapped to components) when any holds:
(a) one story or wave touches 2+ component repos; (b) the team changes a pinned cross-repo
dependency; (c) 2+ deploy units share a customer surface; (d) releasing one forces releasing another.
Otherwise one project per component. **Falsified** if, over N sprints, no bead or PR crosses components.

| Product | (a) | (b) | (c) | (d) | Result |
| :-- | :-- | :-- | :-- | :-- | :-- |
| the Vault | if toolkit work counts | yes (`mtg-toolkits` pin) | yes (site and MCP remote behind mtgvault.cards) | unknown | umbrella |
| ai-augmentation-systems | no | no | no | only `marketplace.json` | one project per plugin (today's shape) |

## Success signals

| Signal | How measured | Current (Vault) | Target |
| :-- | :-- | :-- | :-- |
| One tracker | merged PRs naming a bead | 17 of 263 | all, after onboarding |
| Plan private | team, role and host lines in the public `AGENTS.md` | ~120 of 319 | 0 |
| No silent stalls | gaps of 3+ days with no commit while work is open | 2 | 0, or flagged by the watchdog the same day |
| First-push CI | Actions runs passing first time | 2 of 7 on 10-07 | measured weekly, rising |
| Cross-repo reach seen | `mtg-toolkits` changes linked to Vault stories | 0 | every pin bump |
| Onboarding time | one guided run to a first briefing | not possible | one session |

## MVP boundary

1. `start.js --adopt`: dry-run inventory (repos, components, manifests, workflows, surfaces,
   tracker, in-repo process) with the umbrella verdict and its reasons; nothing written.
2. Adopt an existing beads database instead of `bd init`.
3. N component repos in `team.json`, with builders' worktrees, merge gate and CI per repo.
4. A plan-content migration report for the public repo (what moves private, what stays), applied only on an owner record.
5. Areas mapped to components; one umbrella briefing plus per-component progress.

## Explicitly out of scope

- Migrating the Vault itself (a later initiative using this one).
- Secrets and production data migration (named as owner-queue steps, not automated).
- Repos the team does not own beyond read and pin bumps.

## Current-state workflow

The owner runs the Vault's own rules from its public `AGENTS.md`, sessions on three hosts, beads
on a home server, issues still updated by an old workflow; the plugin sits unused beside it.

## Open questions

| # | Question | Owner | Blocks | Default |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Is `mtg-toolkits` part of the Vault, on the same board, or a dependency you only bump? | operator | umbrella (a) | part of it |
| 2 | Which hurts most today: broken things reaching users, work stopping unnoticed, or your time steering sessions? | operator | signal priority | work stopping |
| 3 | Should the team rules leave the public repo for `the-vault-planning`? It is private and has no commits yet (GitHub API: 409 "Git Repository is empty", 0 branches, checked 2026-10-24), so it can become the umbrella project repo with nothing to migrate out of it | operator | MVP 4 | `the-vault-planning` is the umbrella project repo; team rules move there |
| 4 | Does the Vault team keep working during onboarding, or pause? | operator | adoption path | keeps working |
| 5 | If it is not helping after a month, what must you get back? | operator | B10 | the in-repo rules and the beads |
| 6 | Where is the R-01..R-45 list the plugin cites, as a baseline? | operator | signals | none |
