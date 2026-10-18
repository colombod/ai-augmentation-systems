# Delivery conventions

Shared rules for the pipeline skills. A skill that points here is bound by every section
it names exactly as if that section were written in the skill itself. Read the whole file
once per skill run; it is short.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing any artifact:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Which initiative

Every artifact below lives under `.delivery/initiatives/<slug>/`, never directly under
`.delivery/` — this is what lets independent initiatives (epics, sprints, parallel
workstreams) be planned in parallel branches without colliding on the same shared file
(`ADR-004`; the incident that motivated it: two initiatives independently continued the same
`S-n`/`FR-n` sequence in one shared `prd.md`, discovered only at merge). Resolve which
initiative before reading or writing any artifact:

1. **Explicit signal.** The user names an initiative, or one is already established for this
   conversation — use it.
2. **Exactly one exists.** If `.delivery/initiatives/` has exactly one subdirectory, use it
   without asking — this keeps single-initiative projects exactly as simple as before this
   convention existed.
3. **Ask, don't guess.** Otherwise (zero, or more than one, with no explicit signal) — ask
   which initiative this work belongs to, or whether to start a new one. Never silently
   default to the most recently modified one.
4. **Starting a new initiative.** Confirm its slug (kebab-case, derived from the brief
   subject or what the user names) before creating `.delivery/initiatives/<slug>/` — check it
   doesn't collide with an existing initiative slug or any other top-level `.delivery/` entry.
   A genuinely new initiative needs its own `/delivery:brief`, or an explicit
   `extends: <existing-slug>` note (in this new initiative's own first artifact) declaring it
   reuses an existing initiative's problem framing instead of running its own — state which,
   don't leave it implicit.

Cross-cutting, project-wide, never per-initiative: `.delivery/glossary.md`,
`.delivery/personas/`, `.delivery/interviews/`, `.delivery/simulations/`,
`.delivery/decisions/ADR-NNN-*.md` (and `.delivery/invocations/` when the opt-in invocation ledger is on).
`.delivery/stories/`, `.delivery/reviews/`, `.delivery/sprints/` stay flat but are prefixed
by initiative slug, matching `stories/<slug>-NN-<name>.md`'s existing convention.

## Open blocking findings

Read `.delivery/reviews/`. If any finding against an artifact
this phase consumes has status `open` and severity `blocking`, **stop and report them** — do
not proceed. A blocking finding is one a reviewer said must be resolved before this point;
building on it means every downstream artifact inherits a known, documented defect with no
resolution on record.

Resolving means the finding is marked `fixed`, or `rejected` with the reason recorded. The
user may still choose to proceed over an open finding — that is their call, not a default.
Ask, and record what they chose.

## Language

Read `.delivery/glossary.md` first and use its terms exactly. If it does not exist, create
it as *Keeping the glossary* below says — or, for a small effort, collect terms as you go and
propose the file at the end. Do not coin synonyms for concepts it already names.

Any term you need that is missing gets **proposed explicitly**, with a definition in the
business's vocabulary and a concrete referent. Any term carrying two meanings gets raised as
a defect, not resolved silently.

**Questions go out in the vocabulary of whoever must answer them**, with a worked example in
their world. A question for the business owner written in engineering terms is a blocker
with a name on it, not a question. If a question is really an engineering call, decide it
here rather than routing it to them.

### Keeping the glossary

`.delivery/glossary.md`, one agreed term per concept, written from
`${CLAUDE_PLUGIN_ROOT}/templates/glossary.md` (budget: 500 words target, 900 hard cap). It is
project-wide and every skill reads it; any skill that coins or meets a new term adds it.
Every document is written by someone fluent in a different dialect — the analyst's *booking
window* is the architect's *date range* and the owner's *price list* — and the damage shows
at the edges: questions the owner cannot answer, requirements that drift into two concepts,
and a hand-off the runner has to guess at.

1. **Curate, never regenerate.** If the file exists, edit it. Terms are stable: changing a
   definition means saying what it was, what it is now, and which documents were written
   under the old meaning.
2. **Harvest the terms actually in use** — the originator's own words first (they outrank
   everything), then the brief, PRD, personas, architecture, and real identifiers in code
   and data.
3. **Resolve collisions.** Synonyms (several words, one concept): pick one, list the rest as
   *aliases, not to be used*, with the document each came from. Homonyms (one word, several
   concepts): split them and rename at least one.
4. **Let the business word win.** Where domain and code disagree, the domain term is the
   entry and the code identifier is recorded as its implementation name. Do not rename code
   as a side effect.
5. **Define in the owner's words**, plain sentence first, precise one after if needed, and
   **ground each term** in a worked example, a file path or a value from the data.
6. **A term nobody can define crisply** is an unresolved product decision wearing a noun:
   list it as an open question for the originator, never invent a definition.
7. **Sweep for completeness.** Every domain noun in the existing artifacts appears in the
   glossary or is deliberately excluded, and no synonym is left without one canonical term.

**Report what changed** when you hand off: new terms, resolved synonyms, and any term that could
not be defined. Those are product decisions, and they belong to the originator.

`/delivery:status` reports terms used in documents that are not in the glossary.

## Writing, then revising

The skill states the budget: a word target and a hard cap (both exclude code, YAML and data tables).

**Compose first. Do not try to hit the budget while writing.** Restraint during
composition trades substance for brevity in the wrong order — the findings get thinner
while the scaffolding survives. Write what the artifact needs, then cut what it does not.

**Then measure, do not estimate.** The budget counts **prose only**. Data tables, code
blocks and YAML are excluded, so measure with them stripped:

```bash
grep -v '^|' <the file you just wrote> | wc -w
```

A plain `wc -w` counts the tables and will overstate the total, often by several times.
Measuring the wrong number leads to cutting the wrong thing.

**Rows in a data table can never help you meet the budget, because they are not counted.**
Deleting them is pure loss for zero benefit. The term table, the requirement table, the
findings table, the friction map — these *are* the artifact. If a revision pass is removing
rows, it has misunderstood the rule and should stop.

**If the count exceeds the hard cap, you are not finished.** Make a revision pass over the file and
delete, in this order, until it fits:

1. Preamble, recap, and any sentence describing what the document is about to say
2. **Restatement** — the same fact as prose *and* a table row *and* a summary bullet. Keep the form that carries it best; delete the others. This is almost always the biggest win.
3. Process narration — "I examined X and found Y" becomes Y
4. Hedging — either you know it, or it is labelled an assumption. Both are shorter.
5. Citations past the first for a given claim
6. Examples past the first, unless the next one shows a *different* failure mode

Then re-measure with the same command and confirm.

**Never delete** any row of a data table, findings and their failure scenarios, one citation per claim, grounding
and confidence labels, synthetic-output warnings, open questions, or IDs a later phase
reads. If the artifact cannot fit without losing those, keep them, exceed the cap, and
**write the final count and the reason into the document**. A declared overrun is a
judgement. A silent one is a habit.
