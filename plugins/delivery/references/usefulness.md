# Usefulness: is a feature worth using, for someone who did not build it

The method is adapted from Michael Jabbour's Worth Using skill
(https://github.com/michaeljabbour/amplifier-skill-worth-using, MIT), rewritten for the delivery
plugin: the rubric and the evidence rule are his; the wiring into sprint review and retirement is ours.

Rate a feature, or the whole product, for **one named user and one recurring job**, agreed in one
sentence before anyone rates. Six criteria, each Missing, Partial or Solid, and each with its own
evidence grade. **Never add them into one score**: a total hides the criterion that is failing.

| Criterion | The question | Missing | Partial | Solid |
| :-- | :-- | :-- | :-- | :-- |
| Job | Who is it for, and what recurring job does it do for them? | "anyone who…" | a role, and a job they sometimes have | a named person in a setting, a weekly job, and what it costs them today |
| First value | Can a stranger get one real result alone, in their first session? | needs the builder in the room | works with docs or a second try | alone, first session, their own input |
| Fit | Does it meet them where they already work? | a new place, habit and data | one new thing to learn or keep | their tools, inputs and rhythm |
| Outcome | What is different for them afterwards, in their words? | "it's faster" | an output they can point to | a change they name unprompted |
| Trust | When it is wrong, can they tell and recover? | fails silently or confidently | fails loudly; recovery needs the builder | shows its limits; errors visible and undoable |
| Return | Do they come back without being asked? | used once, for the demo | used again when reminded | used again unprompted, and they would miss it |

## Evidence

- **Claimed**: the team says so, or it was inferred from code, docs, a demo or a test run. Reading the
  code, and a Reality Checker pass on the team's own surface, are Claimed, never Seen.
- **Seen**: someone outside the team was observed using it, or gave a specific, dated account of a use.
- **Repeated**: that person, or others like them, used it again unprompted, shown in logs or their own
  account.

A rating is only as strong as the evidence someone can point to. When raters differ, do not average:
record the spread; the rating stands at the strongest evidence anyone can name, and the lowest of
equals.

## Zones

- **Stranger-ready**: Job, First value, Fit, Outcome and Trust all Solid, each at least Seen.
- **Worth using**: stranger-ready, and Return Solid and Repeated.

Short of a zone, name the criteria holding it back and the next step that would move each one. Return
takes days, not minutes: when a review ends short of it, write the return check (who, when, what counts
as coming back) and stop.

**Subtract first.** Before a fix that adds, ask what could be removed instead. Two jobs in one feature
(every user wants something different from it) is a split, not a missing feature.

## The card

```
USEFULNESS CARD · <feature or product> · <date> · at <commit>
User + job    <named person, setting> · <recurring job> · costs them <...> today
Job           <Missing|Partial|Solid> · <Claimed|Seen|Repeated> · <one line>
First value   <...> · <...> · <time and steps to a first real result, alone>
Fit           <...> · <...> · <what is new to them, if anything>
Outcome       <...> · <...> · <the change, in their words>
Trust         <...> · <...> · <what happens when it's wrong>
Return        <...> · <...> · <what is known about coming back>
Zone          Stranger-ready <met | not: which criteria> · Worth using <met | not>
Return check  <who> · <when> · <what counts as coming back>
Cut           <what was removed this round, or "nothing">
```

## When a feature becomes a retirement candidate

A feature is a candidate when its Return is not Solid and Repeated after **two return checks**, both
backed by the product's own logs or the users' own accounts. **No logs means instrument the feature
first, never retire it**: absence of evidence is not evidence of non-use. A candidate goes to the
owner with its two cards and `map.js retire <feature>` (what deleting it would free, and what other
features still need), as an irreversible decision they record. Nothing is deleted on a card alone.
