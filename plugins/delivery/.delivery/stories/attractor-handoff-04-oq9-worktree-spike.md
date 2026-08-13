<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

---
id: attractor-handoff-04
title: "Spike — doctor + fresh-worktree dry run (OQ-9)"
status: draft
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: []
depends_on: []
size: S
---

# Spike — doctor + fresh-worktree dry run (OQ-9)

> This file is the complete context. Someone opening only this file — a teammate who
> missed the planning, or an agent with no memory of it — must be able to finish the work.

## Goal

A real, observed, written answer to `OQ-9`: when the environment can't grant `attractor`'s
unattended run the worktree-creation right or the tool permissions it needs, does
`attractor doctor` catch that before `run` attempts anything, or does the failure surface
later, mid-run, with a confusing error? No production code ships. The deliverable is
evidence — recorded verbatim — that finalizes how much `S-5`'s Runner availability check
actually covers, and how much is still open.

**Word budget note:** this story runs to ~1300 words, over the 700-word target, because it
carries real preliminary findings (below) that the implementer needs verbatim to avoid
re-deriving them — cutting them would just move the re-deriving cost onto whoever picks
this up, exactly what the writing standard's own protected categories (findings, citations)
exist to prevent.

## Context

`prd.md`'s `S-5` ("Attractor not installed — the Runner availability check") covers only
presence: is the plugin installed (`FR-13`/`FR-14`). `S-1`'s error/edge-path table has a
distinct, uncovered row: *"Permission denied (attractor installed but the environment can't
grant it the tools/worktree rights it needs) — Not covered by `FR-13`'s install check; open
question, `OQ-9`."* The glossary's **Runner availability check** entry is explicit that this
is "distinct from `Handoff readiness check`, which verifies the package's content, not the
runner's presence" — and this spike is one layer past even that: `attractor` **is** present
and passes `doctor`; the question is whether the *environment* can give it what an
unattended run additionally needs once it starts working.

`architecture.md`'s Setup table lists `attractor doctor passes` as a Setup item (per
`ADR-008` — Setup is a gating prerequisite, never an `FR-n` or a roadmap phase) that only
"**partially** closes `OQ-9`" — this spike is what determines exactly how partial. Its own
Spikes-table row 3 states the question verbatim: *"does a missing worktree/permission right
fail cleanly at doctor/lint time, or crash mid-run?"* `roadmap.md` Phase 1 lists it as
**Spike 3**, confidence **Low — untested path**, timeboxed at 1 day, running alongside
Spike 5 with no dependency.

**Preliminary findings, already observed (2026-08-14, during story-writing — not the full
spike, see Implementation notes for the exact commands run):**

1. `attractor doctor` checks only binary presence (`claude`, `git`, `sh` required; `bun`,
   `dot` optional, per `plugins/attractor/README.md`). It says **nothing** about
   worktree-creation rights or tool-permission grants — confirmed live, doctor passed
   cleanly even against a target repo whose `.git` had been made unwritable.
2. `plugins/attractor/README.md` states `--stub` "never touches `--cwd` this way and needs
   neither flag" — confirmed live: `attractor run <fixture> --stub` alone never invokes the
   worktree-creation code path at all. **This means the task's literal instruction — "run
   `attractor run <fixture> --stub`" — will not by itself exercise the failure mode `OQ-9`
   asks about.** `--stub --worktree` together *does* create a real worktree (confirmed
   live, see Implementation notes) and is the flag combination that actually answers the
   worktree half of `OQ-9` without spending on a real `claude -p` backend run.
3. The tool-permission half (`bypassPermissions`, `--allow-tools`) is requested only by the
   real `claude` backend — `--stub` replaces that backend entirely, so no combination of
   `--stub` flags can exercise it. Answering that half needs either a real (non-`--stub`)
   run or a different mocking approach; **not yet done**, and the primary remaining work
   this story's implementer should do.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/architecture.md` | modify — record the real findings in the Spikes table, row 3 (`OQ-9`), moving it from open to answered; revise the Setup table's "S-5, partially closes `OQ-9`" note if the finding changes how partial that closure is |
| `plugins/delivery/.delivery/initiatives/attractor-handoff/prd.md` | modify — update the `OQ-9` row in Open questions with the real outcome: resolved, or narrowed with a citation to what remains open |
| *(throwaway, never committed)* a fresh `git worktree` under `/tmp` or the scratch directory | create for the dry run, then remove (`git worktree remove --force` + `git branch -D`) — leaves no trace in the real repo, same discipline used for the preliminary check |

No skill, hook, agent or template file changes — this is a pure investigation story.

## Interfaces and contracts to honor

From `plugins/attractor/README.md`, reproduced here (not linked):

```
attractor doctor
  checks: claude, git, sh (all required)
          bun, dot (both optional)

attractor run <file.dot> --cwd dir --stub [--worktree | --in-place] [--run-dir dir]
  A real (non-stub) run is isolated in a dedicated git worktree by default when
  --cwd is inside a git repository. --in-place opts out. --stub never touches
  --cwd this way and needs neither flag — confirmed live: only --stub --worktree,
  or a real (non-stub) run, actually creates the worktree.
```

