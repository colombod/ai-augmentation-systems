<!--
BUDGET — target 1000 words, hard cap 1600 words. Excludes code, YAML and data tables.
Scenario and requirement tables are data.
-->

# PRD: feature map, from what is shipped to blast radius to retirement

> Written by /delivery:prd. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft (steps 1 to 5 run; not challenged) · Last updated: 2026-10-24
> Brief: `.delivery/initiatives/feature-map/brief.md` (revision 2 plus owner quotes 4 and 5, at `57a2788`)
> Measured at: `57a2788b2221466ae1614a462c4684a7d0958c79` (HEAD of `delivery-feature-map`). Earlier figures keep their own SHA.
> **Word count:** WORDCOUNT

## Summary

A map, built from git objects at a named commit, of what each plugin ships, what backs it and how
it integrates; a feature register; `impact` for a story, feature or commit; a ready-gate warning; a
staged retire path; later, the product-inventory views of owner quote 4 (S-11 to S-16). For the
Product Manager and Delivery Manager. No operator record exists: every **default** stands in for one.

**Binding constraint** (owner quote 5, verbatim): "That inventory MUST always be up to date, fresh
and real . Noise , hallucination and incorrect claims in that detail the entire product delivery".
Every requirement below is read through it. An inventory fact names its source (commit, path,
line, matched text, rule); an answer about a commit other than the one mapped is rebuilt or
refused, never served; no model-written text is stored as a fact; what the extractor cannot see is
listed, never filled in. S-17 and FR-40 to FR-45 make this checkable.

| Scenario | Proposed stage (step 6 cuts) | Source |
| :-- | :-- | :-- |
| S-1 to S-8, S-17 | MVP | brief MVP 1-5; owner quote 5 |
| S-9, S-10 | ship alone, first | brief F2, F4 |
| S-11 relations, S-12 business impact, S-13 compounding selection | stage 2 | owner quote 4; `plan.js:79-90` |
| S-14 consolidation, S-15 tech debt, S-16 persona analysis | stage 3 | owner quote 4 |

## Goals and non-goals

**Goals**

- Before code: what is shipped, what backs it, what a change or removal reaches.
- Every answer names its resolved commit, its evidence and its blind spots.
- Catch the `6883fee` shape of runtime reach.
- Relate features to each other, to personas and to value.

**Non-goals**

- Refusing at gates on reach: gates warn (**default**, OQ 2). Refusing a stale or unsourced *answer* is a goal, not a gate.
- Deleting code; any combined score.

## How criteria are checked

Every criterion below names a check, a fixture and a surface. **Surfaces are proposed**: no
`surface.json` exists for this initiative until `/delivery:architecture` step 7 writes it (OQ 17).

| Check | Meaning |
| :-- | :-- |
| test | a real child process on the named surface, asserting stdout, stderr and exit code |
| checker | `map verify` (FR-42) re-derives the stored output at its commit and diffs |
| mutation | the behaviour is broken on purpose and the named test must turn red |
| observe | a reality check in a real role session, recorded with its transcript |

| Surface (**proposed**) | What the customer runs |
| :-- | :-- |
| S1 | the map CLI, `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js ...`, in a Claude Code session |
| S2 | `ready.js` (ready gate) |
| S3 | `reviews.js` merge gate |
| S4 | `plan.js select` |
| S5 | `/delivery:realign` |

| Fixture | Contents |
| :-- | :-- |
| hist@C | full clone of this repository pinned at commit C; never the working tree |
| shallow | `git clone --depth 1` of hist |
| dirty | hist@`57a2788` with one modified and one untracked file |
| fx-wire | one script wired twice under one event in `hooks.json` |
| fx-blind | a `.py` file, a malformed `hooks.json`, one `.ndjson`, one extensionless script, one basename shared by two plugins |
| fx-anchor | a registered feature; one commit deletes an anchor, one renames it |
| fx-waves | area A with wave 1 and 2 verified, a story of wave 1 merged `x.js`; area B with feature F |
| fx-merge | story declares `a.js`, `c.js`; PR merges `a.js`, `dist/b.js`; a second PR at the 3,000-file cap |
| fx-retire | features with exclusive and shared files, a usage-source stub, the 2026-08-10..14 ledger gap, decision records scoped `bead:<id>` and `label:irreversible`, an unmerged branch and an open PR stub referencing a file |
| fx-pairs | features A, B sharing non-hub `x.js`; persona files with `grounding` and `status` |
| fx-force | a confirming SHA made unreachable by a force-push |
| bd-stub | `bd` is absent here; bead-dependent criteria run on a stub (thin, OQ 18) |

## Measured baseline

| Measure | `57a2788` (HEAD) | Earlier |
| :-- | :-- | :-- |
| Files under `plugins/` | 562 | 562 at `7746e27`; 558 in `research.md` (SHA not recorded) |
| Shipped entry points | 71: delivery 52, claim-guard 15, attractor 4 | same at `7746e27` |
| Typed edges | 1,654 | same at `7746e27` |
| Build time, spike `summary` | 2.56, 2.57, 2.68 s (3 runs, this container, wall clock) | 2.77-2.89 s at `7746e27` (BA); 3.1 s in `research.md` |
| Backing files at fan-in 20 or more | 20 | same at `7746e27` |
| Files tied at the top fan-in, 27 | 14 (spike `summary` prints 12: D-7) | 14 at `7746e27` |
| Dangling shipped reference | 1: `claim-guard/.mcp.json` serves `dist/claim-ledger.js`, not in git | same at `7746e27` |
| Files the spike never analyses | 24 of 562: ndjson 7, jsonl 7, dot 7, sh 1, `bd`, `gh` | same set at `7746e27` (BA) |
| Replay `6883fee` | 2 features, both `record-invocation` hooks; 0 with runtime reach off | fixed commit, HEAD-independent |
| Sweep, last 255 non-merge commits touching `plugins/` | SWEEPHEAD | SWEEPOLD |

