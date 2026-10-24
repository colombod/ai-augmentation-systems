<!--
BUDGET — target 1000 words, hard cap 1600 words. Excludes code, YAML and data tables.
Interface blocks and NFR tables are data.
-->

# Architecture: feature map, from what is shipped to blast radius to retirement

> Written by /delivery:architecture (step 2, Solution Architect). Owned by Solution Architect, with QA Strategist.
> Status: draft (steps 3 to 7 not run: no test strategy review, no critic pass, no `assumptions.md`, no `surface.json`) · Last updated: 2026-10-24
> PRD: `.delivery/initiatives/feature-map/prd.md` · Measured at `57d5eca0aeb5a55999caa9a372bc0a11ffe12a52` (HEAD of `delivery-feature-map`), Node 22.22.0, SQLite 3.50.4, this container
> Decisions: ADR-016 (amended), ADR-017, ADR-018, ADR-019 · **Word count:** see the last line

## Approach

The map is a set of SQLite files, one per (repository, commit, rule-set hash), derived only from
git objects and refused for any other commit; the hand-made part (features, areas, personas,
retirements) is a separate append-only file in the project repo with one writer. Every answer, from
the CLI or the MCP tools, is an envelope that names the commit it describes, carries provenance on
each fact and lists its blind spots. The single most important decision is ADR-019: **a question is
always answered at the commit it asks about, building the map there if needed, and refused if that
cannot be done**; no cached answer is ever served for another commit. That turns owner quote 5
("up to date, fresh and real") into a structural property instead of a habit.

## Codebase context

| Path (under `plugins/delivery/` unless rooted) | Role today | Change |
| :-- | :-- | :-- |
| `scripts/map.js` | does not exist | new: the CLI, and the only writer of declared facts |
| `scripts/map-mcp.js` | does not exist | new: stdio MCP server, read-only, Node built-ins only (ADR-017) |
| `.mcp.json` | does not exist | new: one server, `map`, `node ${CLAUDE_PLUGIN_ROOT}/scripts/map-mcp.js` |
| `scripts/lib/map/snapshot.js` | spike `readRev` (`spikes/map-spike.js:27-44`) is quadratic: 2.55 s of a 2.74 s build | new: linear `ls-tree -z` + one `cat-file --batch` Buffer read; 87-90 ms measured here |
| `scripts/lib/map/rules/*.js` | spike regexes, no line numbers (D-9) | new: rule registry (`claude-plugin`, `js`, `markdown`, `manifests`, `python`, `workflow`, `runtime`), each rule `{ id, version, test }` |
| `scripts/lib/map/store.js`, `query.js`, `verify.js`, `declared.js`, `mirror.js`, `gate.js`, `experts.js` | spike `db-spike.js` | new |
| `scripts/ready.js` | ready gate; `READY_KINDS` at line 23 | extended: reach findings from `lib/map/gate.js`, three kinds added, stamp in bead metadata on `--record` |
| `scripts/lib/waves.js` | `norm` at line 72 | modified: path normalisation and "ambiguous" (FR-27) |
| `scripts/lib/reviews.js`, `scripts/merge-gate.js` | `pr.files` used for line counts only (`reviews.js:133`) | extended: declared-versus-merged reconciliation on the merged row (FR-28, FR-29) |
| `scripts/plan.js` | judge reads titles only (`plan.js:79-90`) | extended: file-cited "builds on verified" reason (FR-34); judge unchanged |
| `hooks/scripts/lane.js` | protects the assumption register by path regex (`lane.js:718-728`) | extended: same pattern for `.delivery/map/` and the map cache, for every role, `any` included |
| `hooks/lane-groups.json` | no map groups | extended: `map-read`, `map-declare` |
| `roles/product-manager.md`, `delivery-lead.md`, `chief-of-staff.md`, `staffing.md` | `lane_bash` lists | extended: `map-read`; `map-declare` for the Product Manager only (PRD OQ 6, proposed) |
| `scripts/start.js` (`--check`) | doctor preflight | extended: Node and `node:sqlite` check, reported, never fatal |
| `skills/realign/SKILL.md` | step 3 retires nothing | extended: retire candidates and stage 3 queries |
| `scripts/lib/experts.js` (branch `delivery-project-experts`, b374379) | installs experts; staleness left to "the feature map" | extended after that branch merges: prints `map.js experts` verdicts as warnings |
| `.github/workflows/delivery-tests.yml` (repo root) | `actions/checkout@v4`, depth 1; Node 24 | modified: `fetch-depth: 0` (history fixtures), Node 22 and 24 matrix |
| `scripts/lib/gates.js`, `warnings.js`, `operator-records.js`, `assumptions.js` | areas, ledger, record scope | untouched: read through their exports |
| `plugins/claim-guard/` | MCP server whose `dist/claim-ledger.js` is not in git (`.gitignore:4`) | untouched; the map reports it dangling (FR-3) |