Real, observed failure shape (from the preliminary check — a target repo with an
unwritable `.git`, run via `attractor run <fixture> --stub --worktree`):

```
attractor: Command failed: git worktree add -q -b attractor/<run>-<hash> <tmp-path>
fatal: cannot lock ref 'refs/heads/attractor/<run>-<hash>': unable to create
directory for .git/refs/heads/attractor/<run>-<hash>
(exit code 1)
```

This is raw `git` stderr, wrapped in a one-line `attractor: Command failed:` prefix — not a
purpose-built "you're missing a permission, try `--in-place`" message. It failed **before
any pipeline node dispatched** (no `start`/`implement`/`done` output appeared) — so no
tokens or partial work were spent — but the message itself is closer to "confusing" than
"clean." `OQ-9`'s own framing poses this as a binary (clean vs. confusing); the real
observation is a third case the story must write down precisely rather than force into one
bucket: **fails before work starts, but with an unexplained raw error.**

## Relevant design decisions

- **`ADR-008`** (Setup is a prerequisite, not a feature) — `attractor doctor passes` is a
  Setup item, never an `FR-n` or its own phase; this spike's findings feed that Setup
  table's note, which is why `requirements: []` here — there is no `FR-n` to trace to.
  `OQ-9` is cited directly in the acceptance criteria instead.
- **Runner availability check** (glossary) — explicitly the install-presence check
  (`FR-13`/`FR-14`); this spike is the deliberately narrower, one-layer-deeper precondition
  the glossary entry itself distinguishes it from. Do not conflate the two in the write-up.

## Acceptance criteria

- [ ] `OQ-9` — A fresh git worktree is actually created with `git worktree add` (not
  simulated or assumed), and `attractor doctor` is run inside it; the real output is
  recorded verbatim.
- [ ] `OQ-9` — Confirms whether `doctor`'s check surface covers the worktree-creation/
  tool-permission precondition at all, as a directly observed fact (the preliminary finding
  above says no — this must be reconfirmed, not just copied forward).
- [ ] `OQ-9` — A deliberately induced worktree-creation failure is run through the flag
  combination confirmed to actually exercise that code path (`--stub --worktree`, per the
  preliminary finding — re-verify this still holds, since it is the load-bearing discovery
  the whole spike depends on) and the real failure output — message text, exit code,
  whether any node dispatched first — is recorded verbatim, extending beyond the single
  unwritable-`.git` mechanism already tried if a second, independent way to deny the right
  is easy to construct (e.g., a read-only filesystem mount, a locked worktree).
- [ ] `OQ-9` — The missing-tool-permission half is explicitly addressed: either exercised
  with a real (non-`--stub`) run and its output recorded, or the story states plainly that
  it remains untested and why (`--stub` never invokes the `claude` backend that requests
  those permissions).
- [ ] `OQ-9` — Whether a genuinely fresh worktree directory (one Claude Code's own
  unattended session has never seen) triggers a folder-trust prompt that would block a
  headless `claude -p` run is checked and recorded — a third, previously unconsidered
  dimension of "no prior grants" distinct from OS file permissions and from
  `bypassPermissions`/`--allow-tools`.
- [ ] `architecture.md`'s Spikes table (row 3, `OQ-9`) is updated from open to answered
  with the real result.
- [ ] `prd.md`'s Open Questions table (`OQ-9` row) reflects the real outcome.

## Test approach

**Level:** empirical spike — a real CLI, a real git worktree, real induced failures. No
test substitutes for this; `harden-02`'s prior spike in this same plugin establishes the
precedent (`plugins/delivery/.delivery/stories/harden-02-spike-invocation-reliability.md`).

**Cases:**

