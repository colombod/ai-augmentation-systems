# ADR-004: Give every initiative its own `.delivery/initiatives/<slug>/` subtree

**Status:** accepted — both routed open items resolved directly (operator, 2026-08-07):
"epic" and "initiative" stay the same concept, 1:1, matching this repo's existing
`epic:` frontmatter usage — revisit only if a real case for one initiative spanning
multiple independently-staffed epics actually arises. The signaling-mechanism spike is
skipped: the resolution algorithm's own fallback (explicit signal → exactly-one-exists →
ask-if-ambiguous) already covers the real cases without new CLAUDE.md/AGENTS.md config
surface — add a persistent pointer later only if ask-when-ambiguous proves annoying in
practice, not preemptively.
**Date:** 2026-08-07
**Deciders:** solution-architect, with product-owner sign-off pending on the epic/initiative
terminology question below, and business-analyst sign-off pending on the glossary entries
**Word count:** ~1470 prose-only (`grep -v '^|' | wc -w`), well past the template's 600-word
cap — declared, not silent. This restructures 7 templates, ~15 skill files and 10 agent
files, sets a real migration path for a repo already mid-incident, and the operator asked
explicitly for both rejected alternatives to be argued, not dismissed in a line. Cut twice
already (narration, restatement); the remainder is citations, the migration recipe, and the
four alternatives — the template's own protected categories. Larger than `ADR-002`'s declared
~720-word overrun because this decision also carries a file-by-file blast-radius inventory
that ADR did not need.

## Context

Real incident, this repo: `harden`'s Phase 5 and `chief-of-staff` were developed in parallel
branches, both appending to the same shared `.delivery/{prd,architecture,roadmap}.md`, both
continuing the same `S-n`/`FR-n` sequence from the same starting point, neither aware of the
other. Result: `S-5` and `FR-17`–`19` each meant two different things, plus merge conflicts in
every shared file — found only at merge, hours of hand reconciliation (see the renumbering
commit `236e70a` and `stories/README.md`'s hand-written reconciliation notes).

The plugin already isolates correctly in four places: `decisions/ADR-NNN-<slug>.md`,
`stories/<epic>-NN-<slug>.md`, `invocations/<session_id>.ndjson`, `reviews/<artifact>-NN.md`
— one file per unit, so two branches never touch the same lines. Broken: the seven monolithic
aggregators (`brief.md`, `research.md`, `prd.md`, `prioritization.md`, `design-system.md`,
`architecture.md`, `roadmap.md`) and the hand-maintained `stories/README.md`.

**This repo is not the simple case.** `prd.md`, `architecture.md` and `roadmap.md` currently
hold *both* epics concatenated — `prd.md:299` (`## Epic: Chief of Staff (new — additive...)`),
`architecture.md:249` and `roadmap.md:300` (each a second top-level `# ` header). `brief.md`,
`research.md`, `prioritization.md` are `harden`-only (verified — zero `chief-of-staff`/`CoS-`
mentions). `prd.md` is 5,022 prose words against `templates/prd.md`'s 1,600-word hard cap —
3.1× over, because it is two initiatives' worth of content in a template sized for one. That
overrun is itself evidence: the budget mechanism already assumes one initiative per file.

Every one of `skills/{brief,research,prd,prioritize,design,architecture,roadmap,stories,
sprint,handoff,sprint-review,realign,status,challenge,glossary}/SKILL.md` hardcodes singular
paths (`.delivery/prd.md`, etc.) in its own prose, not a variable — confirmed by direct read
of all 15. So do `agents/{business-analyst,product-owner,solution-architect,program-manager,
qa-strategist,design-lead,delivery-lead,user-researcher,chief-of-staff,feature-critic}.md` —
same defect, not previously named, wider blast radius than the ask.

## Decision

**New layout**, organized by whether content forks along initiative boundaries or not:

| Category | Location | Rule |
| :-- | :-- | :-- |
| Initiative-scoped aggregators | `.delivery/initiatives/<slug>/{brief,research,prd,prioritization,design-system,architecture,roadmap}.md` | moves here from root |
| Initiative-scoped, already unit-isolated | `.delivery/stories/<slug>-NN-*.md` (unchanged), `.delivery/reviews/<slug>-<artifact>-NN.md` (extend the token), `.delivery/sprints/<slug>-N-*.md` (extend, fast-follow) | stays flat, gets the initiative prefix `stories/` already has |
| Project-wide, deliberately shared | `glossary.md`, `personas/`, `interviews/`, `simulations/`, `decisions/ADR-NNN-*.md`, `invocations/<session_id>.ndjson` | untouched |
| Unrelated | `.delivery/chief-of-staff/{queue.md,mission.md,decision-log/}` | the *product's own runtime data* for the shipped chief-of-staff feature, not a planning artifact — nesting initiatives under `initiatives/` rather than directly at `.delivery/<slug>/` is exactly what keeps a future initiative literally named `chief-of-staff` from colliding with this existing directory |

Rule for the split: **who the product is for doesn't fork per planning boundary** (personas,
glossary, prior art) stays project-wide; **what's being built and when** forks, so it moves.
Decisions and the invocation ledger are cross-cutting infrastructure by design (an ADR can
apply to two initiatives; a session can touch both) — unchanged.

