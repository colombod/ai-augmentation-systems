---
id: brownfield-onboarding-01
title: Install a product's own experts into every role session
status: done
epic: brownfield-onboarding
phase: release 1
requirements: [MVP-6]
depends_on: []
size: S
surface: S1
area: team
wave: 1
reuses: [scripts/prepare-role.js, roles/staffing.md]
---

# Install a product's own experts into every role session

## Owner's ask

> "the delivery plugin should have the handful of subagents definiton that live in the product repos (or the umbrella ? That is usually private and might be a better place) to handle the specific of the product requirements in infra security and scalability"

> "I think [the] delivery plugin hiring manager is to analyse the project and decide what experts are needed and help 'building them'" · "All this must be performed by the delivery plugin !"

(2026-10-24, in conversation; no team session ran, so there is no operator record yet.)

## Goal

Experts Staffing writes to the project repo's `.delivery/team/experts/` are subagents every role
session can call, kept in step when an expert changes or is retired.

## Customer surface

S1: a role session (Claude Code) started in a role directory prepared by `prepare-role.js`.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `scripts/lib/experts.js` | create: read, check and install experts; track what was installed |
| `scripts/prepare-role.js` | modify: install experts after the brief; print removals and warnings |
| `scripts/experts.test.js` | add tests (child-process runs of `prepare-role.js`) |
| `roles/staffing.md` | modify: lane writes `experts/**`; how to hire and build an expert |
| `docs/reference.md`, `README.md` | modify: document experts |

## Acceptance criteria

1. The operator prepares a role for a project with an expert, starts the session, and the session lists the expert as a subagent it can call.
   - Probe: `claude -p` in the role directory asked for its project subagents; where: S1; by: test (scripted) and run once for real
2. An expert removed from the project is gone from the role after the next prepare, and the removal is printed; an agent the user wrote stays.
   - Probe: `experts.test.js` test 3; where: S1; by: test
3. An agent the user wrote under an expert's name is never overwritten, and the conflict is printed.
   - Probe: test 5; by: test
4. A malformed expert is printed with its reason and not installed; good ones beside it are.
   - Probe: test 6; by: test
5. More than five experts is said, and all are installed; five is not said.
   - Probe: test 7; by: test

## Implementation notes

- Evidence: 7 new tests pass; the full delivery suite passes (939). Each behaviour was broken on
  purpose (10 mutations: no install, no retire, overwrite, no name, no description, no handful
  warning, `>=` for `>`, no sidecar, no-name check, CLI hiding removals); each turned the test that
  owns it red, and the restored code is byte-identical.
- Run for real: `prepare-role.js` on `colombod-personal/the-vault-planning` (two experts) installed
  `infra-manager.md` and `security-reviewer.md` byte-identical into `builder-1/.claude/agents/`; a
  headless `claude -p` started there answered `infra-manager`, `security-reviewer`.
- The test fixture turns off git's background maintenance (`maintenance.auto`, `gc.auto`): a race
  between it and a local clone failed `prepare-role.test.js` once in CI on PR #62.
- Not in this story: Staffing's analysis that proposes experts from the inventory, and flagging an
  expert stale when a cited file changes (both need the feature map).