HEAD differs from `7746e27` only in `brief.md` (4 commits), which the spike classes as a record,
not shipped: the graph is unchanged, as measured.

## Spike defects the architecture must address

The spike (`spikes/map-spike.js`, `spikes/sweep.js`) is evidence, not a design. Each defect is a
false absence or a false edge the real extractor must not have.

| # | Defect | Evidence (re-run at `57a2788`) | Consequence | Requirement |
| :-- | :-- | :-- | :-- | :-- |
| D-1 | Prints the ref, not a SHA; `impact --commit ""` maps HEAD and reports 0, exit 0 | `mappedAt: "6883fee^"`; `mappedAt: "HEAD"` | an answer cannot be tied to a commit; an empty input reads as "no reach" | FR-1, FR-15, FR-41, NFR-F1 |
| D-2 | Merge commit read with `git show --name-only` | `ca0b215`: 1 file; first-parent diff 35 | 34 changed files invisible | FR-15 |
| D-3 | Rename lists the new name only | `e84618b`: `R100 scripts/test/bd -> scripts/testing/bd` | removal of the old path never counts | FR-7, FR-15 |
| D-4 | Textual filter drops files unreported | 24 of 562 (table above) | blind spots silent | FR-4, NFR-P5 |
| D-5 | Ambiguous script basenames and malformed JSON skipped; no blind-spots output | BA, step 2 | false absence of an edge | FR-4 |
| D-6 | Runtime rule matches file names, not discovered directories | 16 patterns include `.lock`, `.gitignore`, `.config`, `.local` (~4 false) | false runtime edges, noise | FR-11, NFR-P4 |
| D-7 | `summary` truncates hubs to 12 (`map-spike.js:277`, `slice(0, 12)`) | 14 files tie at 27; QA's "12 tie" read the truncated list | the hub set is understated | FR-12, FR-4 |
| D-8 | Sweep excludes merges (`sweep.js:10`, `--no-merges`) and reads `git show --name-only` | `sweep.js:10,14` | the noise baseline omits merges | NFR-P2, FR-45 |
| D-9 | Edge evidence is synthesised (`import ./x`), with no line | QA, step 3 | evidence cannot be checked against the file | FR-2, NFR-F1 |

## User scenarios

No persona was built for this initiative; each fit is inferred.

| Persona | Grounding | Why reached |
| :-- | :-- | :-- |
| P-3 The Monorepo Maintainer | reported | `6883fee`: one plugin broke another |
| P-1 The Unwitnessed Operator | observed | the 23 h ledger stop fell between check-ins |
| P-2 The Spec-Literal Operator | observed | every edge must trace to file and matched text |
| P-4 The Trusting Delegator | assumed | a green `impact` without blind spots is a false verdict |

### S-1: What is shipped, what backs it, how it integrates

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager, for P-3 | a brief or PRD needs the shipped surface | git history; no product checkout (F6) | a view naming the resolved 40-hex commit |

1. Asks for the shipped view at a commit or ref; the map resolves it and prints the SHA.
2. Reads entry points per plugin by kind, backing files, typed edges with evidence, dangling references, blind spots.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no `plugins/` tree: zero entry points, stated; empty commit argument refused |
| Very large input | builds; file count and time printed (NFR-1) |
| Duplicate / already exists | one script wired twice under one event: both listed |
| Concurrent modification | built from git objects; dirty working tree counted, never read (NFR-F4) |
| Permission denied | no product checkout: read from the project repo |
| Resource missing mid-operation | unknown commit: refused, non-zero exit |
| Partial failure | unparseable `hooks.json` or `.mcp.json`, unknown extension, ambiguous basename: each named under blind spots |
| Timeout / retry | n/a |
| Undo / correction | n/a: read-only |
| Ref instead of SHA | resolved; output carries the 40-hex SHA |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-1 | test | hist@`7746e27`, hist@`57a2788`; fx-wire | S1 | 71 entry points (52/15/4) at both; fx-wire lists 2 entries; output SHA is 40-hex and equals `git rev-parse` of the argument |
| FR-2 | checker | hist@`57a2788` | S1 | every edge's evidence equals the text at its path and line at that commit; 0 mismatches |
| FR-3 | test | hist@`57a2788`; same with `dist/claim-ledger.js` committed | S1 | listed dangling; not listed once committed |
| FR-4 | test | fx-blind; hist@`57a2788` | S1 | blind spots name each fx-blind file with its reason and always list the undetected shapes (env var, cwd, glob); at `57a2788` analysed + blind = 562 |
| FR-5 | test | hist@`57a2788` as product repo | S1 | `git status --porcelain`, `git show-ref`, `git stash list` identical before and after a build |

### S-2: The feature register and its single write path

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager (**proposed**, OQ 6) | shaping names a capability ("the invocation ledger") | S-1 builds; the area exists | the feature appears in every later `impact` reaching its live anchors |