**Slug**: operator-named or confirmed, never silently picked. Derived from the brief subject
/ `$ARGUMENTS` (kebab-case), shown, confirmed before the directory is created — checked
against existing initiative slugs *and* every top-level `.delivery/` entry (the
`chief-of-staff/` collision above is why).

**"Which initiative" resolution** — new, identical block inserted into all 15 skills right
after the existing "Where `.delivery/` resolves to" boilerplate, same rollout mechanism that
block already uses: explicit signal wins; else exactly one initiative exists → use it, no
prompt (keeps today's single-initiative ergonomics); else ask, never guess; a genuinely new
initiative gets its slug confirmed plus either its own brief/research or an **`extends:
<slug>`** pointer to an existing initiative's problem framing — the latter because
`chief-of-staff` here never ran its own brief/research and implicitly reused `harden`'s; this
makes that pattern explicit instead of silent. **Spike (owner: operator, 30 min):** confirm
the signaling mechanism — reuse the existing CLAUDE.md/AGENTS.md delivery-root override point
for a persistent "current initiative" pointer, vs. always-ask-when-ambiguous with none. Do not
invent `$ARGUMENTS` parsing syntax for this; every skill already uses `$ARGUMENTS` for
something else.

**Index**: none. `.delivery/initiatives/*/` *is* the index — `/delivery:status` lists it live,
the same way it already checks file existence for the phase table. Nothing to hand-maintain,
nothing to collide.

**`stories/README.md`**: retired as a shared file, split by what it actually contains. The
ID/title/phase/requirements/status **table** is 100% derivable from story frontmatter
(`templates/story.md`'s own fields) — `/delivery:status` computes it live; this is the exact
part that collided. The **narrative** (build-order diagrams, cross-story reconciliation notes)
is authored judgment, not derived data, and moves to each initiative's own small notes file
under `.delivery/initiatives/<slug>/` — still git-diffable, just never shared between
initiatives, which is what actually caused the collision in the first place.

**Migration, this repo specifically** (mechanical, then one flagged manual step): `git mv`
`brief.md`/`research.md`/`prioritization.md` into `initiatives/harden/` as-is (verified
`harden`-only). Split `prd.md`/`architecture.md`/`roadmap.md` at their own existing section
boundaries (cited above) into `initiatives/{harden,chief-of-staff}/` — copy-paste along a
boundary this team already hand-labeled, not a semantic rewrite. `decisions/`, `stories/`,
`invocations/`, `reviews/`, `personas/` untouched. **Never renumber `FR-n`/`S-n`/`NFR-n`
during migration** — every existing citation in stories, ADRs and reviews depends on the
current numbers holding.

For other projects: `.delivery/` exists, no `initiatives/`, has legacy root files → one-time
prompt for the single initiative's slug, plain `git mv`. Multiple `# `-level sections inside
one legacy file is flagged for **human-reviewed** split, never auto-split unsupervised — a
heading is only a reliable boundary signal because this team happened to label it "additive"
consistently, which is not guaranteed elsewhere.

**Rollback**: revert the move commit(s). No content transformation, no ID rewrite to undo.

## Alternatives considered

### Lock/coordination convention on the shared files
**Attractive:** zero structural change. **Rejected:** a lock is a promise an agent on an
isolated git branch has no mechanism to check or enforce — the incident proves this already
failed with "neither aware of the other." Locking needs a shared serialization point both
writers actually touch before writing; independent worktrees have none.

### Force initiatives to fully serialize
**Attractive:** trivially correct — no concurrent writers, zero engineering cost. **Rejected
explicitly, not skipped:** contradicts the operator's stated bar ("run multiple
sprints/initiatives in parallel... not optional scope") and the real case — `harden` Phase 5
and `chief-of-staff` were both genuinely worth developing concurrently; serializing idles one
for no technical reason, and fights the tooling already in use (this session runs in a git
worktree built for parallel development).

### Formalize the in-file "## Epic: X (additive)" pattern instead of separate files
**Attractive:** cheap; this team already converged on it independently for `prd.md`.
**Rejected:** doesn't touch the defect. Git conflicts are line/hunk-level; two branches both
appending a section to the end of the same file collide on the insertion context almost every
time — exactly what happened. Delimiting sections helps read one already-merged file; it does
nothing for the merge itself.

### Nest stories/decisions/reviews/invocations under each initiative too
**Attractive:** conceptually uniform. **Rejected:** these four already work, by the
operator's own diagnosis. Nesting fragments the ADR sequence and the cross-initiative view for
no defect it fixes — an abstraction for a use case that doesn't exist yet.

## Consequences

**We gain:** the actual collision surface (7 files + 1 hand-maintained index) removed; single-
initiative projects see zero added friction (rule 2 of the resolution algorithm); the existing
isolation patterns (stories, ADRs, reviews, invocations) untouched, not "fixed" a second time.

**We accept:** ~15 skill files and 10 agent files need the identical new block plus path
rewrites — mechanical but real, not yet executed by this pass. The migration's content-split
step for this repo needs a human review pass, not a script. `stories/README.md`'s narrative
value is preserved but relocated, not free.

**Not fixed — named, not overclaimed:** glossary conflicts (reduced — table rows, not prose,
plus the skill's own homonym rule — but not eliminated; real backstop is a human re-run of
`/delivery:glossary` at merge time). Two initiatives' stories targeting the same product
source file (this governs `.delivery/` only; `chief-of-staff-10` already touches all 9
`agents/*.md` files future `harden` work might also touch — `/delivery:stories`'s existing
same-file check should extend across initiatives, and `/delivery:status` should flag it, not
block it). Two branches independently minting the same ADR number (real, small, cheap to fix
by a one-line rename at merge — unlike the aggregator case, this residual cost stayed cheap
precisely because ADRs were already one-file-per-unit).

**Revisit if:** a project needs one initiative to legitimately span multiple `epic:` values
(see the open terminology question below) — this design currently assumes 1:1.

## Open question routed to product-owner (in their vocabulary)

Right now "harden" and "chief-of-staff" are each called an **epic** on every story file and
would each be called an **initiative** under this design — same two things, two names. If a
future piece of work is always exactly one epic, use one word everywhere and retire "epic."
If a big initiative could someday split into several independently-staffed epics, "epic"
becomes a subdivision inside an initiative, and stories need both IDs. Which is true here?

## Glossary entries proposed, not written (owner: business-analyst, arbiter: product-owner)

- **Initiative** — a self-contained body of product work, planned and delivered independently
  enough to run in parallel with others without waiting on them. Referent: `harden` and
  `chief-of-staff`. Code identifier: `.delivery/initiatives/<slug>/`.
- **Extends** — a new initiative's declared reuse of an existing initiative's brief/research
  instead of running its own. Referent: `chief-of-staff`'s actual (implicit, now made
  explicit) reuse of `harden`'s problem framing.
