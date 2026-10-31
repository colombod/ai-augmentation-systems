---
id: plan-sync-01
title: Keep the planning repository true to what shipped, enforced at every merge
status: done
epic: plan-sync
supersedes: []
superseded_by: []
superseded_reason:
phase: MVP
requirements: []
depends_on: []
size: M
---

# Keep the planning repository true to what shipped, enforced at every merge

## Owner's ask

> "Delivery plugin must ensure the planning repo is up to date ! That is a must not a nice to have
> feature is a crucial core part of the products value proposition! Letting such repo and feature map
> diverge defeats completely the entire product" (2026-10-31)

## Context

On the first real team (the Vault), the planning repository's origin stopped at day one (10-25): no
roadmap, no stories, no feature map, while the product kept shipping. The plugin published review rows
and records, but nothing tied story status, the feature map or plan documents to merges, and nothing
refused when they fell behind.

## Acceptance criteria

1. `plan-sync.js check` reports a story whose file status is behind its bead, a feature map older than the
   last recorded merge, and plan files uncommitted or unpushed in the project root; exit 1 when any.
2. `plan-sync.js apply` advances story statuses (never backwards; a reopened done story is reported),
   rebuilds `.delivery/feature-map.json` and `.md` from the product's default branch (what ships, what
   each open story reaches, what each merge added and removed), and commits and pushes the plan.
3. `merge-gate.js merged` runs apply itself, without cloning; `merge-gate.js check` and the lane refuse
   the next merge while check reports drift, naming `plan-sync.js apply`.
4. The Delivery Manager and Product Manager are told at session start when the plan is behind.

## Verification

`node --test scripts/plan-sync.test.js` (8 tests, including the lane refusing a real merge and the merge
updating the plan), 17 mutations all killed; full suite green. Run on a copy of the Vault plan against
the public product: 93 features mapped from a fresh clone in 4.6 s.