## Setup — prerequisite, not a feature or a phase

| Setup item | Establishes | Blocks |
| :-- | :-- | :-- |
| CI checkout with full history, Node 22 and 24 | `hist@C` fixtures exist in CI; `node:sqlite` on both majors | every FR with an `hist@C` fixture; spike 6 |
| `scripts/testing/map-fixture.js` | clones this repository at a pinned SHA into a temp dir, never the working tree | FR-1..FR-17, FR-40..FR-45 |

## Component structure

```
           CLI  scripts/map.js  ─┐            MCP  scripts/map-mcp.js (read-only)
 ready.js / plan.js / merge-gate ┤                 │
                                 ▼                 ▼
                     lib/map/query.js  (envelopes; freshness rule, ADR-019)
                      │         │            │             │
           lib/map/store.js  lib/map/declared.js  lib/map/gate.js ── bd, reviews ledger (live reads, stamped)
                      │         │
          lib/map/rules/*  ◄── lib/map/snapshot.js ◄── lib/map/mirror.js ── product repos (fetch only)
```

Dependencies point down only; rules are pure functions of `(path, text, fileIndex)` and know nothing
of SQLite. Gates never import `store.js` directly, so a missing `node:sqlite` degrades to one
warning. Plugin roots are discovered from `.claude-plugin/plugin.json`, never named, so
`scripts/self-contained.test.js` keeps passing.

**Where it is built (PRD OQ 11).** In the project repo's session. Each product repo is read from a
full bare mirror at `<git-common-dir>/delivery-map/repos/<id>.git`, fetched by `map.js`; the
project repo itself is read in place when it is also the product (this repository). Nothing is
written to a product repo (FR-5). A partial clone is refused: the local `mtg-toolkits` clone is
`blob:none`, and reading its 31 blobs took 13.1 s of lazy network fetch.

**Multi-repo (the Vault).** A pin is an extracted fact: `requirements-vcs.txt:1` and
`pyproject.toml` name `mtg-toolkits@90ec563…`. The toolkit is mapped at the pinned commit, not its
tip, and attached at query time (`ATTACH`); `from mtg_toolkits.x import y` becomes a cross-repo edge
to `repo:mtg-toolkits@<sha>:src/mtg_toolkits/x.py`. Two pins that disagree are a blind spot naming
both lines.

**Languages without a parser (ADR-018).** Line scanners with lexical state, measured on the Vault at
`b1ca9eb` with a throwaway script (scratchpad, not shipped):