1. Takes seed candidates from entry points and merged history, never story tables (R-brief-5).
2. Registers id, name, one area (**default**, OQ 1), entry points, personas served; each field is marked extracted (rule id) or declared (declarer, record id).
3. The script confirms each anchor at a resolved commit.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no entry points: refused |
| Very large input | n/a |
| Duplicate / already exists | same id: refused. Entry point in another feature: accepted, reported shared (**proposed**, OQ 9) |
| Concurrent modification | write against an older register version: refused with reason, never merged silently (NFR-6) |
| Permission denied | direct edit refused by the lane, naming the script |
| Resource missing mid-operation | anchor absent at the commit: refused. Gone later: marked stale at that commit, kept. Renamed: stale, never retargeted silently |
| Partial failure | one of three anchors missing: whole write refused |
| Timeout / retry | same content retried: no-op |
| Undo / correction | a superseding row; history kept |
| Model-written seed text | stored as declared with its declarer, never as extracted |
| Confirming SHA unreachable after force-push | anchor reported "unverifiable" (NFR-F3) |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-6 | test, then observe | each role in `roles/*.md`; one real role session | S1 | the lane hook denies a direct Edit to the register for every role; the script write lands; the session transcript shows the denial |
| FR-7 | test | fx-anchor | S1 | deleted anchor reads `stale@<40-hex>`, row kept; renamed anchor reads stale, old path unchanged |
| FR-8 | test | hist@`57a2788` | S1 | register bytes unchanged after seed; accepting one candidate adds exactly 1 row; paths found only in story tables never offered |
| FR-9 | test | fx-waves | S1 | duplicate id refused; empty area refused; area without `areaReason` warns, exit 0 |

### S-3: Impact of a story, before code

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager, for P-1 | a story is drafted or brought to ready | map at the story's base commit | a prediction, carrying the map SHA and the Files-table hash, recorded where the ready gate reads it |

1. Runs `impact` on declared paths, planned creates included.
2. Reads features, areas, verified waves, chains, hubs apart, blind spots.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no Files table: "no prediction", never "no reach" |
| Very large input | a hub: listed apart, excluded from counts |
| Duplicate / already exists | two spellings count once (FR-27) |
| Concurrent modification | map built at another commit than the story's base: rebuilt (~2.6 s at `57a2788`), or refused "stale: map X, base Y" (NFR-F2) |
| Permission denied | n/a |
| Resource missing mid-operation | prose row: listed unresolved |
| Partial failure | planned create: runtime reach only, stated |
| Timeout / retry | n/a |
| Undo / correction | re-run replaces the prediction |
| Path outside mapped scope | "outside mapped scope", never 0 |
| Zero reach | printed with its blind spots |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-10 | test | hist@`7746e27` | S1 | `modify plugins/delivery/skills/brief/SKILL.md` reaches exactly {`delivery:brief`} |
| FR-11 | test | hist@`6883fee^` | S1 | `create plugins/attractor/.delivery/x.md` reaches exactly the 2 `record-invocation` hooks, chain citing `path.join(dir, '.delivery')`; `modify` inside an existing `.delivery/` gives no runtime reach |
| FR-12 | test | hist@`57a2788` | S1 | with `--hub-threshold N` (parameter, OQ 7), every file at fan-in N or more is listed as hub and counted in no feature total; with N=27, 14 hubs |
| FR-13 | test | story fixture whose only row is prose | S1 | prints "unresolved: <row>" and "no prediction"; never "0 features" |

### S-4: Impact of a feature

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager, before reshaping or retiring | a change names a feature | registered | shared and exclusive are separate lists |

1. Runs `impact` on the feature id; reads shared files per relation type, and exclusive files.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | unknown id: refused, nearest ids listed |
| Very large input | hubs apart |
| Duplicate / already exists | shared by `uses` with one, `mentions` with another: both named |
| Concurrent modification | stale anchor: reported stale, excluded from reach and from the exclusive set |
| Permission denied | n/a |
| Resource missing mid-operation | retired feature: reported with stage |
| Partial failure | n/a |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-14 | test | hist@`7746e27`; fx-anchor | S1 | `record-invocation.js` appears in shared[`uses`] with the `PostToolUseFailure` hook, not in exclusive; fx-anchor's stale anchor is in neither list |

### S-5: Impact of a commit

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager, for P-2 | a commit lands | full history | a change behind a verified wave names it (F10) |

1. Runs `impact` on the commit, mapped at its first parent; reads features, areas, verified waves reached.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | nothing under `plugins/`: 0, stated; empty argument refused |
| Very large input | `6883fee`, 82 files: completes |
| Duplicate / already exists | n/a |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | root commit: refused; shallow clone: refused |
| Partial failure | merged files per story unrecorded: declared files used, stated |
| Timeout / retry | n/a |
| Undo / correction | n/a |
| Merge commit | first-parent diff (D-2) |
| Rename | old path counts as removed (D-3) |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-15 | test | fx-waves; hist@`ca0b215`; hist@`e84618b`; shallow | S1 | changing `x.js` names "wave 1 of A", a change outside it names none; `ca0b215` reports 35 changed files; `e84618b` counts `scripts/test/bd` removed; shallow refused |

### S-6: Replaying a past break

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager, for P-3 | a break is found, or an extractor rule changes | the breaking commit is known | every replayed incident has a row carrying the rule-set hash |

1. Replays the commit; records caught, or the reach shape missed, with the extractor rule-set hash.
2. On any rule-set change, every row is re-run (NFR-P1).

