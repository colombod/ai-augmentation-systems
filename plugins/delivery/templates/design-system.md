# Design system

> Phase 7 artifact. Owned by Design Lead.
> **Seed from originator:** <verbatim>
> Everything below is marked **seeded** (given) or **inferred** (extrapolated).
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

| Token | Value | Intent | Project name | Seeded / inferred |
| :-- | :-- | :-- | :-- | :-- |

### Type scale

| Token | Size / line-height / weight | Use | Seeded / inferred |
| :-- | :-- | :-- | :-- |

### Spacing, radii, elevation, motion

| Token | Value | Use |
| :-- | :-- | :-- |

Cover the cases implementers will hit. A missing token is why hardcoded values appear.

## Components

### <Component>

| State | Appearance | Behavior |
| :-- | :-- | :-- |
| default | | |
| hover | | |
| focus | | |
| active | | |
| disabled | | |
| loading | | |
| **error** | | |
| **empty** | | |

Error and empty are mandatory — they are where design most often supplies nothing
and users most need direction.

## Accessibility

Computed, not asserted.

| Pairing | Ratio | WCAG | Pass |
| :-- | :-- | :-- | :-- |
| text on surface | 0.0:1 | AA 4.5:1 | |

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
