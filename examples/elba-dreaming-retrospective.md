# Case study: elba-dreaming, run backwards through the pipeline

A retrospective on a real project — [`colombod/elba-dreaming`](https://github.com/colombod/elba-dreaming),
a WordPress migration to a static Astro site — asking what the `delivery` pipeline
would have changed.

**Evidence:** the repo's 23 commits (2026-08-01 → 2026-08-02), `SPEC.md`, `AGENTS.md`,
`DEPLOY.md`. The original build conversation was not available, so this reads the git
history instead — which is arguably better evidence, since it records what actually
happened rather than what was discussed.

**Bias warning:** this is the pipeline's author grading a project the pipeline did not
run on. Retrospectives make every problem look predictable. The final section states
what the pipeline would have cost and what it would *not* have prevented, which is
where the honest limits are.

---

## What actually happened

| # | Commit | Change | Note |
| :-- | :-- | :-- | :-- |
| 2 | `7e0be25` | 29 files, +7454 | scaffold full multilingual site |
| 3 | `0c34311` | 79 files, +216/−72 | real images, pricing, content organisation |
| 4 | `8445e22` | 16 files, +2653/−753 | **apply design system** (after building) |
| 5 | `8777084` | 2 files | fix broken hreflang / language switcher |
| 6 | `97fd34f` | 13 files, +686/−184 | fix pricing script, contact form, i18n QA |
| 7 | `1ba92a0` | **49 files, +1336/−960** | **refactor: move all content to YAML** |
| 8 | `34d329e` | 17 files, +1189 | **add test suites** (after 7 commits of code) |
| 9 | `f7af250` | 10 files, +747 | stay-preview cost estimator |
| 10 | `c150454` | 22 files, +2089 | phone picker, **fix accessibility** |
| 11 | `6ed1187` | 9 files, +835 | full cost breakdown, pet option |
| 12 | `69a29ea` | **38 files, +3058/−236** | **re-align with design system**, offers engine, 9 languages |
| 13–15 | `2062603`… | 24 + 19 files | ja/zh, then Danish — two more language waves |
| 16 | `1612488` | 4 files | carry apartment + dates into contact form |
| 17 | `357f77c` | 1 file, 1 line | **design token violation**, 15 commits after the system landed |
| 18 | `28aea14` | +185 | GoDaddy deploy guide — hosting constraints, documented last |

Shipped in two days. That is fast, and the result is genuinely good — `SPEC.md` is
better retro-documentation than most projects ever write. The question is not whether
this worked. It is which of those deletions were avoidable.

---

## The five things the pipeline targets, found in this history

### 1. The content architecture was decided seventh

`1ba92a0` moved all page content, pricing and images into structured YAML — **49 files,
960 deletions**. It is the single most consequential decision in the project. `AGENTS.md`
now calls it the "golden rule," and two test suites enforce it. It made adding a language
a content-only change, which is why languages 10–12 were cheap.

It was made *after* commits 2, 3 and 4 had already hardcoded content across the site.

`/delivery:architecture` runs before any code and asks one question this project answered
late: *where are the seams?* Content-vs-code is the defining seam of a multilingual
brochure site, and the pipeline's exit criteria force it to be stated with real file paths
before implementation. The 960 deletions are the cost of discovering it by building the
wrong thing first.

### 2. The design system arrived after the design

`8445e22` applied the design system at commit 4, deleting 753 lines of what commits 2–3
had just styled. `69a29ea` re-aligned with it again at commit 12 (38 files). `357f77c`
fixed a raw `rgba` that should have been a token — **15 commits after** the system landed.

This is precisely the loop `/delivery:design` (phase 7, before stories) plus the design
conformance check in `/delivery:sprint-review` exist to close. The design seed you
mentioned wanting to supply is the input to phase 7; tokens then get named in each UI
story, so an implementer never has to reach for a raw value. `357f77c` is one line — but
it is one line that survived fifteen commits of review, which is exactly what an automated
conformance check catches and a human reader does not.

### 3. Accessibility was a fix, not a constraint

`c150454` bundles "fix accessibility" into a feature commit. `/delivery:design` computes
contrast ratios and specifies focus indicators, touch targets and reduced-motion behavior
as **exit criteria** — a design system that fails contrast doesn't pass the gate. The
template makes seeded brand colours that fail contrast a mandatory early finding, because
that is the one accessibility problem that is genuinely expensive to retrofit.

### 4. Tests came eighth

`34d329e` added unit, data-validation, build-integrity and E2E suites in one commit,
after seven commits of implementation. The suites are good — `SPEC.md` names the test
for nearly every criterion, which is unusual and excellent.

But `qa-strategist` exists to block exactly this: its stated push-back list includes
*"we'll add tests later — later means a separate story that gets cut when the schedule
tightens."* Here it wasn't cut, so the cost was low. The pipeline's version puts a test
approach in every story and verifies criteria-first during the sprint.

### 5. The contact form couldn't remember what the user just did

`1612488` — "carry apartment + dates from stay-preview CTA into the contact form" — is
four files and 56 lines. It is also a pure journey-continuity bug: a visitor configures a
stay, clicks the CTA, and has to type everything again.

This is the canonical `/delivery:simulate` finding. The skill's step list explicitly
requires simulating *"what happens after they act"*, and a persona walking that journey
hits the re-entry wall immediately. It took three commits of stay-preview iteration
(`f7af250` → `6ed1187` → `2062603`) before anyone noticed. A ten-minute simulated walk
before building would very likely have caught it.

---

## A live gap the retrospective found

**There is no legacy-URL redirect map, no `.htaccess`, and no sitemap in the repo.**

For a site migrating off WordPress, the old URLs — `/chi-siamo`, `/appartamenti`,
`?p=123`, whatever they were — will now 404. Accumulated search ranking and any inbound
links point at those paths. `DEPLOY.md` confirms deployment is a static `dist/` upload to
GoDaddy with no server-side rewrite layer configured.

I can't verify what the WordPress site's URLs were or how they ranked, so this is a flag,
not a confirmed defect. But it is the kind of requirement that a migration brief should
contain and this repo has no trace of:

- `/delivery:brief` asks what happens today and what it costs to lose it
- `/delivery:research` step 2 covers domain constraints — SEO continuity is one for any migration
- `/delivery:challenge` on the brief would rank "no redirect strategy for a migration" as
  **blocking**, because it is cheap before launch and expensive after

**This is worth checking on the live site regardless of the plugin.**

---

## What the pipeline would have cost

Honesty requires this section.

**Up-front time before any code.** Phases 1–8 produce eight documents. For a two-day
brochure site with one stakeholder who is also the implementer, that overhead is real and
could plausibly have exceeded the rework it saved. The pipeline is designed for work where
being wrong is expensive; a personal site where the owner can just look at it and say
"no, redder" is close to the worst case for it.

**Scale mismatch.** `/delivery:personas` wants 3–5 evidence-graded personas. For a
vacation rental with no analytics and no existing customer base, every one would be graded
`assumed` — and the pipeline's own honesty rules would then correctly state that
prioritisation rests on invented users. That is the right label, but it means the persona
phases would have generated hypotheses, not validated anything.

**What it would not have prevented.** The three language waves (9 → +ja/zh → +da) look
like scope creep in the log but are more likely genuine discovery about the guest mix — no
amount of up-front planning invents Danish demand. Most of the stay-preview iteration is
taste, and taste converges by looking at the thing. `/delivery:research` might have
surfaced the guest-nationality question earlier via booking-platform data, but that is a
maybe, not a claim.

**Where it would have paid.** The YAML refactor (49 files) and the two design-system
realignments (54 files combined) are the avoidable ones — roughly 1,700 deleted lines
attributable to sequencing decisions after implementation rather than before. Those are
architecture and design gates, phases 7 and 8, and they are cheap to run.

---

## How this project would run today

```
/delivery:brief    migrate elbadreaming off WordPress to a static site,
                   preserving search ranking and existing inbound links
/delivery:research → prior art on static WP migrations; SEO continuity as a
                     domain constraint; GoDaddy static-only hosting found NOW,
                     not at commit 18; Astro/Eleventy as candidates, no winner
/delivery:personas → guest segments from booking-platform review data if any
                     exists — graded honestly, likely mostly `assumed`
/delivery:simulate → walk browse → price → enquire, including "what happens
                     after they act" → catches the contact-form re-entry
/delivery:prd      → FR/NFR with IDs; redirect map as a hard requirement
/delivery:challenge → "no redirect strategy" flagged blocking, recorded open
/delivery:prioritize → MVP = one guest can find, price and enquire end to end
/delivery:design    → your claude.ai/design seed → tokens + contrast computed
                      BEFORE the site is styled, not at commit 4
/delivery:architecture → content-in-YAML declared as the seam, day one
/delivery:roadmap  → cost reconciliation: is 12 languages an MVP item?
/delivery:stories  → each naming real token names
/delivery:sprint   → implement the wave
/delivery:sprint-review → criteria re-verified against code; personas walk the
                          real site; token bypasses caught at 1 line, not 15 commits
```

The honest summary: this pipeline would have saved roughly two commits of structural
rework and caught one live SEO gap, at the cost of a planning pass that a two-day solo
project may not have wanted. It gets more valuable as the cost of being wrong goes up —
more people, more integration, less ability to just look at the result and know.
