# Glossary — the ubiquitous language

> Every document, question and conversation in this project uses these terms and only these
> terms. One concept, one word. Where a role's professional dialect prefers another word, the
> dialect gives way.
>
> **Owned by:** Product Owner (arbitrates) · **Curated by:** Business Analyst
> Last curated: 2026-08-05

## How to use this

- **Before writing anything**, read this file. Use these terms exactly.
- **Need a word that is not here?** Propose it — do not just use it.
- **Found a word meaning two things?** That is a defect. Raise it; do not pick one silently.
- **Changing a definition** requires recording what it meant before and which documents were
  written under the old meaning.

## Why this file exists, written now instead of before the brief

This should have run before `/delivery:brief`, as every skill in this plugin instructs. It
didn't, across four phases in a row — and the cost showed up exactly where the doctrine says
it will: the human reader of the PRD draft had to keep stopping to work out who "P-1" and
"P-2" were, which is precisely "a question the owner cannot answer without decoding the
dialect first." Written retroactively; the terms below now govern everything already
written and everything still to come.

## Terms

| Term | Definition (in the business's words) | Referent | Code identifier | Aliases — do not use |
| :-- | :-- | :-- | :-- | :-- |
| Invoked | A skill or check actually ran — there is a real record of it happening, not just a sentence claiming it did. | A Skill/Agent tool call appearing in the session's own tool-call history. | tool-call/invocation record | "ran", "was called", used loosely elsewhere — keep for "invoked" only when a real record backs it |
| Narrated | The agent's own text says an action happened or is happening, with no check on whether it actually did. | The attractor-orchestration incident: "I only wrote the text 'Continuing straight into /delivery:prd now, no pause' without actually invoking the Skill tool." | — | "claimed", "reported it did" |
| Traceable / Untraceable | Whether a written artifact can be matched back to something that was actually **Invoked**, or only to something **Narrated**. | Finding A, `plugins/delivery/.delivery/brief.md` | — | "verified" (too easily confused with a persona's evidence grade, a different concept below) |
| Grounding grade | How much real evidence backs a persona or a claim: **observed** (traceable to real data), **reported** (someone's belief, second-hand), or **assumed** (reasoned, no evidence). Pre-existing plugin term, not coined here — recorded so it lives in one place. | `plugins/delivery/skills/personas/SKILL.md` | `grounding` (persona frontmatter) | "confidence level" (reserve that phrase for the evidence-only marker below, to avoid two meanings) |
| Evidence-only marker | The visible warning a decision carries when every persona or fact behind it is `assumed`-grade — it cannot read as a plain, unqualified "ready". | Finding B; PRD `FR-5`–`FR-8` | `Confidence` column, `templates/prioritization.md` | "downgraded" (used in the PRD draft — replace with this term there) |
| Verification channel | The actual method used to check something is true, matched to the surface a real user actually experiences it through — a rendered webpage needs a real screenshot, a CLI needs a real process invocation with observed output, a TUI needs a real visual capture. Reading a machine-level substitute (page text/structure, an internal function call, ANSI-stripped terminal text) is not the same thing and can't see what the user would. | Finding C; the elba-dreaming DOM-vs-screenshot incident (GUI case); `prd.md` `S-5` (CLI/TUI generalization, 2026-08-06) | — | "test type" |
| Delivery surface | The kind of thing a governed artifact actually is, from a real user's side — a rendered GUI, a CLI, or a TUI today. Determines which verification channel applies; there is no default GUI-shaped check for a surface that isn't one. | `prd.md` `FR-17`; `agents/qa-strategist.md`'s channel table | `surface` (`qa-strategist.md`'s table header) | none — "surface" alone is the short form of this term, not a separate concept |
| Design rubric | The named, written set of visual rules (spacing, alignment, colour, tokens) a screen is checked against. This project's is `design-system.md`, and none exists yet for either real project studied. | Finding C; `plugins/delivery/skills/design/SKILL.md` | `design-system.md` | "design system" when used loosely to mean "good taste" rather than this specific document |
| Self-correction check | A `/delivery:status` or `/delivery:challenge` run — an independent look at the work, separate from the person doing it. | Finding D | — | "status/challenge-equivalent check", "independent check" (both used in the PRD draft — replace with this term there) |
| Governed artifact | A file this plugin's phases produce and track — the ones `/delivery:status`'s phase table already lists (`brief.md`, `research.md`, each persona file, `prd.md`, and so on). | `plugins/delivery/skills/status/SKILL.md`'s phase table | — | none yet — first use was in the PRD without a definition; recorded here to close that gap |
| The operator | The one person who actually runs this plugin, whichever working mode they're in. Referred to by their chosen plain name (below), never by a bare ID, in any sentence meant for a human to read. | — | `persona.slug` in frontmatter | "the user" (ambiguous — could mean this plugin's operator or the end-customer of whatever they're building) |

## Persona reference convention

**Use the persona's name in every sentence — "the operator who checks in periodically," or
its written form "the Unwitnessed Operator." Never write a bare `P-1`/`P-2`/`P-3`/`P-4` in
prose.** The ID exists only for the same reason `FR-1` exists: a stable anchor inside a
table or a frontmatter field, cross-referenced by later phases. It is not a name and should
never be the first or only way a person is identified in a sentence a human has to read.
This convention applies retroactively — the PRD draft in progress uses bare IDs throughout
its scenario prose and needs a pass to fix that before it's finished.

## Deliberately excluded

| Word | Why it is not a domain term |
| :-- | :-- |
| Hook (`Stop`, `PreToolUse`, etc.) | A Claude Code platform primitive, not a concept this project defines |
| Skill / Agent tool | Claude Code platform vocabulary |
| Session | Generic — a Claude Code run, not a product concept |

## Homonyms resolved

None found this pass. "Confidence" was checked for double meaning (evidence grade vs. the
new evidence-only marker) and kept separate by giving the marker its own term above rather
than reusing the word.

## Terms nobody could define

None — every term above has a concrete referent in an existing artifact or transcript
incident.

## Conventions

| Convention | Rule | Example |
| :-- | :-- | :-- |
| Persona reference in prose | Full chosen name, never a bare ID | "the operator who checks in periodically" or "the Unwitnessed Operator," not "P-1" |
| Persona reference in tables/frontmatter | Stable ID only, for cross-reference | `id: P-1` in frontmatter, `P-1` in a table's ID column |

## Curation log

| Date | Change | Reason | Documents written under the old meaning |
| :-- | :-- | :-- | :-- |
| 2026-08-05 | File created | Skipped before every prior phase despite every skill instructing it to run; the omission itself produced a reviewable defect (jargon-heavy PRD draft) | `brief.md`, `research.md`, `personas/*`, `.delivery/reviews/brief-01.md` all predate this file and are not renamed retroactively — future edits to them use these terms |
| 2026-08-05 | Added `Governed artifact`; added "independent check" as a banned alias of `Self-correction check` | The PRD's business-analyst/QA stress-test pass found both drifted from the glossary within the same session it was written | `prd.md` draft — fixed on the same pass that found the drift |
| 2026-08-06 | `Verification channel` broadened from "real screenshot for a rendered webpage" to cover any user-facing surface (GUI/CLI/TUI), each with its own real, checkable channel | Product-owner direction, this session: a CLI/TUI is a real user-facing surface exactly like a GUI, and checking it at the machine level (internal calls, ANSI-stripped text) is the same mistake the original definition existed to catch, just narrower than it needed to be | `prd.md` (`S-3`, `FR-9`–`FR-12`) was written under the old, GUI-only meaning — still correct for GUI, now one case of the broader term rather than the whole of it |
| 2026-08-06 | Added `Delivery surface` | `/delivery:challenge`'s review of the `S-5` addition (minor finding) found "surface" used in `prd.md`/`qa-strategist.md` without a glossary entry, unlike `Verification channel`, added correctly the same session | `prd.md` (`FR-17`), `agents/qa-strategist.md` predate this entry — no fix needed, they already use the term consistently |