| Case | Expected behavior |
| :-- | :-- |
| Empty input | n/a |
| Very large input | n/a |
| Duplicate / already exists | re-replay replaces the row |
| Concurrent modification | rule set changed since the row: row marked out of date until re-run |
| Permission denied | n/a |
| Resource missing mid-operation | shallow clone: refused, saying so |
| Partial failure | undetected shape (environment variable, cwd, glob): recorded as a named gap |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-16 | test (`node --test` regression) | hist@`6883fee^` | S1 | exactly 2 features, both `record-invocation` hooks; the row carries the current rule-set hash; changing any rule marks the row out of date |
| FR-17 | test | hist@`6883fee^` | S1 | with `--no-runtime`: 0 features and "runtime reach disabled" printed |

### S-7: Ready-gate warning across areas and verified waves

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager at `ready.js <bead> --record`, for P-1 | a story is made ready | a prediction, or none | the warning names area or wave, feature and file; the story stays ready |

1. Warns when non-hub reach crosses another area, or reaches a file a verified wave merged (**default** warn, OQ 2, 3).
2. `--record` writes it to the ledger; a later run not finding it resolves it.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no prediction: "reach not computed" |
| Very large input | all hits in `--json`, three in text |
| Duplicate / already exists | not recorded twice |
| Concurrent modification | prediction's map SHA differs from the story's base, or its Files-table hash differs: rebuilt, or "reach not computed: map X, base Y"; never the old prediction |
| Permission denied | builder `--record`: refused as today |
| Resource missing mid-operation | map unreadable: "reach not computed", never silent |
| Partial failure | hub-only reach: no area warning |
| Timeout / retry | n/a |
| Undo / correction | reach no longer crosses: re-record resolves |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-18 | test | fx-waves, bd-stub | S2 | story in A reaching F in B: `--json` has a `warn` naming B, exit 0; reach within A: no such warn |
| FR-19 | test | fx-waves, bd-stub | S2 | reaching a file merged by verified wave 2 of A: `warn` naming "wave 2 of A"; a file no verified wave merged: silent |
| FR-20 | test | fx-waves with map deleted; with map at another SHA; with Files table edited after prediction | S2 | deleted: "reach not computed"; other SHA or hash: rebuilt at the base or "reach not computed: map X, base Y"; the stale prediction is never printed |
| FR-21 | test | fx-waves, bd-stub | S2 | after `--record` the ledger holds exactly 1 row; after the fix and re-record it reads resolved |

### S-8: Retiring a feature

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager at `/delivery:realign`; Chief of Staff to the operator; Delivery Manager writes the story | realign looks for candidates | registered | retired with stage and record; the deletable list names its resolved HEAD |

1. Candidates carry the raw usage query output, window and proof the source was live (R-brief-11); no source: "instrument first" (**default**, OQ 5). A model summary of usage is refused.
2. The operator decides, never inferred (`skills/decision/SKILL.md` B.4), in a record scoped `irreversible`.
3. Stages: retiring (new reach warns), hidden, deleted (a story). Retired in place.
4. A reference check at HEAD lists exclusive files as deletable only when no blind spot covers their directory and no unmerged branch or open PR references them; others "keep the code".

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no usage source: "instrument first", never a candidate |
| Very large input | n/a |
| Duplicate / already exists | already retired: refused, naming stage |
| Concurrent modification | commit between check and deletion: re-check at new HEAD |
| Permission denied | inferred `ans-` cited: refused |
| Resource missing mid-operation | record revoked or superseded: next stage refused |
| Partial failure | exclusive by `uses`, named in a kept skill's prose, an unanalysed file type in the directory, a branch or open PR referencing it: keep the code, reason named |
| Timeout / retry | window overlapping the 2026-08-10..14 ledger gap: not a candidate, gap named |
| Undo / correction | before deleted: a superseding record reverses; after: a new story |
| Deleted entry point | flagged at the next build |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-22 | test | fx-retire | S5 | no usage source: "instrument first"; a window spanning 2026-08-10..14: not a candidate, gap named; a usage field without raw query output: refused |
| FR-23 | test | fx-retire | S5 | refused citing a decision scoped only `bead:<id>`; accepted with `label:irreversible`; same two results with `high_stakes_labels: ["money"]` |
| FR-24 | test | fx-retire | S5 | three register rows, one per stage, in order; skipping retiring or hidden is refused |
| FR-25 | test | fx-retire | S5 | `foo.js` not deletable when a kept skill names it in backticks (naming the skill), when a `.ndjson` sits in its directory, or when the branch or PR stub references it; deletable when none holds |
| FR-26 | test | fx-retire | S5 | `git ls-files` and every blob hash identical after each stage |

### S-9: Path normalisation in `waves.js` overlap

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager at claim (`claimFindings`, R-23) | two in-progress stories name one file two ways (F2) | both claimed | one warning naming the file |

1. `agents/chief-of-staff.md` and `plugins/delivery/agents/chief-of-staff.md` raise `file-overlap`.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no files: no overlap |
| Very large input | n/a |
| Duplicate / already exists | `./x`, `x`, `x/**` match as today; case, trailing slash and `..` normalised |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | short spelling matching two plugins: "ambiguous", never silent |
| Partial failure | n/a |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-27 | test (`node --test`) | two story fixtures; `agents/x.md` in two plugins | claim path via `bd-guard.js` (not in S1-S5, OQ 17) | one `file-overlap` for the two spellings; "ambiguous" for `agents/x.md`; `scripts/waves.test.js` green |

### S-10: Declared versus merged files at merge

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager at the merge gate (`reviews.js`) | a story's pull request merges (F4) | `pr.files` fetched | the merged row carries the reconciliation |

