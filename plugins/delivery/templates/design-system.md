<!--
BUDGET — target 600 words, hard cap 1000 words. Excludes code, YAML and data tables.
Token and state tables are data and excluded.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.

RULE ID SCHEME — every row below carries a stable `Rule ID` so a later acceptance check
(e.g. `/delivery:sprint-review`) can cite exactly which rule a rendered capture was checked
against, rather than paraphrasing. IDs are never reused, even if a row is removed.
  COLOR-n     — Tokens > Colour
  TYPE-n      — Tokens > Type scale
  SPACING-n   — Tokens > Spacing, radii, elevation, motion
  COMP-<name>-<state> — Components, one per component/state pair
  A11Y-n      — Accessibility
-->

# Design system

> Phase 7 artifact. Owned by Design Lead.
> **Seed from originator:** <verbatim>
> Everything below is marked **seeded** (given) or **inferred** (extrapolated).
> Every row carries a `Rule ID` — see the scheme in this file's header comment — so a
> later acceptance check can cite it directly instead of paraphrasing the rule.
> Last updated: <date>

## Intent

What this should feel like and signal, and to whom. Tie to personas.

| Decision | Serves persona | Signals | Seeded / inferred |
| :-- | :-- | :-- | :-- |

## Existing system

What the codebase already has. Cite real paths. Extending an imperfect existing
system beats introducing a second parallel one.

| Path | What it defines | Extend / supersede |
| :-- | :-- | :-- |

## Tokens

Named with intent, not raw values. Map to real project token names where they exist.

### Colour

| Rule ID | Token | Value | Intent | Project name | Seeded / inferred |
| :-- | :-- | :-- | :-- | :-- | :-- |

### Type scale

| Rule ID | Token | Size / line-height / weight | Use | Seeded / inferred |
| :-- | :-- | :-- | :-- | :-- |

### Spacing, radii, elevation, motion

| Rule ID | Token | Value | Use |
| :-- | :-- | :-- | :-- |

Cover the cases implementers will hit. A missing token is why hardcoded values appear.

## Components

### <Component>

| Rule ID | State | Appearance | Behavior |
| :-- | :-- | :-- | :-- |
| `COMP-<name>-default` | default | | |
| `COMP-<name>-hover` | hover | | |
| `COMP-<name>-focus` | focus | | |
| `COMP-<name>-active` | active | | |
| `COMP-<name>-disabled` | disabled | | |
| `COMP-<name>-loading` | loading | | |
| `COMP-<name>-error` | **error** | | |
| `COMP-<name>-empty` | **empty** | | |

Error and empty are mandatory — they are where design most often supplies nothing
and users most need direction.

## Accessibility

Computed, not asserted.

| Rule ID | Pairing | Ratio | WCAG | Pass |
| :-- | :-- | :-- | :-- | :-- |
| `A11Y-1` | text on surface | 0.0:1 | AA 4.5:1 | |

**Focus indicator:**
**Minimum touch target:**
**Reduced motion:**
**Text scaling policy:**

**Seeded values that fail accessibility:** — state plainly, with the accessible
variant. This is the finding the originator most needs early.

## Deliberately unstyled

Where platform defaults are accepted, so nobody fills the gap with an invention.

## Tensions

Where a choice serves one persona and alienates another — surfaced as a decision,
not resolved silently.