| Rule pack | Extracts | Measured | Declared blind spot instead |
| :-- | :-- | :-- | :-- |
| `python` | `import`, `from … import`, relative imports, literal `importlib.import_module` / `__import__`; source roots from `pyproject.toml` (hatch `packages`, pytest `pythonpath`, `src/` layout) | 354 files; 3,344 imported names; 1,205 to repo files; 53 to the pinned toolkit; 2,086 external; relative 329 of 329; 0 internal-looking names unresolved; 4 import-shaped lines inside strings skipped; 90 ms read + 237 ms extract | computed dynamic imports (3), `spec_from_file_location`, `sys.path` edits, a `pyproject.toml` line the TOML subset reader does not understand, monkeypatched names |
| `workflow` | triggers under `on:` as entry points; `run:` lines and block scalars (by indentation): `python -m mod`, `python path.py`, `-r file`, `node path`; `uses: ./local`; external `uses:` as pinned external nodes | 15 workflows; 191 run lines; `python -m` 21 (17 to `jobs/`, 4 `pytest`); scripts 6 of 6; requirement files 23 of 23; 39 external actions; 0 anchors | YAML anchors and aliases, flow-style steps, `${{ }}` or a shell variable in a path or module position, reusable workflows from other repos |
| `manifests` | `vercel.json` functions, `[tool.vercel] entrypoint`, `package.json` scripts and esbuild builds, `.mcp.json` servers (stdio command or http URL), VCS pins | not measured beyond the files read | a URL contract (`plugins/the-vault/.mcp.json` calls `https://mtgvault.cards/api/mcp`) and MCP tool names called from skill prose: listed under `undetected_shapes`, linkable only by a declared fact |
| `js`, `markdown`, `claude-plugin`, `runtime` | spike rules with line evidence; prose mentions only when unambiguous; runtime reach only for a name that appears as a non-final path segment at the mapped commit (D-6) | spike: 1,654 edges, 71 entry points | template-literal requires, ambiguous basenames (both candidates named, D-5), environment variables, cwd, globs |

Binary blobs (202 `jpg` in the Vault) are counted as `binary` blind rows, never read.

## Interfaces and data contracts

```sql
-- map-<repo>-<40-hex>-<rules12>.db, in <git-common-dir>/delivery-map/db/, written to .tmp-<pid> then renamed
create table meta(key text primary key, value text not null check(length(value) > 0));
-- keys: schema=1, repo, commit (40-hex), tree, rules_hash, extractor, built_at, node, sqlite, files_total, shallow=0
create table file(path text primary key, oid text not null, mode text not null, kind text not null,
  lang text, analysed integer not null check(analysed in (0,1)));
create table entry(id text primary key, kind text not null, node text not null, plugin text,
  rule text not null, path text not null, line_start integer not null check(line_start > 0),
  line_end integer not null check(line_end >= line_start), matched text not null check(length(matched) > 0));
create table edge(src text not null, dst text not null, rel text not null, dst_repo text,
  rule text not null, path text not null, line_start integer not null check(line_start > 0),
  line_end integer not null check(line_end >= line_start), matched text not null check(length(matched) > 0));
create table blind(path text not null, line integer, reason text not null, detail text not null, rule text not null);
create table dangling(src text not null, target text not null, rel text not null, rule text not null,
  path text not null, line_start integer not null, matched text not null);
create table pin(repo text not null, commit_sha text not null check(length(commit_sha) = 40),
  rule text not null, path text not null, line_start integer not null, matched text not null);
create virtual table evidence_fts using fts5(src, dst, rel, matched, path);
-- invariant checked at build end: (select count(*) from file) = files_total, and every file row is
-- analysed=1 or has a blind row (NFR-P5). A NOT NULL or CHECK failure aborts the build naming the column (FR-40).
```

```jsonc
// .delivery/map/declared/<writer>.ndjson — one chain per writing session, merged on read in time order
// (the reviews.js pattern, reviews.js:31-40), so hosts merge in git without forking a chain
{"v":1,"n":12,"prev":"<sha12 of line n-1>","at":"2026-10-24T11:00:00Z","by":"product-manager-1",
 "op":"feature.add | feature.anchor | feature.area | feature.persona | feature.relation | feature.supersede |
       repo.add | component.add | retire.stage | usage.attach | gap.add | candidate.decline",
 "id":"F-invocation-ledger","fields":{"name":"the invocation ledger","area":"ledger","areaReason":"…"},
 "source":"dec-chief-of-staff-31",          // an operator record that verifies (FR-43); required on every row
 "base":"<sha12 merged head the writer saw>", // a concurrent row whose base does not include this one: "contested"
 "confirmed":{"repo":"self","commit":"<40-hex>","anchors":[{"entry":"delivery:hook:PostToolUse:record-invocation","oid":"<blob>"}]}}
```

Only `map.js declare <op>` writes it (lock per writer file, `lib/lock.js` strict). The lane refuses
every tool and shell write to `.delivery/map/**` and `<git-common-dir>/delivery-map/**` for every
role, the `lane.js:718-728` pattern. An anchor absent at the confirming commit refuses the row
(FR-7); later absence reads `stale@<40-hex>` at build, never retargeted.