1. Compares declared with merged files, `GENERATED` excluded; warns both ways; records merged files per story.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no `pr.files`: "not reconciled" |
| Very large input | file list at the GitHub cap (3,000): "not reconciled, truncated" |
| Duplicate / already exists | several stories (F12): against their union, stated |
| Concurrent modification | squash or force-push: reconciled against the merged commit's diff |
| Permission denied | n/a |
| Resource missing mid-operation | story file unreadable: "not reconciled", named |
| Partial failure | renamed file: either name matches |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-28 | test | fx-merge | S3 | warns exactly "declared not merged: c.js"; nothing on `dist/b.js`; exit 0; the capped PR reads "not reconciled, truncated" |
| FR-29 | test | fx-merge | S3 | the row records `a.js` against the story; out-of-prediction count is 1 (`dist/b.js` excluded as `GENERATED`... count of non-generated merged files outside the prediction) |

### S-11: How features relate, declared and hidden

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager, for the operator | shaping work on a feature | two or more features registered | coupling with no declared relation is marked hidden |

1. Declares "A builds on B" through the register script (a declared field).
2. Reads, per pair, the declared relation beside implementation coupling (shared non-hub backing files).

| Case | Expected behavior |
| :-- | :-- |
| Empty input | one feature: no pairs, stated |
| Very large input | pairs sharing only hubs: excluded, counted |
| Duplicate / already exists | same declaration twice: no-op |
| Concurrent modification | n/a |
| Permission denied | direct edit: refused |
| Resource missing mid-operation | declared on a retired feature: shown, marked retired |
| Partial failure | n/a |
| Timeout / retry | n/a |
| Undo / correction | a declaration withdrawn by a superseding row |
| Cycle | A on B and B on A: accepted, flagged |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-30 | test | fx-pairs | S1 | the pair reads hidden, citing `x.js` with path and line |
| FR-31 | test | fx-pairs with a declaration and no shared file | S1 | "declared, no coupling found" |

### S-12: Business impact of a bug or a change

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager triaging a `bug` bead, for P-4 | a bug is reported, or a change is proposed | the bug's fixed files, or a commit | "who is affected", in persona and customer-surface names, each sourced |

1. Runs `impact` on the fix's files or commit.
2. Reads features, personas served (grade carried) and customer surfaces reached, each from `surface.json` or a declared register field with its record id.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no fixed files yet: "not computable until the fix", stated |
| Very large input | hubs apart |
| Duplicate / already exists | persona via two features: once, both named |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | feature with no personas: "no persona declared" |
| Partial failure | no `surface.json` and no declared surface: "surface unknown", never inferred |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-32 | test | fx-pairs (F backs `x.js`, serves P-4) | S1 | lists F and P-4 with `assumed`; every persona and surface carries its source file or record id; with no surface source: "surface unknown" |
| FR-33 | test | fx-pairs | S1 | 0 persona grades in output differ from the persona file's `grounding` |

### S-13: Selection that compounds

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager at `plan.js select` | ordering the next work | a story with a fresh prediction; verified features exist | the compounding reason cites files, not titles |

1. Select reads each candidate's predicted reach against backing files of verified-wave features (non-hub).
2. Adds a reason "builds on verified F via `x.js`"; the `builds_on_verified` judge stays advisory beside it.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no prediction: judge only, labelled so |
| Very large input | hub-only overlap: not compounding |
| Duplicate / already exists | n/a |
| Concurrent modification | prediction stale (NFR-F2): not used, labelled so |
| Permission denied | n/a |
| Resource missing mid-operation | judge off: map reason alone |
| Partial failure | map and judge disagree: both shown |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-34 | test | fx-waves with a candidate predicting `x.js`, bd-stub | S4 | its reasons cite `x.js`; a candidate with a stale prediction gets no map reason |
| FR-35 | test | same, judge stubbed to "new area" | S4 | the map reason still appears; no candidate is refused on either |

### S-14: Consolidation candidates

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager at realign | looking for what to consolidate | registered features | candidates with evidence; nothing merged |

1. Lists pairs above an overlap threshold (OQ 13), and entry points with identical backing sets.
2. Raises them for the owner with the shared files.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | none above threshold: stated |
| Very large input | n/a |
| Duplicate / already exists | already raised and declined: not re-raised without new overlap |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | n/a |
| Partial failure | n/a |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-36 | test | fx-pairs with two entry points of identical non-hub backing sets | S5 | raised, listing the set; register and product files unchanged |

### S-15: Tech-debt ranking

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Delivery Manager, with the Product Manager | choosing debt to handle | registered features; full history | no combined score anywhere |

1. Reads per backing file, as separate columns: features carried, personas served, verified waves, fan-in, commits and fix commits.
2. Sorts by any one column.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | file with no history: zero, stated |
| Very large input | n/a |
| Duplicate / already exists | renamed file: history followed |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | shallow clone: history columns refused |
| Partial failure | fix commits unidentifiable: column "unknown" |
| Timeout / retry | n/a |
| Undo / correction | n/a |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-37 | test | hist@`57a2788` | S1 | exactly six columns, named as in step 1; sorting by fan-in puts a fan-in-27 file first |

### S-16: Personas and features over time

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| Product Manager after a persona refresh | a persona is introduced or retired (`status: active / retired`) | features declare personas served | per-persona feature changes, each grade as recorded |

