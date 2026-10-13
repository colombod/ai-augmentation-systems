---
name: claim-harvesting
description: "The discipline of extracting the load-bearing claims a changeset makes — explicit (commits, PR, docs, and highest-yield docstrings/comments) and implicit (what the change exists FOR, even unstated). Use when harvesting or typing claims for the claim-guard gate, or whenever you need to turn a change into a checklist of assertions to verify."
---

# Claim Harvesting

A claim you never wrote down is a claim nothing will verify. Harvesting is the load-bearing first
move of the gate: its output bounds everything downstream. Every escaped blocker in the incident
that motivated this system was a place where a *belief* — stated or merely held — was confidently
false.

## Two harvests, UNIONed never intersected

- **Explicit** (`claim-harvester`): what the change *says* it does.
- **Implicit** (`purpose-inquisitor`): what the change *exists for*, even when unstated.

Run them **cold and independent**, then UNION. Inference can only **add** claims; it can never
remove one the explicit harvest found. Intersection would silently drop the most valuable claims —
the implicit safety ones nobody wrote down.

## Explicit sources, in yield order

1. **Docstrings and inline comments in the changed code — HIGHEST YIELD.** Comments encode the
   author's *belief*. `# idempotent MERGE makes replay a no-op` is a claim. The confidently-false
   comment sits right next to the wrong line more often than anywhere else.
2. **Commit messages** — the change's own summary.
3. **PR / branch description** — the narrative told to reviewers.
4. **Linked design / spec docs** — the promises the change was meant to keep.

Read the actual sources (`git log`, `git diff`, Read, Grep). Never reason from priors about what a
change "probably" claims.

## Implicit inference: from purpose to promised property

For each change ask, in order:
1. **What breaks in the world if this change didn't exist?** → the condition it manages.
2. **What must stay true while that condition is handled?** → the implicit claim.
3. **Is that a safety/integrity property** (corruption / loss / inversion / staleness)? → then it is
   almost certainly load-bearing and almost certainly untested (tests covered the liveness the
   commit mentioned, not the integrity the change was *for*).

Ground every inferred claim in a specific **basis** (the exact thing you derived it from). A prior
design-review verdict is a rich source: each addressed FAIL/CONCERN is an implicit claim that "the
concern was handled in the code" — exactly the promises made in prose and under-delivered in source.

## What counts as load-bearing

Keep claims whose falseness would matter: guarantees, prevention, bounds, invariants, coverage.
Discard prose that asserts nothing testable ("cleaned up", "improved readability").

## The claim contract (shared source of truth — both harvesters obey it)

> This is the **single contract** the `claim-harvester` and `purpose-inquisitor` both follow, and it
> is co-designed with the ledger's text normalizer (the stable-claim-id hash). It exists so the
> *same* underlying claim decomposes and phrases the *same* way every run — otherwise it hashes to a
> different id and the run-to-run matrix diff breaks. **Do not let this drift from the normalizer:**
> the boilerplate you omit here is exactly what the normalizer strips; the meaning-critical words
> you keep here are exactly what it preserves.

> **The prompt prong carries reproducibility alone** — determinism cannot lean on sampling. The two
> rules below are therefore **hard and mechanical, not guidance**: a required *grid* fixes the claim
> SET (count + which claims), and a rigid *template* fixes each claim's exact TEXT and TYPE. Same
> changeset → same grid → same templated claims → same claim ids.

### Rule 1 — GRANULARITY: build the (mechanism × property) grid FIRST (mandatory output step)

**Before writing any claim text**, produce the grid — this is a required, explicit step, not a
mental note:

1. **Enumerate the changed mechanisms** = the concrete symbols the diff adds/edits: function, class,
   method, and field/parameter names (e.g. `schema_health`, `max_delete`, `_handle_exhausted_batch`,
   `iteration_count`). Take them **verbatim from the diff** — they are line-stable discriminators and
   the only source of per-claim specificity in the template. Do not invent mechanisms; do not omit a
   changed one.
2. **Cross each mechanism with the property enum** (exactly these seven, no others):
   `corruption`, `loss`, `inversion`, `staleness`, `bound_quantity`, `idempotence`, `coverage`.
3. **Emit EXACTLY ONE claim per OCCUPIED cell** — a cell is occupied iff the change makes a
   load-bearing promise about that (mechanism × property). No more, no less. **The grid IS the claim
   set** — this is what makes the count reproducible run-over-run.

**Atomicity check (per cell):** *"Can ONE counter-case falsify exactly this cell and nothing else?"*
If falsifying a candidate needs **two independent counter-cases**, it is two cells (split). A single
mechanism whose single load-bearing line enforces one property is **one** cell even if the source
sentence is compound. Two different mechanisms guarding the same property are two cells (the symbol
differs). Multiple *code paths* into ONE mechanism guarding ONE property are **one** cell — path
coverage is the chokepoint-mapper lens's job, not a second claim.

**Worked example (grid from a diff hunk).** Diff adds a validator on `max_delete` and a
`schema_health` read that is *missing* on the write path:
```
- def apply(max_delete: int | None = None): ...
+ def apply(max_delete: int | None = Field(default=None, ge=1)): ...   # symbol: max_delete
  def _write_batch(...):                                               # symbol: _write_batch
+     # (no schema_health read here)
```
Mechanisms = {`max_delete`, `_write_batch`}. Occupied cells:
- (`max_delete` × `bound_quantity`) — it promises to cap the count → **1 claim**
- (`max_delete` × `inversion`) — it promises a hostile value can't invert the cap → **1 claim**
- (`_write_batch` × `corruption`) — the write path promises not to corrupt while degraded → **1 claim**
Three occupied cells → exactly three claims, every run.