```
map.js shipped|feature <id>|blind|verify|search <text>|experts   [--repo <id>] [--at <ref|40-hex>] [--json]
map.js impact (--story <file|bead> | --feature <id> | --commit <sha> | --files a,b) [--hub-threshold N] [--no-runtime]
map.js replay <sha> | sweep --window <a>..<b> | pairs | debt | personas --from <a> --to <b> | seed | retire-check <id>
map.js declare <op> --source dec-… [--base <sha12>] …          (map-declare lane group; everything else map-read)
exit 0 answered · 1 refused (two lines: what and why, then the way out) · 2 usage
MCP tools (read verbs, so lane.js:1071-1075 admits them without lane_mcp edits):
  show_shipped, show_feature, get_impact, search_evidence, show_blind_spots, get_verification, show_experts
  arguments mirror the CLI; each returns the envelope below as text content; no write tool exists
```

```jsonc
{ "status": "answered" | "refused",
  "refusal": {"code": "stale|unverifiable|shallow|partial-clone|no-sqlite|fetch-failed|missing-field|contested", "detail": "…"},
  "answer_for": {"repo": "self", "commit": "<40-hex>", "asked": "main", "fetched_at": "<ISO>|null"},
  "map": {"rules_hash": "<12>", "extractor": "1.0.0", "schema": 1, "built": true},
  "declared": {"head": "<sha12>", "rows": 40, "contested": []},
  "live_reads": [{"source": "bd", "at": "<ISO>"}, {"source": "reviews", "at": "<ISO>"}],
  "working_tree": {"dirty": 2, "facts_from_tree": 0},
  "facts": [{"…": "…", "provenance": {"commit": "<40-hex>", "path": "…", "line": [12, 12], "matched": "…", "rule": "js.require@1", "extractor": "1.0.0"}}],
  "hubs": [{"path": "…", "fan_in": 27}],
  "blind_spots": {"files": [{"path": "…", "reason": "…"}], "unresolved": [], "relations_off": [],
                  "undetected_shapes": ["env-var", "cwd", "glob", "url-contract", "tool-name-contract"]} }
```

Declared facts carry `provenance: {declared_by, source, row}` instead of a rule. Text output prints
the commit first and the blind-spot counts last, nothing truncated silently (FR-4, D-7). The ready
gate stamps bead metadata `reach: {commit, files_hash, rules_hash, declared_head, features, areas}`
on `--record`; any reader uses the stamp only when all four keys match the current base, else
recomputes (FR-20, FR-34).