1. Reads per persona: features serving it, and features new, modified or removed between two commits.
2. On retirement, reads features left serving no active persona; on introduction, "no feature yet".

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no personas: stated |
| Very large input | n/a |
| Duplicate / already exists | n/a |
| Concurrent modification | n/a |
| Permission denied | n/a |
| Resource missing mid-operation | feature cites an unknown persona id: flagged |
| Partial failure | n/a |
| Timeout / retry | n/a |
| Undo / correction | persona re-activated: features served again |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-38 | test | fx-pairs, retire the only persona F serves | S1 | F listed "unserved" |
| FR-39 | test | fx-pairs, two commits adding G and removing H | S1 | G new, H removed, per persona |

### S-17: An answer is fresh and sourced, or it is not given

| Actor | Trigger | Preconditions | Observable outcome |
| :-- | :-- | :-- | :-- |
| any reader of the map; for P-2 | any query on S1 to S5 | a stored map | every fact re-derives at its commit, or the answer is refused naming why |

1. Every fact carries resolved SHA, path, line span, matched text, rule id and extractor version.
2. A query about a commit other than the map's is rebuilt or refused (**default**: rebuild; refuse when rebuild is impossible, OQ 19).
3. `map verify` re-derives a stored output and diffs it.

| Case | Expected behavior |
| :-- | :-- |
| Empty input | no stored map: built, or "reach not computed" |
| Very large input | verify runs over every edge (1,654 at `57a2788`) |
| Duplicate / already exists | two builds at one SHA: byte-identical |
| Concurrent modification | concurrent builds stamped by SHA; neither overwrites the other's commit |
| Permission denied | n/a |
| Resource missing mid-operation | cited SHA unreachable from any named ref: "unverifiable" |
| Partial failure | a fact missing one source field: refused naming the field |
| Timeout / retry | n/a |
| Undo / correction | a hand-edited stored edge: verify exits non-zero naming it |
| Dirty working tree | change count stated; 0 facts from the working tree |
| Shallow clone | history answers refused |

| ID | Check | Fixture | Surface | Passes when |
| :-- | :-- | :-- | :-- | :-- |
| FR-40 | test | hist@`57a2788` with each of commit, path, line, rule removed from one stored fact in turn | S1 | each read refused, naming the missing field |
| FR-41 | test | map built at `7746e27`, asked about `57a2788` | S1, S2 | rebuilt at `57a2788` or refused "stale: map 7746e27…, asked 57a2788…"; never an answer stamped `7746e27` |
| FR-42 | checker | hist@`57a2788` | S1 | `map verify` reports 0 diffs; one hand-edited edge exits non-zero naming it |
| FR-43 | test | fx-pairs register | S1 | every register field either re-derives by its rule id or cites an operator record id that resolves; a field with neither refuses the write |
| FR-44 | mutation | extractor rule registry | CI | deleting any one rule turns at least one test red, for every rule |
| FR-45 | test | hist@`7746e27`, 255 commits ending there | S1 | runtime reach fires exactly once, on `6883fee`; hubs-excluded p90 equals the stored baseline (NFR-P2) |

## Functional requirements

| ID | Requirement | Scenario | Priority |
| :-- | :-- | :-- | :-- |
| FR-1 | Shipped view: entry points per plugin by kind (skill, role, reviewer agent, command, hook, MCP server, built CLI), from git objects at a commit resolved to its 40-hex SHA and printed | S-1 | must |
| FR-2 | Backing files via typed edges, each with relation type and evidence copied from the file at a stated line | S-1 | must |
| FR-3 | References to files absent from git listed as dangling | S-1 | must |
| FR-4 | Every output lists blind spots completely: each unanalysed file and why, unparsed files, ambiguous names, relations off, undetected runtime shapes; nothing truncated silently | S-1, S-3 | must |
| FR-5 | Map lives in the project repo, readable without a product checkout, writes nothing to the product repo | S-1 | must |
| FR-6 | Register: project-wide id, name, one area, entry points, personas served, each field extracted or declared; one script writes; lanes refuse edits | S-2 | must |
| FR-7 | Anchors confirmed at a resolved commit; missing or renamed later marked stale, kept, never retargeted; stale anchors excluded from reach and exclusive sets | S-2, S-4 | must |
| FR-8 | Seed from entry points and merged history, never story tables; writes nothing until accepted; seed text stored as declared | S-2 | should |
| FR-9 | Duplicate id and empty area refused; area without reason warns | S-2 | must |
| FR-10 | `impact` for a story: features, areas, verified waves, chain per hit | S-3 | must |
| FR-11 | Runtime reach: creating or removing a directory code discovers by name; file names never treated as discovered directories | S-3, S-6 | must |
| FR-12 | Hits through hubs listed apart, excluded from counts and warnings; hub threshold is a parameter | S-3, S-7 | must |
| FR-13 | Unresolvable rows listed; planned creates checked; no table means "no prediction" | S-3 | must |
| FR-14 | `impact` for a feature: shared per relation type, exclusive | S-4 | must |
| FR-15 | `impact` for a commit at its first parent, renames as remove plus add, naming verified waves reached; empty or unresolved commit refused | S-5 | must |
| FR-16 | Replay a commit and record caught or the missed shape, with the rule-set hash; re-run on rule change | S-6 | should |
| FR-17 | Runtime reach switchable off, stated | S-6 | could |
| FR-18 | Ready gate warns on non-hub cross-area reach (**default** warn) | S-7 | must |
| FR-19 | Ready gate warns naming a verified wave whose merged file is reached (**default** warn) | S-7 | must |
| FR-20 | No prediction or map: "reach not computed"; prediction at another SHA or Files-table hash: rebuild or refuse, never served | S-7 | must |
| FR-21 | Reach warnings recorded and resolved as ready warnings (`READY_KINDS`) | S-7 | must |
| FR-22 | Retire candidates only with raw usage evidence; else "instrument first" | S-8 | must |
| FR-23 | Retire needs a verified decision scoped `irreversible`, whatever `high_stakes_labels` says; never inferred | S-8 | must |
| FR-24 | Staged retiring, hidden, deleted; one row each; no skipping; in place | S-8 | must |
| FR-25 | Deletable only if exclusive under every relation, unreferenced at a resolved HEAD, uncovered by blind spots, and unreferenced by unmerged branches and open PRs | S-8 | must |
| FR-26 | The map deletes no code | S-8 | must |
| FR-27 | `waves.js` overlap: one file's spellings are one path; ambiguity reported | S-9 | must |
| FR-28 | Merge gate reconciles declared and merged files; warns only; truncated lists say so | S-10 | must |
| FR-29 | Merged files per story recorded; out-of-prediction files counted | S-10 | should |
| FR-30 | Pairs show declared relation beside implementation coupling; undeclared coupling marked hidden | S-11 | should |
| FR-31 | Declared relation without coupling reported | S-11 | could |
| FR-32 | `impact` on a bug's fix or a change lists features, personas and customer surfaces, each with its source; unsourced reads "unknown" | S-12 | should |
| FR-33 | Persona grades shown exactly as recorded; never upgraded | S-12, S-16 | must |
| FR-34 | `plan.js select` gives a file-cited "builds on verified" reason from a fresh prediction | S-13 | should |
| FR-35 | The `builds_on_verified` judge stays advisory beside the map reason | S-13 | must |
| FR-36 | Consolidation candidates with shared files, raised for the owner; nothing merged | S-14 | could |
| FR-37 | Tech-debt columns per backing file, sortable; no combined score | S-15 | could |
| FR-38 | Features left serving no active persona listed on a retirement | S-16 | could |
| FR-39 | Per persona: features new, modified, removed between two commits | S-16 | could |
| FR-40 | Provenance on every fact: resolved SHA, path, line span, matched text, rule id, extractor version; a fact missing one is refused | S-17 | must |
| FR-41 | Staleness: an answer about commit Y from a map built at X ≠ Y is rebuilt or refused, never served as X | S-17 | must |
| FR-42 | `map verify` re-derives stored output at its commit; any diff exits non-zero naming it | S-17 | must |
| FR-43 | No model-written text stored as fact: every field re-derives by rule or cites a resolving operator record | S-17 | must |
| FR-44 | Mutation harness over the extractor's rule registry | S-17 | must |
| FR-45 | Sweep regression over a pinned commit window against a stored baseline | S-17 | should |

