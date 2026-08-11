# Journey simulation: attractor-handoff

> ⚠ **SIMULATED OUTPUT — hypotheses about where friction lives, not usability findings.**
> Never turn a simulated abandonment count into a number in a business case.

**Basis:** proposed flow — no PRD or real product exists yet; walked against `.delivery/initiatives/attractor-handoff/brief.md` and `research.md`.
**Personas walked:** P-1 The Unwitnessed Operator (observed), P-2 The Spec-Literal Operator (observed), P-3 The Monorepo Maintainer (reported), P-4 The Trusting Delegator (assumed).
**Date:** 2026-08-11

## Journey steps

| # | Step | What the brief says / doesn't say |
| :-- | :-- | :-- |
| S0 | Arrival — sprint scoped, `/delivery:handoff` offers `attractor` as a third runner | Specified |
| S1 | Precondition check — is `attractor` installed? | **Undesigned** — Open Question 6 |
| S2 | Compilation — dependency graph + per-story criteria compiled into a checkable validation | Specified as a mechanism; write location unstated |
| S3 | Operator sees/approves the compiled artifact before execution? | **Undesigned** — not addressed anywhere |
| S4 | Handoff crosses to attractor's own agents | Specified; attractor's own output-path convention unstated |
| S5 | Gate runs, passes, next story | Specified |
| S5b | Gate fails → fix step → gate re-runs | Specified (the core loop) |
| S5c | Loop fails to converge — no stated retry bound | **Undesigned** — a risk `research.md` already flagged (Argo, Qodo Cover) |
| S5d | A criterion can't be compiled at all — flagged, not gated | Specified in MVP boundary |
| S6 | Run completes — clean finish or named stop | Specified, but doesn't cover the S5c case |
| S7 | Results reach `/delivery:sprint-review` | **Undesigned** — Open Question 2, no re-entry point defined |
| S8 | Operator reviews the report-back | Implied, not specified |
| S9 | Operator returns after being away / cold check-in | Not addressed |

## Per-persona walk (condensed — full transcripts not separately filed; this is the synthesis)

### P-1 — The Unwitnessed Operator

| Step | Noticed | Continue? |
| :-- | :-- | :-- |
| S1 | No stated check — "not knowing which is the tell" | yes, wary |
| S2 | Same "checkable by what" question from their interview, still open | yes |
| S3 | No approval gate — "I've already lost the one checkpoint that would catch a quietly narrowed criterion" | yes, wary |
| S5c | Unbounded loop, checked in mid-run — reads as Argo's/Qodo's risk, live and unattended | **no — kills the run** |
| S7 | "Precisely the seam where Findings A and C already bit me" | yes, wary |
| S9 | No artifact trail — re-deriving context from scratch again | n/a, already stopped |

**Abandoned at step:** S5c (kills the run) · **Went to:** falls back to `generic`, and wouldn't risk a first unattended run at all until S1/S3 are answered.

### P-2 — The Spec-Literal Operator

| Step | Noticed | Continue? |
| :-- | :-- | :-- |
| S2 | "The step I actually care about" — expects per-criterion traceability | yes |
| S3 | "Trusting blind on the one thing the whole pitch rests on" | provisional |
| S5c | Same Argo/Qodo pattern — "can't tell which, without reading the raw run myself" | yes, degraded trust |
| S6 | Flags a real contradiction: "clean finish or honest stop — but S5c has no bound. Which is it?" | yes |
| S7 | "The one that worries me most... my independent re-check might not exist" | yes |
| S9 | "Where this lives or dies" | **effectively no** |

**Abandoned at step:** S9 (compounding S5c + S7) · **Went to:** reverts to checking everything themselves, turn by turn.

### P-3 — The Monorepo Maintainer

| Step | Noticed | Continue? |
| :-- | :-- | :-- |
| S2 | Artifact write-path unstated — "flag raised, hard" | yes |
| S4 | Attractor's own output path undetermined — "sharpest point in the walk... would stop here and go read code first" | yes, high alert |
| S5/S5b/S5c/S5d | "Don't care" ×4 — orthogonal to this persona's concern | yes |
| S9 | The actual verdict moment — checks the file tree | conditional |

**Abandoned at step:** S9, conditionally · **Went to:** hand-migrate and stop trusting the mode, exactly as their prior real incident — only if output lands unscoped.

### P-4 — The Trusting Delegator