**Experts staleness (brownfield MVP 6; no FR in this PRD: proposed FR-46).** Contract for Staffing:
frontmatter `read_at: [<repo>@<40-hex>]`; citations `` `path:a-b` `` or `` `repo:path:a-b` ``.
`map.js experts` reads `git diff -U0 <read_at> <mapped>` per cited path: lines changed reads stale;
file changed elsewhere reads moved; path gone reads gone; no `read_at` reads unverifiable (both
trial experts in `the-vault-planning` today: they cite `b1ca9eb` in prose only); a component with no
files left makes the expert a retire candidate.

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | open (OQ 8); proposed: build at 1 s here, 2 s on the Vault, so the ready gate builds inline | linear reader 87-90 ms (565 blobs, 7.8 MB); spike rules 29 ms; 1,654 edges plus FTS inserted in 26 ms; cold node plus open plus meta read 28-31 ms; Vault read 90 ms, Python and workflow extraction 237 ms. End to end with the new reader not measured | medium |
| NFR-2 | this repo; product unknown | this repo 565 blobs at HEAD; the Vault 898 blobs (651 text, 41.1 MB in all), the toolkit 31; one SQLite file per repo commit, 0.99 MB here | medium |
| NFR-3 | see NFR-P2 | same measure | — |
| NFR-4 | open (OQ 10) | runtime rule restricted to path segments present in git (D-6); which of the 16 names at HEAD survive is spike 4; firing rate re-measured by FR-45 | medium |
| NFR-5 | count | see NFR-P1 | — |
| NFR-6 | 0 lost writes; older-version write refused | per-writer chain under a strict lock; `--base` mismatch refused; cross-host same-field writes read `contested`, never resolved silently | high |
| NFR-7 | 0 ready refusals from the map | `gate.js` returns warn findings only; every exception becomes `reach-not-computed` | high |
| NFR-8 | append-only prefix | rows only appended; `map.js verify` checks each chain's `prev`; the lane refuses hand edits | high |
| NFR-9 | JS, TS, markdown, JSON; others blind | plus Python and workflow YAML (ADR-018); every other file a `blind` row | high |
| NFR-F1 | 100% provenance; 100% edges re-verify | NOT NULL and CHECK columns; `verify` re-reads each edge's line with `git cat-file` and compares `matched` | high |
| NFR-F2 | 0 stale answers | file key includes commit and rules hash; `open()` compares `meta.commit` with the asked commit (db-spike refused `stale: map 528f388…, asked 00a5cb1…`); ADR-019 | high |
| NFR-F3 | cited SHA reachable from a named ref | `git branch -r --contains` (mirror) at answer time, else `unverifiable` | medium |
| NFR-F4 | dirty count stated; 0 facts from tree | only objects are read; `git status --porcelain` counted into `working_tree` | high |
| NFR-F5 | shallow refused | `git rev-parse --is-shallow-repository`; also partial clones (`remote.*.promisor`) | high |
| NFR-F6 | extracted or declared with record | rules write `rule`; declared rows require a verifying `source` | high |
| NFR-P1 | every break replayed on rule change | replay rows keyed by rules hash; a hash change marks them out of date; `node --test` regression for `6883fee` | high |
| NFR-P2 | p90 3 or fewer, hubs excluded | **not met as measured.** Spike rules, 255 non-merge commits `6cea411..57d5eca`, merges excluded: p90 5 with no hub cut and at thresholds 27, 20 and 10; counting only reach through non-entry files, p90 4. First-parent history (86 commits, 22 merges): p90 21, and 19 at threshold 20. Hubs do not move the p90; commits that edit several skills reach several features truly | low |
| NFR-P3 | 100% rules mutated in CI | registry exported; `map.rules.test.js` deletes each rule in turn and expects a red test | high |
| NFR-P4 | open (OQ 16) | per-rule audit sample in spike 3 and 4 | low |
| NFR-P5 | analysed plus blind = all | build-end invariant above; binaries and unknown extensions are rows | high |

**NFR-P2 is a trade-off for the Product Owner, not an engineering fix.** Five features reached by a
commit that edits five skills is real reach; hiding it to hit a number would be the incorrect claim
owner quote 5 forbids. Options: measure per story pull request (the unit the ready gate predicts);
measure indirect reach only (p90 4); or keep the target and accept it as unmet. Spike 5 decides.

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-016 (amended) | SQLite per (repo, commit, rules hash) in the git common dir; declared facts as per-writer chained files; MCP plus CLI | markdown or JSON files read by agents; a graph or vector store; Dolt for derived or declared data |
| ADR-017 | MCP server as one dependency-free `scripts/map-mcp.js` speaking stdio JSON-RPC | the MCP SDK bundled to `dist/` (the claim-guard failure: bundle absent from git); CLI only |
| ADR-018 | Python and workflow edges by lexical line scanners; everything else a declared blind spot | tree-sitter (not installable); shelling out to `python3 -c ast`; a hand-written parser (PRD out of scope) |
| ADR-019 | Answer at the asked commit: resolve named refs after a fetch, build if needed, refuse if impossible | serve the last map with a staleness warning; a time-to-live cache; build only on commit hooks |

## Spikes — what must be proven before committing