## Non-functional requirements

| ID | Requirement | Target | Measured | Check · fixture · surface |
| :-- | :-- | :-- | :-- | :-- |
| NFR-1 | Build time at HEAD | open (OQ 8) | 2.56-2.68 s, 562 files, at `57a2788` | test, timed 3 runs · hist@HEAD · S1 |
| NFR-2 | Data volume | this repo as measured; a product repo unknown (OQ 4) | 562 files, 1,654 edges, 71 entry points at `57a2788` | test · hist@HEAD · S1 |
| NFR-3 | Features reached per commit | see NFR-P2 (same measure; ID kept for references) | SWEEPNFR | `sweep.js` |
| NFR-4 | Runtime-reach firing rate | open (OQ 10) | SWEEPRUNTIME | test · FR-45 window · S1 |
| NFR-5 | Replay recall | see NFR-P1: a count, never a rate, until incidents exist | 1 of 1 (`6883fee`) | replay rows |
| NFR-6 | Register concurrency | 0 lost writes; a write against an older version refused | not measured | test, two processes × 100 rows = 200 rows · fx-pairs · S1 |
| NFR-7 | Availability | 0 ready refusals caused by the map | not measured | test · FR-20 fixtures · S2 |
| NFR-8 | Retention | append-only: old register bytes are a prefix of the new after every write | not measured | test, mutation-checked · fx-anchor · S1 |
| NFR-9 | Languages | JS, TS, markdown, JSON analysed; every other file a named blind spot | 24 of 562 unanalysed at `57a2788` | test · fx-blind · S1 |
| NFR-F1 | Provenance | 100% of facts carry FR-40's fields; 100% of edges re-verify with `git show` | 0% (spike: D-1, D-9) | checker · hist@HEAD (1,654 edges) · S1 |
| NFR-F2 | Freshness | served only if map SHA equals the asked commit; stale answers served: 0 | spike serves any ref | test · FR-41 · S1, S2 |
| NFR-F3 | Reachability | cited SHA reachable from a named ref, else "unverifiable" | not measured | test · fx-force · S1 |
| NFR-F4 | Working tree | dirty count stated; facts from the working tree: 0 | spike reads objects only | test · dirty · S1 |
| NFR-F5 | Shallow clone | history answers refused | not measured | test · shallow · S1 |
| NFR-F6 | No model text as fact | each register field extracted (rule id) or declared (declarer, record id) | no register yet | test · FR-43 · S1 |
| NFR-P1 | Replay recall | every known break replayed on every rule change; reported as a count | 1 of 1 | test · FR-16 · CI |
| NFR-P2 | Sweep noise, hubs excluded | p90 3 or fewer (brief target) | with hubs: SWEEPP90; hubs-excluded not measured (threshold OQ 7) | test · FR-45 · S1 |
| NFR-P3 | Mutation coverage of rules | 100% of rules, in CI | no rule registry yet | mutation · FR-44 · CI |
| NFR-P4 | False-edge precision per rule | open (OQ 16); research reports Tricorder holds ~10% (reported) | D-6: ~4 of 16 runtime patterns false | hand-audited sample per rule |
| NFR-P5 | Coverage | analysed + blind spots = all files in scope; silent: 0 | 24 of 562 silent at `57a2788` | test · fx-blind, hist@HEAD · S1 |