| Case | Expected |
| :-- | :-- |
| Fresh worktree, `attractor doctor`, no induced fault | Clean pass; confirms doctor is silent on worktree/permission rights (already observed once — reconfirm) |
| Fresh worktree, `attractor run <fixture> --stub` alone (the task's literal instruction) | Succeeds without ever touching `--cwd`'s isolation machinery — proves this exact invocation cannot, by itself, answer `OQ-9`'s worktree half (already observed) |
| Fresh worktree, `attractor run <fixture> --stub --worktree` against a target with worktree-creation deliberately blocked | Real failure message + exit code + no node dispatched (already observed once, see contract section — reconfirm, and try a second independent blocking mechanism) |
| Real (non-`--stub`) run with a denied/limited tool permission | Whether this half fails cleanly or confusingly — not yet exercised, primary remaining work |
| Real, previously-untrusted worktree directory + headless `claude -p` | Whether a folder-trust prompt blocks unattended execution — not yet exercised |

**Run with** (fixture: `plugins/attractor/skills/attractorify/examples/01-simple-linear.dot`
— the "hello world" pipeline, its own header comment gives the canonical run form):

```
git worktree add /tmp/attractor-oq9-<ts> -b attractor-oq9-spike-<ts>
cd /tmp/attractor-oq9-<ts>
node plugins/attractor/dist/attractor.js doctor
node plugins/attractor/dist/attractor.js run plugins/attractor/skills/attractorify/examples/01-simple-linear.dot \
  --cwd . --stub --param goal="print hello world"
node plugins/attractor/dist/attractor.js run plugins/attractor/skills/attractorify/examples/01-simple-linear.dot \
  --cwd . --stub --worktree --param goal="print hello world"
# repeat the last command against a target whose worktree-creation right has been removed
# (e.g. chmod -R a-w .git on a disposable throwaway repo — never the real repo's .git)

# cleanup — leave no trace in the real repo:
cd /Users/colombod/private-workspaces/delivery-plugin/ai-augmentation-systems
git worktree remove --force /tmp/attractor-oq9-<ts>
git branch -D attractor-oq9-spike-<ts>
```

## Out of scope

- Building any fix or mitigation for the gap found (e.g., teaching `doctor` to check
  worktree-creation rights) — this spike produces a written, evidenced answer only; a fix
  is a follow-up decided once the answer is known, matching the roadmap's framing of this
  as a 1-day investigation, not a build.
- Redesigning `attractor doctor` or any part of `plugins/attractor` — it is an external,
  stable, **documented interface** consumed unmodified (`architecture.md`'s Codebase
  context: "Untouched"). If this spike finds doctor should check more, the right move is a
  recommendation routed upstream, mirroring how a real documentation gap was found and
  fixed upstream earlier in this same initiative (`github.com/colombod/ai-augmentation-
  systems#40` → `#42`) — not a change made in this repo.
- Retrofitting an install-precondition check onto `superpowers`/`generic` runner modes —
  explicitly out of scope for the whole initiative (`prd.md`'s Out of scope).
- If the real (non-`--stub`) tool-permission test proves impractical inside the 1-day
  timebox (cost, difficulty reliably denying `bypassPermissions`), recording it as
  "attempted, still open" is an acceptable outcome — state explicitly which happened rather
  than silently skipping the acceptance criterion.

## Dependencies

None. Can run in parallel with `attractor-handoff-01` and, per `roadmap.md`'s Phase 1
table, alongside Spike 5 — entry criteria require only that `attractor` is installed and
`doctor` passes in the ordinary case, already confirmed true today (see Implementation
notes).

## Implementation notes

**Preliminary check run 2026-08-14, during story-writing, to verify every command and path
above is real — not the full spike, but a real head start the implementer should not
re-derive from scratch.**

- `node plugins/attractor/dist/attractor.js doctor` from the repo root: `claude 2.1.222`,
  `git 2.50.1`, `sh` all `ok`; `bun` `absent` (optional); `dot` `ok` (optional). Baseline
  confirmed working.
- `git worktree add /tmp/.../attractor-oq9-check -b oq9-spike-check-tmp` succeeded; the
  checked-out worktree contains `plugins/attractor/dist/attractor.js` (it is a tracked
  file, confirmed via `git ls-files`, so every worktree gets a working copy of it).
- Inside that worktree: `doctor` passed identically; `attractor lint
  .../01-simple-linear.dot` → `no errors`; `attractor run .../01-simple-linear.dot --cwd
  /tmp/does-not-even-exist --stub --param goal=... --run-dir /tmp/attractor-oq9-run` →
  `status: success`, **without ever creating or touching that `--cwd` path** — confirms the
  README's claim that `--stub` alone skips isolation entirely.
- Adding `--worktree` to the same `--stub` invocation **did** create a real worktree
  (`worktree: /var/folders/.../attractor-wt-.../...`, `work is on branch
  attractor/...`) — this is the load-bearing discovery: `--stub --worktree` is the cheap
  way to exercise the real worktree-creation code path without a paid `claude -p` run.
- Built a disposable throwaway repo (separate from this one), stripped write permission
  from its `.git` (`chmod -R a-w .git`) to simulate a missing worktree-creation right, then
  ran `attractor run ... --stub --worktree --cwd <that repo>`. Real result: failed before
  any node dispatched, exit code 1, message `attractor: Command failed: git worktree add
  -q -b attractor/... fatal: cannot lock ref '...': unable to create directory for
  .git/refs/heads/...`. Raw `git` stderr, not a purpose-built explanation — recorded
  precisely in the Interfaces section above.
- All throwaway artifacts (worktree, branch, disposable repo) were removed after the
  check; `git worktree list` and `git status` confirmed the real repo was left clean.
- **Not yet done, left for this story's implementer:** the tool-permission half (needs a
  real `claude` backend run) and the folder-trust-prompt question (needs a genuinely fresh,
  never-before-seen worktree directory run headlessly). Both are named explicitly in
  Acceptance criteria rather than silently folded into "done" by the worktree half alone.