| # | Question to answer | Decision it informs | Decision rule | Decision owner | Time box | Blocks | Assumption |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | In a real role session started from a role directory, does Claude Code start the plugin's stdio server from `.mcp.json`, and what exact tool names does the lane hook receive? | ADR-017; lane admission | build if the names end in `__show_shipped` etc. and lane.js admits them; change the design (lane_mcp patterns) if the prefix differs; stop the MCP part and ship CLI only if role sessions do not load plugin servers (owner told: the owner asked for tools) | owner | 2 hours | MCP surface | A-1 |
| 2 | From a planner session, does `git fetch` of a product mirror succeed with the session's credentials, and what is its p90 latency over 20 calls (the Vault and `mtg-toolkits`)? | ADR-019 fetch per named ref | build if p90 ≤ 2 s; if slower, change the design to a stated fetch age in every answer, which relaxes "always fresh" and so is the owner's call; stop multi-repo if fetch fails (map the project repo only) | owner | 2 hours | FR-41, Vault | A-4 |
| 3 | Do the Python and workflow rules hold on a second repo and a second commit (full clone of `mtg-toolkits`; the Vault 30 commits back), with a hand audit of 50 edges per rule? | ADR-018 | build if internal unresolved is 0 and precision ≥ 90% per rule (default for OQ 16); change the rule if one rule falls below; stop Python support (blind spot only) if precision is below 70% | DM | 1 day | NFR-9, Vault map | A-5, A-6 |
| 4 | After the D-6 fix, does the runtime rule still fire on `6883fee` and only there over the FR-45 window, and which of the 16 names survive? | FR-11, NFR-4 | build if it fires once, on `6883fee`; change the rule if it misses `6883fee`; stop runtime reach (FR-17 off by default) if false firings exceed 5 | DM | 4 hours | FR-11, FR-45 | A-7 |
| 5 | With the real extractor, what is the p90 of features reached per story pull request over the first 10 story PRs, hubs excluded? | NFR-P2 target and unit | keep the target if p90 ≤ 3; otherwise the owner chooses the unit (per PR, indirect only) or accepts the number | owner | measured over the first 10 PRs; 2 hours of analysis | NFR-P2 | A-12 |
| 6 | Is Node 22.13 or later, with `node:sqlite` (FTS5, `json_each`, recursive CTE), on every host the team runs (pc, wintermute, cloud) and CI's Node 24, and is the warning silenced without breaking stdout? | ADR-016 point 5 | build if all hosts pass; change the design (map answers refuse on that host, gates warn) if one fails; stop if none of the planner hosts pass | PM | 2 hours | every map answer | A-3 |
| 7 | Does `gh pr list --json files` return each open PR's files, and does it say when a list is cut at 3,000? | FR-25, FR-28 | build if truncation is detectable; change the design to "not reconciled, truncated" whenever a list is exactly 3,000 if not; stop the open-PR check (keep the code, reason "open PRs unverifiable") if gh cannot list files | DM | 2 hours | FR-25, FR-28 | A-2 |

## Assumption register

Criteria are PRD requirement ids until the roadmap names stories. To be written through
`scripts/assumptions.js add` in a role session (step 6), every row `assumed`.

| Id | Statement | Kind | Criteria | Decision owner |
| :-- | :-- | :-- | :-- | :-- |
| A-1 | Claude Code starts a plugin's stdio MCP server in role sessions and passes its tool names to the PreToolUse hook as `mcp__plugin_delivery_map__<tool>` | external-host | FR-1 FR-10 FR-14 FR-42 | owner |
| A-2 | `gh pr list --json files` returns each open PR's changed files and its truncation is detectable | external-host | FR-25 FR-28 FR-29 | DM |
| A-3 | Every host and CI runs Node 22.13 or later with `node:sqlite`, FTS5, `json_each` and recursive CTEs | platform | FR-1 FR-41 NFR-F2 | PM |
| A-4 | Planner sessions can fetch every product repo into a private mirror with existing credentials, fast enough to fetch per named-ref answer | platform | FR-5 FR-41 FR-20 | owner |
| A-5 | Python imports plus `pyproject.toml` source roots resolve every internal module in other product repos (measured on one repo) | data | NFR-9 FR-2 FR-4 | DM |
| A-6 | Product workflows stay inside the line-scanner subset (no anchors, no flow-style steps); 15 of 15 Vault workflows do | data | NFR-9 FR-4 | DM |
| A-7 | Runtime reach other than discovered directories (environment variables, cwd, globs, URL and tool-name contracts) is rare enough that listing it as a blind spot keeps `impact` useful | data | FR-4 FR-11 FR-16 | DM |
| A-8 | The owner will give one operator record per declaration batch, since every declared row cites one (FR-43 as written) | customer | FR-6 FR-8 FR-43 | owner |
| A-9 | Per-writer chained files merge across hosts in git without conflicts, as the reviews ledger does | internal | FR-6 NFR-6 NFR-8 | DM |
| A-10 | A story's Files table, planned creates included, predicts its merged files well enough to warn on | data | FR-18 FR-19 FR-29 | PM |
| A-11 | Full mirrors read every blob locally; partial clones are detectable and refused | platform | FR-5 NFR-1 NFR-F5 | DM |
| A-12 | Features reached per story PR is a measure the owner accepts for noise | customer | NFR-P2 FR-45 | owner |
| A-13 | Staffing writes `read_at` and line citations in expert files (contract proposed here, branch `delivery-project-experts`) | internal | proposed FR-46 | PM |
| A-14 | Story beads carry `area` in metadata when the ready gate runs (0 of 29 story files set it; `bd` absent here) | data | FR-18 FR-21 | DM |