| Step | Noticed | Continue? |
| :-- | :-- | :-- |
| S2/S5b/S5d | Invisible — "exactly the kind of step I skim past" | yes |
| S3 | Would glance and click through without evaluating | yes |
| S5c | Real friction — "can't tell stuck from working"; would escalate to a person | yes, uneasy |
| S7 | "No verdict for me to read... worse than a bad verdict" | yes |
| S8 | The step that matters most — pushed directly: "I trust it the same way I trusted the last one that turned out wrong" | yes |
| S9 | Same as S8, zero context | yes |

**Abandoned at step:** none, visibly · **Went to:** n/a — see synthesis below; this absence is the finding.

## Friction map

Ranked by severity = personas affected × blocks-or-annoys.

| Step | Personas reaching | Friction | Abandoned here | Severity |
| :-- | :-- | :-- | :-- | :-- |
| S5c — unbounded retry loop | P-1, P-2, P-3 (indirect), P-4 | Independently the sharpest friction for 3 of 4; P-1 kills the run, P-4 can't distinguish stuck-from-working | P-1 (hard) | **High** |
| S7 — no sprint-review re-entry point | P-1, P-2, P-4 | "No verdict to read is worse than a bad one" (P-4); "my independent re-check might not exist" (P-2) | Contributes to P-2's S9 abandonment | **High** |
| S9 — return after being away | P-1, P-2, P-3 | Where all preceding undesigned gaps compound | P-2 (effective), P-3 (conditional) | **High** |
| S2 — compilation (dual concern) | P-1, P-2 (trust), P-3 (write path) | Two distinct, unresolved questions bundled in one step | — | **High** |
| S3 — no approval gate before execution | P-1, P-2 | "Trusting blind on the one thing the whole pitch rests on" (P-2) | — | Moderate |
| S4 — attractor's own output path | P-3 (acutely), P-1/P-2 (mildly) | P-3's single sharpest moment in the whole walk | — | Moderate, concentrated |
| S6 — completion story contradicts S5c | P-2 | Named logical gap: brief doesn't say what happens when the loop never converges | — | Moderate |
| S8 — report review, unchanged from status quo | P-4 (starkly), all | For the protected persona, this step is *identical* to today | — | **High (by consequence, not visible abandonment)** |
| S1 — install precondition | P-1, P-2 | Noted, doesn't block anyone | — | Low |

## Step value — input to MVP staging

**Load-bearing steps** — remove them and the journey fails for someone.

| Step | Fails for | Why load-bearing |
| :-- | :-- | :-- |
| S2 (compilation) | P-1, P-2 | The one mechanism everyone's trust depends on |
| S5b (the loop) | Everyone | Universally endorsed in both interviews and this walk — nobody objected to the loop shape itself |
| S7 (sprint-review re-entry) | P-1, P-2, P-4 | Without it, the "independent re-check" this whole pipeline is built on doesn't exist for this mode |

**Enhancement steps** — absence annoys but does not block.

| Step | Annoys | Deferrable because |
| :-- | :-- | :-- |
| S1 (install check) | P-1, P-2 | Noted friction, nobody abandoned here |
| S3 (approval gate) | P-1, P-2 | Wanted, but both gave a "provisional continue" rather than a hard stop |
| S4 (attractor's own output path) | P-3 acutely | Real, but answerable later by reading attractor's documented interface, not a delivery-side design decision |

## End-to-end coverage

| Persona | Completes journey? | Blocked at |
| :-- | :-- | :-- |
| P-1 | No, as specified | S5c (kills run); also withholds full trust until S1/S3 resolved |
| P-2 | Nominally yes, effectively no | S9 — compounds S5c + S7 into reverting to manual checking |
| P-3 | Conditional | S9 — binary on whether attractor's output turns out scoped |
| P-4 | Yes, technically | Never — and that is the finding, not a clean result |

**Personas served by no complete path today:** none formally excluded, but P-1 and P-2 both effectively fail the journey as currently specified, and P-4 "completing" it changes nothing about their actual protection — this needs to be a stated choice at PRD stage, not left implicit.

## What simulation likely got wrong

P-4's reactions are the least reliable in this set (fully `assumed` grounding) — a real low-engagement operator might disengage earlier or later than modeled, and might read a "named stop" (S6) differently than a technical persona would. P-3's indifference to the verification mechanism (S5 series) is grounded in one real incident about something else entirely (path scoping) — extrapolating that indifference to the whole loop is a reasonable but unverified inference. Real observation — a live operator actually running this mode once it exists — would settle both.
