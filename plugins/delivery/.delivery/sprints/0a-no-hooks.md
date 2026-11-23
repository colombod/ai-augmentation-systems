# Sprint 0a: the plugin ships no hooks

Declared 2026-11-23, before work starts. Closed round: nothing is added to the
deliverables below once the sprint starts; anything new is queued for 0b or
later. Source: [PLAN.md](../direction/PLAN.md) Sprint 0, split in two after
sizing. 0b (retire the standing-team runtime) is a separate sprint, with its
own declaration and the owner's approval of its file list.

Customer: the person who installs the plugin and expects their own Claude
sessions to be left alone.

## Deliverables

| ID | Done when |
| --- | --- |
| D0.2a | `hooks/hooks.json` registers no hooks. |
| D0.2b | No script calls the user-level guard installer: the watchdog does not call `ensureUserGuard`, and `scripts/setup-guard.js install` is removed. No code path in the files this sprint touches writes under `~/.claude` outside the plugin's own directory. |
| D0.2c | The delivery test suite passes sealed (`node plugins/delivery/scripts/testing/run-tests.js`) and CI is green. Every test removed or changed is listed in the PR with the behaviour it asserted and why it no longer applies. |
| D0.2d | `map.js` still runs and still lists the plugin's features; the scripts that read `hooks.json` (`scripts/lib/features.js`, `hooks/scripts/record-invocation.js`) work with an empty list. |
| D0.2e | `plugin.json` and the one marketplace entry carry the same new version, bumped as a single value edit. |

## Bounds (owner may change before the sprint starts)

- Time: 4 hours of working time. At the bound, stop and report what is done.
- Review rounds: 2. One independent review of the diff, then one fix round.
- Attention: at most 2 decision requests to the owner.
- Spend: the owner set no cap. No hard cap is available in an interactive
  session, so the sprint uses at most 3 subagents and nothing above the middle tier unless
  a lower-tier attempt fails, with the reason recorded.

## Model tiers

| Work | Tier and reason |
| --- | --- |
| Implementation | Sonnet, the middle tier. Focused edits with tests; no hard design. Move up only if an attempt fails, and record why. |
| Independent review | Sonnet. One review per changed diff; a higher tier only if the review fails or finds a security-sensitive flaw. |

## Necessity

No infrastructure is added. This sprint removes registrations and call sites.

## Out of scope

Deleting runtime code (watchdog, host manager, self-update, revive, lane, leak,
send and setup guards, operator ceremony); the README; AGENTS.md; any change to
a planning skill; the beads data.

Known: the Claude Code version on the owner's machine is 2.1.330, and
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is not set, so a tier chosen above is not
overridden there.

Note: the first version of this declaration named Opus for both. That followed a default in the owner's settings, not the model-selection policy in [Spend and idle](../direction/contracts/spend-and-idle.md) 6. It was corrected before any work was done.

## Queued for the next sprint (from the independent review)

Found after the sprint started, so not done here (closed round).

- Stale statements that still say the hooks run: `skills/decision/SKILL.md`
  (lines 21, 25, 77), `skills/team/SKILL.md` (29), `docs/quickstart.md`
  (312, 476), `docs/reference.md` (several, for example 358-373 and 2107-2122),
  `README.md` (201) and the role briefs. Sprint 1 rewrites the README; the rest
  goes with Sprint 0b.
- A user who sets `DELIVERY_LEDGER=1` now sees "OBSERVER DOWN" from the
  `status` skill, because no hook writes the ledger line. Users without it see
  no change: the skill already reports "Untraceable" when no invocation
  directory exists.
- `hooks/scripts/setup.js` still refuses, before a tool runs, removing a
  leftover user-level guard from `~/.claude`, while `setup-net.js` no longer puts
  it back after the tool. Harmless once no host has the old guard; retire both
  in 0b.
- `hooks/scripts/setup-guard.js`, `setup-net.js` and the lane, leak, bd, ask and
  send guards are now unregistered dead code.
- The second test in `hooks-none.test.js` checks only for the deleted
  installer's name, so a new writer under another name would pass it. A test
  that scans for any write of a hook entry into a user-level settings file would
  guard the real promise.