## Migration and rollback

**Forward:** additive only. New files: declared chains (tracked), the cache (derived, outside the
work tree), `.mcp.json`. New fields: bead `reach` stamp, merged-row reconciliation fields, three
`READY_KINDS`. Each declared row and the schema carry a version; a new extractor version changes the
rules hash and therefore the file name, so old maps are rebuilt, never migrated. Plugin version
bumps in `plugin.json` and `marketplace.json`.

**Back:** revert the plugin version. Declared chains stay as inert data no reader opens; the cache is
deleted from an owner's shell (the lane refuses it in role sessions); the stamp and merged-row fields
are ignored by older readers (to confirm in the merge-gate tests: an unknown field must not fail a
read). Removing `.mcp.json` stops the server at the next session start.

## Test strategy

Owned by the QA Strategist (step 3, not yet run). Fixed by the PRD: real child processes on S1 to S5,
`hist@C` clones (never the working tree), mutation per rule (FR-44), and `map verify` as checker.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| `node:sqlite` API changes between Node majors (experimental on 22) | medium | high | CI on 22 and 24; one wrapper in `store.js`; doctor check | DM |
| An MCP server per session costs startup and memory in every role session | medium | low | lazy open on first call; 28-31 ms cold open measured; spike 1 | DM |
| FR-43 makes every declaration wait for an owner record, so the register stays empty | medium | high | batch records; seed proposes, never writes; A-8 | PM |
| NFR-P2 target fails on real reach and pressures the rules into hiding true edges | high | high | spike 5 to the owner; no rule tuned to the number | owner |
| Map answers pasted into a builder's PR put feature words into the product repo | medium | medium | the builder brief names no map command (its `any` lane would allow one); the leak guard (`lib/plan-graph.js:188-207`) stays the backstop | DM |
| Experts branch merges after this one, or changes its frontmatter | medium | low | experts check reads only `read_at` and citations; tolerant of absence | PM |
| A hand-edited cache in a role session with an `any` lane | low | high | lane protection; `verify` re-derives; the file key includes the rules hash | DM |

## Open questions answered or raised here

| # | Answer or question | Owner |
| :-- | :-- | :-- |
| PRD OQ 11 | built in the project repo's session from private full mirrors (above) | answered (SA) |
| PRD OQ 19 | rebuild at the asked commit; refuse when impossible (ADR-019) | answered (SA) |
| PRD OQ 8 | proposed 1 s here, 2 s on the Vault, after spike 3 measures end to end | SA, after spike 3 |
| new | Expert staleness has no FR in this PRD; propose FR-46 (brownfield MVP 6 depends on it) | Product Owner |
| new | Is the MCP tool set a second customer surface (proposed S6) for step 7? | Solution Architect, step 7 |
| new | NFR-P2 unit and target (spike 5) | owner |

Glossary terms to propose: **declared fact** (a map fact a named role wrote with an operator record,
never derived), **map cache** (the derived SQLite files), **mirror** (a private full copy of a
product repo's history, fetched only), **pin** (a product repo naming another repo at a commit).

**Word count:** 1036 prose words with tables and code blocks excluded (target 1000, cap 1600); `grep -v '^|' architecture.md | wc -w`, which also counts the five code blocks (schema, file format, CLI, envelope, diagram), gives 1643; the budget excludes code, so the document is near target and within the cap.
