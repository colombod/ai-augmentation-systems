# Glossary — the ubiquitous language

> Every document, question and conversation in this project uses these terms and only these
> terms. One concept, one word. Where a role's professional dialect prefers another word, the
> dialect gives way.
>
> **Owned by:** Product Owner (arbitrates) · **Curated by:** Business Analyst
> Last curated: 2026-08-07

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
| Chief of staff | The mechanism that triages an agent's candidate questions before they reach the operator — answers directly when a real source settles it, bounces invented scope back to the originating agent, routes technical unknowns to spikes, and combines everything else into one ranked briefing. | `prd.md` S-6–S-12 | — | — |
| Candidate question | A question an agent has formed, mid-work, that it would otherwise surface directly to the operator, before chief of staff has triaged it. | `prd.md` S-6's Trigger | — | bare "question" — keep distinct from S-8's "technical unknown" |
| Citable traceback | A pointer to an exact, nameable source — a specific artifact line or a specific thing the operator actually said — that an answer or flag can be checked against; never an inferred or summarized judgment. | `prd.md` S-6's hard constraint; `FR-21` | — | "citation" |
| Briefing | The single, ranked report chief of staff delivers at check-in, containing everything that survived S-6/S-7/S-8 triage. | `prd.md` S-9; `FR-32`/`FR-33` | — | a solo `FR-48` push item is explicitly not a briefing |
| Decision pattern | A repeated, traceable regularity in what the operator actually did with past briefed/answered items — grounded only in a stated minimum number of real logged instances of that exact category. | `prd.md` S-10; `FR-36`/`FR-37` | — | — |
| Decision log | The persisted, timestamped record chief-of-staff failures (`FR-23`, `FR-55`) and S-10's learning substrate are written to. Minimum record content: a category distinguishing entry types, the specific answer/citable traceback involved, and a timestamp. Storage location/format is Open Question 7, decided at architecture time. | `prd.md` `FR-23`, `FR-36`–`39`, `FR-55` | — | — |
| Park-over-polish | The stated bias that, given this pipeline's premise of fast incremental delivery corrected by real usage data, an ambiguous triage case defaults to parking a non-blocking decision and continuing, rather than exhaustively resolving upfront. | The operator's direct statement while scoping the Chief of Staff epic, and a real, unprompted instance of the operator applying it themselves in the `attractor-orchestration-claude` session (`prd.md` S-9) | — | — |
| Mission | The verbatim excerpt or citable pointer capturing why an effort exists, checked continuously against new output so a requirement met on paper doesn't silently drift from the reason the work started. | `prd.md` S-11/`FR-40`–`43` | `.delivery/chief-of-staff/mission.md` | — |
| Pull | The operator (or the agent acting on their behalf) explicitly asks chief of staff for the current briefing — the default way S-9's briefing reaches them. | `prd.md` S-9; `architecture.md`'s Component structure | — | — |
| Push | The one narrow exception to pull: a blocking queue item with no open counterpart already delivered surfaces at the front of the calling agent's very next reply to the operator in a live session, rather than waiting for an explicit pull. Not an out-of-band interrupt — this harness has no mechanism for one. | `prd.md` `FR-48`/`49`; `architecture.md`'s Interface 1 return-contract | — | "interrupt", "notification" (implies a capability this design doesn't have) |
| Acceptance gate | A compiled, checkable validation for one acceptance criterion inside an attractor-handoff pipeline; passes or loops through a fix step. | `attractor-handoff/prd.md` `FR-5`–`FR-7`; attractor's own `goal_gate="true"` DOT attribute (`plugins/attractor/README.md`) is the code identifier for the pass/fail node itself | `goal_gate` (on the pass/fail node only — a gate's fix loop likely spans more than one graph node) | bare "gate" alone — collides with `Handoff readiness check` and attractor's own `goal_gate` attribute; always say "acceptance gate" in full |
| Non-convergent | A story or criterion outcome: its gate/fix loop exhausted its declared attempt bound without passing. | `attractor-handoff/prd.md` `FR-9`, `FR-17` | `Outcome = non-convergent` | "timed out" — a different axis (attempt count vs. wall-clock; see `NFR-2`) |
| Irreducible criterion | An acceptance criterion the compilation step cannot reduce to any checkable gate; flagged explicitly, never silently dropped or silently backed by unmarked judgment. | `attractor-handoff/brief.md` MVP boundary; `prd.md` `FR-11`/`FR-12` | `irreducible` | — |
| Handoff readiness check | The pre-flight verification `/delivery:handoff` runs on a sprint scope package's own content before producing any runner-specific artifact. | `skills/handoff/SKILL.md` (renamed from "Gate check" to stop colliding with `Acceptance gate`) | — | "gate check" (the old name — retained only as a historical alias, not for new use) |
| Runner availability check | Whether the chosen runner's own tooling is present and usable, checked before compiling anything for it — distinct from `Handoff readiness check`, which verifies the package's content, not the runner's presence. | `attractor-handoff/prd.md` `FR-13`/`FR-14` | — | — |
| Handoff artifact | The file(s) a `delivery:handoff` runner mode writes for one sprint — for `attractor`, the dependency graph plus compiled acceptance gates and irreducible-criterion flags. Format-agnostic. | `attractor-handoff/brief.md` MVP boundary; `prd.md` scenarios S-1–S-6 | — | bare "the artifact" where `Governed artifact` (a different, broader concept) is also in play nearby |
| Dataflow ledger | Attractor's own `outputs=`-driven record of which node owes a declared context key and hasn't delivered it — governs whether one story's non-convergence blocks another's. Delivery-plugin vocabulary reusing attractor's own documented term, not a new invention. | `plugins/attractor/README.md` "Dataflow: `outputs=`"; `attractor-handoff/prd.md` `FR-10`, `FR-18` | `outputs=` | the "two consecutive stories block" stop condition (`templates/sprint.md`) — a different, human/agent-facing mechanism, mis-cited for this purpose in an earlier PRD draft, corrected in `prd.md` `FR-10` |

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

**2026-08-11:** "Gate"/"gate check" was found carrying three distinct meanings across the
`attractor-handoff` initiative — `skills/handoff/SKILL.md`'s pre-flight package-readiness
check, attractor's own `goal_gate` DOT attribute, and this feature's new per-story
execution-time check. Resolved by renaming the first to `Handoff readiness check` and
reserving "gate," always spoken in full as `Acceptance gate`, for the third. See the new
terms above.

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
| 2026-08-11 | Added `Acceptance gate`, `Non-convergent`, `Irreducible criterion`, `Handoff readiness check` (rename of "Gate check"), `Runner availability check`, `Handoff artifact`, `Dataflow ledger` | `attractor-handoff` PRD phase (business-analyst stress-test + QA-strategist verifiability pass) surfaced a real "gate" homonym and several load-bearing terms used across `brief.md`/`prd.md` with no governed definition | `attractor-handoff/prd.md` **did** need a retroactive fix (`R-prd-7`, found independently by two `/delivery:challenge` reviewers): 19 bare "gate" occurrences, corrected the same day. This log's original claim of "no retroactive fix needed" was itself wrong — recorded here rather than quietly corrected, per this file's own non-static-source convention. |