## Assumptions

- **assumed:** runtime reach beyond directories discovered by name goes undetected.
- **assumed:** regex extraction holds for this repo; untested on another language.
- **assumed:** the invocation ledger can evidence plugin-feature use; it broke twice.
- **assumed:** `area` lives on bead metadata (`gates.js:219`); 0 of 29 story files set it; `bd` absent here.
- **assumed:** S-12 to S-16 rest on features declaring personas; nothing records that today.
- **assumed:** "fix commits" (S-15) are identifiable from `bug` beads with `fixes:`; commit subjects alone are not trusted.

Terms the glossary lacks, proposed for curation. "Surface" here is the glossary's *delivery
surface* as `surface.json` declares it; surface IDs S1..S5 are not scenario IDs S-1..S-17.

| Term | Proposed definition | Referent |
| :-- | :-- | :-- |
| Entry point | what a plugin ships that a person or host starts | `map-spike.js features()` |
| Backing file | a file an entry point reaches through typed edges | spike `backing` |
| Feature | a named capability inside one area (**default**, OQ 1) | brief MVP 2 |
| Feature register | the one-script record of features, anchors, personas, relations | brief MVP 2 |
| Runtime reach | reach through code finding paths by name at run time | `6883fee` |
| Hub | a backing file at or above the fan-in threshold | spike fan-in |
| Blind spot | what an output could not see, stated in it | `research.md` constraint 1 |
| Verified wave | a wave whose non-cut stories are all `state-verified` | `waves.js currentWave` |
| Exclusive file | reached by one feature only, every relation, confirmed at HEAD | brief MVP 5 |
| Implementation coupling | two features sharing non-hub backing files | owner quote 4 |
| Provenance | the source fields every fact carries (FR-40); a specialisation of *citable traceback* | FR-40 |
| Stale | built at a commit other than the one asked about, or an anchor absent at the asked commit | FR-7, FR-41 |

## Open questions

| # | Question | Owner | Blocks | Default until answered |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Is a feature a capability you name ("the invocation ledger"), grouped under a product area, or is the area itself the feature? | operator | FR-6 | **default:** a named capability inside one area |
| 2 | When a story's reach crosses another area, should the ready gate warn or refuse? | operator | FR-18 | **default:** warn |
| 3 | When a change touches something already checked on your app, should it go back for a fresh check? | operator | FR-19 | **default:** warn and name the wave |
| 4 | Which product repo should prove the two-repo case? | operator | NFR-2, F12 | none |
| 5 | Which logs show a product feature is used, for retirement? | operator | FR-22 | **default:** instrument first |
| 6 | Which role writes the register? | Product Owner, Solution Architect | FR-6 | **proposed:** Product Manager |
| 7 | What fan-in makes a hub? At `57a2788`: 20 files at 20 or more, 14 at the top value 27 | Business Analyst | FR-12, NFR-P2 | none: a parameter until answered |
| 8 | What build time is acceptable before the ready gate? | Solution Architect, after OQ 4 | NFR-1 | none |
| 9 | May one entry point belong to two features? | operator | FR-6, FR-25 | **proposed:** yes, shared |
| 10 | What runtime-reach firing rate is noise? | Business Analyst | NFR-4 | none |
| 11 | Where is the map built when planners have no product checkout (F6)? | Solution Architect | FR-5, FR-41 | none |
| 12 | What proves a usage source was live across a window? | Business Analyst | FR-22 | none |
| 13 | How much shared backing makes two features worth consolidating? | operator, with Business Analyst | FR-36 | none |
| 14 | Should the brief absorb owner quotes 4 and 5 as revision 3? | Product Manager | S-11 to S-17 | none |
| 15 | Who declares which personas a feature serves, and from what evidence? | Product Owner | FR-32, FR-38 | none |
| 16 | What false-edge rate per rule is acceptable, and how large is the audit sample? | Business Analyst | NFR-P4 | none |
| 17 | Which customer surfaces does this initiative have (S1..S5 proposed), and is the claim path (`bd-guard.js`) one? | Solution Architect, at `/delivery:architecture` step 7 | every criterion's surface; FR-27 | **proposed:** S1..S5 |
| 18 | Which criteria may pass on a `bd` stub, and which need a real `bd`? | QA Strategist | FR-18, FR-19, FR-21, FR-34 | none |
| 19 | When an answer is stale, rebuild or refuse? | Solution Architect | FR-20, FR-41, NFR-F2 | **default:** rebuild; refuse when rebuild is impossible (shallow, unknown commit, no checkout) |
| 20 | How long does a prediction stay valid as HEAD moves? | Business Analyst | FR-20, FR-34 | **proposed:** until a commit touches a predicted or declared path |

## Out of scope

- Our own language parser; Trail-Code, Decisioncraft or Amplifier as requirements.
- A combined score; automatic code deletion; automatic consolidation.
- Refusing at the ready gate on reach; sending a verified wave back to the Reality Checker.
- Building usage instrumentation: "instrument first" names the need only.
- MJ-skill doctrine (storyboard, usefulness card, leftover-stone test): separate initiative.
- The attractor-handoff plan (draft PR #61).