### Rule 2 — PHRASING: the rigid claim template (fixes text AND type per cell)

Every claim's `text` MUST be **exactly** this three-slot template — present tense, active voice,
symbol first, nothing else (no adjectives, no negation words, no free-form restatement):

```
<mechanism_symbol> <controlled_verb> <controlled_property_object>
```

The `<verb>` and `<property_object>` are **NOT free** — they are fixed by the cell's property via
this closed table (this is the whole degrees-of-freedom reduction). Choosing the cell fixes the
predicate **and** the claim `type` simultaneously:

| property (cell) | controlled_verb | controlled_property_object | claim `type` | example `text` |
|---|---|---|---|---|
| `corruption` | `preserves` | `integrity` | `safety` | `_write_batch preserves integrity` |
| `loss` | `persists` | `writes` | `safety` | `flush_barrier persists writes` |
| `inversion` | `rejects` | `inversion` | `safety` | `max_delete rejects inversion` |
| `staleness` | `refreshes` | `state` | `temporal` | `schema_health refreshes state` |
| `bound_quantity` | `caps` | `quantity` | `quantitative` | `max_delete caps quantity` |
| `idempotence` | `deduplicates` | `effects` | `concurrency` | `iteration_count deduplicates effects` |
| `coverage` | `covers` | `behavior` | `coverage` | `tag_legacy_pooled_iterations covers behavior` |

- **Controlled verb set (closed — the ONLY verbs allowed in `text`):**
  `preserves`, `persists`, `rejects`, `refreshes`, `caps`, `deduplicates`, `covers`.
- **Controlled property-object set (closed — the ONLY objects allowed in `text`):**
  `integrity`, `writes`, `inversion`, `state`, `quantity`, `effects`, `behavior`.
- **`<mechanism_symbol>`** is the exact diff symbol. Backtick it or not — the normalizer folds a
  backticked span and a bare `snake_case`/`camelCase` token to the same code token, so both converge.
- **Type is fixed by the property**, per the table's `type` column. The safety-typing bias is
  expressed *through the property choice*: if the forbidden violation is a corruption / loss /
  inversion harm, pick that property → the type is `safety` automatically. Do not re-decide the type
  freehand — the id hash includes `type`, so free-typed variance would fork the id.

> **Why this is byte-canonical against the normalizer.** The template contains only a code symbol +
> two plain lowercase tokens, none of which are fillers and none of which the normalizer stems or
> reorders. So both `max_delete caps quantity` and `` `max_delete` caps quantity `` normalize to
> exactly `max_delete caps quantity` — the template normalizes to itself (modulo symbol casefold).
> Mentally verify any claim before emitting: its three tokens should survive normalization unchanged.

**Specificity lives in the un-hashed fields, not the text.** The template `text` is terse on purpose
— it is the *identity anchor*. The concrete detail (the exact line, the counter-value, the belief)
goes in `quote` (explicit) / `basis` (implicit) and `source` (`file:line`), which are **excluded**
from the claim-id hash and so cost no reproducibility. The downstream verifier reads the real code
anyway.

### The canonicalization pass (second pass — mandatory, cheap)

Do not emit the template one-shot from prose; that is where free-form phrasing leaks back in.
Instead, for each occupied cell, run this short pass **before** emitting the claim:
1. **Draft** the claim in your own words while reading the source (find it).
2. **Map** it to its `(mechanism × property)` cell — name the symbol and the single property.
3. **Rewrite** to the template using the fixed tables above (verb + object + type from the cell).
4. **Re-check** the rewrite still denotes that exact cell (symbol correct, property correct) and that
   its three tokens normalize unchanged. Only then emit it.
Two runs that reach the same cell therefore emit the same three tokens and the same type → the same
claim id, by construction.

### Suppression guard (do not let the grid drop a real claim)

The grid's risk is the mirror of over-collapse: a real claim lost because no cell was drawn for it.
Two mandatory safeguards:
- **A missed changed symbol is a missed claim.** Enumerate mechanisms mechanically from the diff;
  never skip a changed function/class/field.
- **A load-bearing claim that fits NO property cell is FLAGGED, never silently dropped.** If a change
  makes a real promise that none of the seven properties captures, record it with the nearest
  property **and** note the mismatch in `quote`/`basis` so the human sees it at Gate A. Do not invent
  an eighth property (that reintroduces the variance this rule exists to remove), and do not discard
  it as "doesn't fit."

### This contract and the normalizer are bound together

The normalizer lives in the plugin's ledger (`ledger/src/identity.ts`) and its behavior is pinned by
`ledger/test/identity.test.js`: negation, modals, quantifiers, and numbers are never stripped;
articles/copula and known boilerplate lead-ins fold away; code symbols are preserved atomically. If
you change the controlled vocabulary here, verify the templates still normalize to themselves
against those tests in the **same** change.

## Typing — and the safety bias

Type each claim: `correspondence | safety | quantitative | temporal | concurrency | coverage`. The
type drives lens routing and the gate's second limb.

**Bias toward `safety`:** when a claim contains prevention/integrity language — *prevent, cannot,
won't, never, no <bad thing>, guard, ensure no, refuse* — default it to `safety`. A false `safety`
costs one extra check; a safety claim mistyped as `correspondence` silently escapes the strongest
gate limb. Bias toward the stricter limb.

## The zero-claim rule

If you find no claims, say so explicitly — never invent them. A zero-claim harvest becomes an
**INDETERMINATE** gate result, never a PASS. An empty checklist is a harvest failure, not a clean
bill of health. Note where you looked so the human can supply a commit message or linked doc.
