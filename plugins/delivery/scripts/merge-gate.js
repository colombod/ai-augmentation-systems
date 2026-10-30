#!/usr/bin/env node
// scripts/merge-gate.js — the merge gate (R-32): the Delivery Manager merges only on a passing
// independent review of the pull request's current head, with CI green and no conflict.
//   merge-gate.js check <pr> [--head <sha>]     read only; exit 0 when the merge may go ahead
//   merge-gate.js merged <pr> [--head <sha>]    after the merge: the merged row, state-merged on its beads, and
//                                               the fix-on-fix check (two fixes on one symptom in 48 h: a spike)
// The lane runs the same check before it lets the Delivery Manager's `gh pr merge` through. The merge
// names the product repository (-R owner/name, or a URL of it) and the full reviewed head
// (--match-head-commit <40-hex sha>), so GitHub merges exactly what was reviewed, where it was
// reviewed. gh supplies the head, mergeable and the checks; where gh cannot read them, the head named
// on the command and the Delivery Manager's recorded `review.js ci` row stand in. The Delivery
// Manager's GitHub approvals (`gh pr review --approve`) are refused too: approvals are review rows.
// Size and scope are warnings only. Exit codes: 0 passes / done; 1 refused; 2 usage.
const path = require('path');
const R = require('./lib/reviews.js');
const G = require('./lib/gates.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');
const { viewPr, productRepoOf, sameRepo, repoOf, UNKNOWN } = require('./lib/gh-pr.js');

const USAGE = 'usage: merge-gate.js check <pr> [--head <sha>] | merge-gate.js merged <pr> [--head <sha>]';

function ghFor(root, gh, repo) {
  if (gh) return gh;
  return (pr) => viewPr(pr, { repo, cwd: root });
}

function sizeThreshold(root) {
  try { return require('./lib/goal.js').value(root, 'pr_size_lines', { warn: false }) || R.DEFAULT_SIZE; } catch (err) { return R.DEFAULT_SIZE; }
}
const botsCountOf = (team) => Boolean(team && team.review && team.review.bots_count === true);
const mergeCmd = (pr, repo, head) => `\`gh pr merge ${pr} -R ${repo} --match-head-commit ${head || '<full head sha>'} --squash\``;
// The same merge through the REST endpoint, for hosts where gh reaches GitHub only through REST
// (gh pr merge is GraphQL); GitHub refuses it when `sha` is not the pull request's head.
const restMergeCmd = (pr, repo, head) => `\`gh api -X PUT repos/${repo}/pulls/${pr}/merge -f merge_method=squash -f sha=${head || '<full head sha>'}\``;
const mergeCmdFor = (view) => (view && view.via === 'rest' ? restMergeCmd : mergeCmd);

// { ok, why, fix, head, review, warnings, view }
function gate(root, pr, { head: named, gh, team, repo } = {}) {
  const view = ghFor(root, gh, repo)(pr) || { unavailable: 'no answer' };
  const { rows, problem } = R.read(root, pr);
  const seen = view.headRefOid || null;
  if (seen && named && !G.shaMatch(seen, named)) {
    return { ok: false, why: `PR ${pr} is now at ${R.short(seen)}, not ${R.short(named)}: new commits arrived after the review`, fix: `Ask for review of ${R.short(seen)}: ${R.cmd('review.js', `request ${pr} --reviewer ${(R.lastRequest(rows) || {}).reviewer || '<reviewer>'}`)}`, rows, view, warnings: [], head: seen };
  }
  const head = seen || named || null;
  const ci = view.unavailable ? null : R.ciOf(view.statusCheckRollup);
  const v = R.evaluate(pr, rows, { head, ci, mergeable: view.mergeable, botsCount: botsCountOf(team), problem, repo });
  const req = R.lastRequest(rows);
  const lines = view.unavailable ? (req ? req.lines : null) : R.changedLines(view);
  const warnings = R.scopeWarnings({ pr, lines: lines == null ? NaN : lines, stories: req ? req.stories || [] : [], threshold: sizeThreshold(root) });
  return { ...v, head, warnings, view, rows };
}

function check(root, pr, opts) {
  const g = gate(root, pr, opts);
  const warn = (g.warnings || []).map((w) => `warning: ${w.detail}`);
  if (!g.ok) return { code: 1, out: [`merge-gate: refused: ${g.why}.`, g.fix, ...warn].join('\n'), gate: g };
  const via = g.view.unavailable ? ` (gh: ${g.view.unavailable}; head and CI from the record)` : '';
  return { code: 0, out: [`merge-gate: PR ${pr} passes at ${R.short(g.head)}: review ${g.review.id} by ${g.review.reviewer}, CI green${via}.`,
    `Merge: ${mergeCmdFor(g.view)(pr, opts.repo, R.FULL_SHA.test(g.head) ? g.head : null)}, then ${R.cmd('merge-gate.js', `merged ${pr}`)}`, ...warn].join('\n'), gate: g };
}

// gh's options that take a value; anything else starting with - is a flag
const VALUE_FLAGS = ['--match-head-commit', '-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '-R', '--repo'];
// The `gh pr <sub>` calls in a command: [{ sub, pr, target, head, flags, repo }]. Environment
// assignments and `env` are skipped only before the executable; every later word is an argument.
function ghPrCalls(command) {
  const L = require('../hooks/scripts/lane.js');
  const out = [];
  for (const seg of L.splitCommand(command)) {
    const t = L.tokens(seg);
    let k = 0;
    while (k < t.length && (t[k] === 'env' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[k]))) k++;
    if (path.basename(t[k] || '') !== 'gh') continue;
    const words = [];
    const flags = [];
    let repo = null;
    let head = null;
    for (let i = k + 1; i < t.length; i++) {
      const x = t[i];
      const long = x.startsWith('--');
      // the value after = is dropped for short options too: -a=true is -a (Copilot 183)
      const [f, inline] = x.startsWith('-') ? x.split(/=(.*)/s) : [x, undefined];
      if (VALUE_FLAGS.includes(f)) {
        const val = inline !== undefined ? inline : t[++i];
        if (f === '-R' || f === '--repo') repo = val;
        if (f === '--match-head-commit') head = val;
        continue;
      }
      if (x.startsWith('-') && x !== '-') { flags.push(f); continue; }
      words.push(x);
    }
    if (words[0] !== 'pr') continue;
    const target = words[2] || '';
    const m = /^(\d+)$/.exec(target) || /\/pull\/(\d+)(?:[/?#].*)?$/.exec(target);
    const isUrl = /^[a-z]+:\/\//i.test(target) || target.includes('@');
    const urlRepo = isUrl ? repoOf(target) : null;
    // a URL that is not a github.com pull request names no repository the gate can trust
    out.push({ sub: words[1], pr: m ? m[1] : null, target, head, flags, repo: isUrl ? urlRepo : repo, repoConflict: !!(isUrl && (!urlRepo || (repo && !sameRepo(urlRepo, repo)))) });
  }
  return out;
}

// a short cluster carrying the letter (-a, -as), or the long name in any form (--auto, --auto=true)
const hasFlag = (flags, long, letter) => flags.some((f) => f === long || (letter && /^-[A-Za-z]+$/.test(f) && f.includes(letter)));

// The lane's check for the Delivery Manager's gh: null to allow, or the two-line reason
function mergeCommandProblem(command, { root, team, gh, roleDir } = {}) {
  const product = productRepoOf(team, { roleDir });
  const rest = restMergeProblem(command, { root, team, gh, product });
  if (rest) return rest;
  for (const c of ghPrCalls(command)) {
    if (c.sub === 'review' && hasFlag(c.flags, '--approve', 'a')) return `approvals are review rows, not GitHub approvals: the gate reads the review record.\nRecord the reviewer's outcome: ${R.cmd('review.js', `record ${c.pr || '<pr>'} --head <sha> --result pass --by <subagent id> --summary '<one line>'`)}`;
    if (c.sub !== 'merge') continue;
    const which = c.pr || '<pr number>';
    if (!c.pr) return `merging needs the pull request's number, so its review can be checked (got ${c.target ? `"${c.target.slice(0, 60)}"` : 'none'}).\nRun: ${R.cmd('merge-gate.js', `check ${which}`)}, then ${mergeCmd(which, product || '<owner/name>')}`;
    const bad = c.flags.find((f) => /^--(?:adm|aut)/.test(f)) || (hasFlag(c.flags, null, 'a') ? '-a' : null);
    if (bad) return `\`gh pr merge ${bad}\` merges outside the gate (${/adm/.test(bad) ? 'it bypasses the branch rules' : 'it merges later, on whatever head is there'}).\nMerge now, on the reviewed head: ${mergeCmd(c.pr, product || '<owner/name>')}`;
    if (!product) return `merge of PR ${c.pr} refused: ${UNKNOWN(c.pr).replace('\n', '.\n')}`;
    if (!c.repo || c.repoConflict) return `merge of PR ${c.pr} refused: name the product repository, so the reviewed pull request is the one merged.\nRun: ${mergeCmd(c.pr, product, c.head && R.FULL_SHA.test(c.head) ? c.head : null)}`;
    if (!sameRepo(c.repo, product)) return `merge of PR ${c.pr} refused: ${c.repo} is not the product repository (${product}), and its reviews are recorded only for that one.\nRun: ${mergeCmd(c.pr, product)}`;
    let g;
    try { g = gate(root, c.pr, { head: c.head, gh, team, repo: product }); } catch (err) { return `the merge gate could not run (${String(err.message).split('\n')[0]}), so the merge is refused.\nRun: ${R.cmd('merge-gate.js', `check ${c.pr}`)}`; }
    if (!g.ok) return `merge of PR ${c.pr} refused: ${g.why}.\n${g.fix}`;
    const full = R.FULL_SHA.test(g.head || '') ? g.head : null;
    if (!c.head) return `merge of PR ${c.pr} refused: name the reviewed head, so GitHub merges exactly that commit.\nRun: ${mergeCmd(c.pr, product, full)}`;
    if (!R.FULL_SHA.test(c.head)) return `merge of PR ${c.pr} refused: name the full head sha (40 characters), so GitHub merges exactly that commit.\nRun: ${mergeCmd(c.pr, product, full)}`;
  }
  return null;
}

// `gh api` calls on a pull request's merge endpoint get the same gate as `gh pr merge`.
function restMergeProblem(command, { root, team, gh, product }) {
  const L = require('../hooks/scripts/lane.js');
  for (const seg of L.splitCommand(command)) {
    const c = L.ghApiCall(L.tokens(seg));
    if (!c || !/\/merges?(?:$|[/?])/.test(c.endpoint || '')) continue;
    const m = L.MERGE_ENDPOINT.exec(c.endpoint || '');
    const sha = c.fields.sha || null;
    const pr = m ? m[2] : '<pr>';
    if (!m || c.method !== 'PUT' || c.bad) return `only a pull request's merge endpoint, as PUT with its fields inline, can be checked (got \`${seg.trim().slice(0, 80)}\`).\nRun: ${R.cmd('merge-gate.js', `check ${pr}`)} and the merge it prints`;
    if (!product) return `merge of PR ${pr} refused: ${UNKNOWN(pr).replace('\n', '.\n')}`;
    if (!sameRepo(m[1], product)) return `merge of PR ${pr} refused: ${m[1]} is not the product repository (${product}), and its reviews are recorded only for that one.\nRun: ${restMergeCmd(pr, product)}`;
    let g;
    try { g = gate(root, pr, { head: sha, gh, team, repo: product }); } catch (err) { return `the merge gate could not run (${String(err.message).split('\n')[0]}), so the merge is refused.\nRun: ${R.cmd('merge-gate.js', `check ${pr}`)}`; }
    if (!g.ok) return `merge of PR ${pr} refused: ${g.why}.\n${g.fix}`;
    const full = R.FULL_SHA.test(g.head || '') ? g.head : null;
    if (!sha || !R.FULL_SHA.test(sha)) return `merge of PR ${pr} refused: name the reviewed head in full (\`-f sha=<40 characters>\`), so GitHub merges exactly that commit.\nRun: ${restMergeCmd(pr, product, full)}`;
  }
  return null;
}

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--head', '--project'].includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

// state-merged on each story the merge carried whose author is the pull request's owner; retry-safe:
// a story already marked for this pull request is skipped, a failed update is reported for a retry
function markMerged(pr, req, who, { cwd, env, bd, now }) {
  const evidence = require('./evidence.js');
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });
  const lines = [];
  let failed = false;
  for (const id of req ? (req.stories || req.beads || []) : []) {
    let b = null;
    try { b = store.show(id); } catch (err) { b = null; }
    if (!b) { lines.push(`${id}: not marked merged (bd cannot read it)`); failed = true; continue; }
    if (req.owner && !G.authorsOf(b).actors.some((a) => R.norm(a) === req.owner)) { lines.push(`${id}: not marked merged: its author is not ${req.owner}, who opened PR ${pr}`); continue; }
    if ((b.labels || []).includes(G.STATE.merged) && String((b.metadata || {}).merged_pr) === String(pr)) { lines.push(`${id}: already marked merged (${pr})`); continue; }
    let r;
    try { r = evidence.main(['state', id, 'merged', '--pr', String(pr)], { cwd, env, bd: store, now, who }); } catch (err) { r = { code: 1, out: err.message }; }
    if (r.code !== 0) { lines.push(`${id}: not marked merged (${String(r.out).replace(/^evidence\.js: /, '').split('\n')[0]})`); failed = true; } else lines.push(r.out.replace(/^evidence\.js: /, ''));
  }
  return { lines, failed };
}

// One handoff per story the merge carried that is marked merged and not yet deployed; a story not
// marked (bd could not read it, another author) gets none: its line above says what to do by hand.
function handOver(pr, req, who, { bd, now, head }) {
  const HO = require('./lib/handoff.js');
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });
  const lines = [];
  for (const id of req ? (req.stories || req.beads || []) : []) {
    let b = null;
    try { b = store.show(id); } catch (err) { b = null; }
    if (!b || b.status === 'closed' || !G.stateOf(b) || G.stateOf(b) === 'cut') continue;
    // the deploy of this merge is the step: not yet taken when no deploy is recorded after it (a first
    // merge, or a follow-up PR on a story already deployed or verified; Copilot, #86)
    const bm = b.metadata || {};
    if (bm.deployed_at && (!bm.merged_at || Date.parse(bm.deployed_at) >= Date.parse(bm.merged_at))) continue;
    // only a story this PR marked: the same author check as markMerged, and merged by this PR, so a
    // story merged by another PR keeps its own handoff (Copilot, #86)
    if (req.owner && !G.authorsOf(b).actors.some((a) => R.norm(a) === req.owner)) continue;
    if (String((b.metadata || {}).merged_pr || '') !== String(pr)) continue;
    let r = null;
    try { r = HO.queue(who.root, { bead: id, step: 'deploy', to: who.instance, from: who.instance, pr, sha: head, at: now }); } catch (err) { lines.push(`${id}: the deploy was not handed to the watchdog (${err.message})`); continue; }
    if (r) lines.push(`${id}: its deploy is handed to the watchdog, which wakes ${who.instance} for it if this turn ends first`);
  }
  return lines;
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, gh, now, who: given } = {}) {
  const a = parse(argv);
  const [sub, pr] = a._;
  if (!sub || !pr || !R.PR.test(pr)) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'merge-gate.js: no project found; pass --project <root>' };
  const repo = productRepoOf(who.team, { roleDir: who.roleDir });
  if (!repo && (sub === 'check' || sub === 'merged')) return { code: 1, out: `merge-gate.js: ${UNKNOWN(pr)}` };
  if (sub === 'check') return check(who.root, pr, { head: a.head, gh, team: who.team, repo });
  if (sub !== 'merged') return { code: 2, out: USAGE };
  const wp = writerProblem(who, ['delivery-lead']);
  if (wp) return { code: 1, out: `merge-gate.js: ${wp}` };
  const { rows, problem } = R.read(who.root, pr);
  if (problem) return { code: 1, out: `merge-gate.js: ${problem}.` };
  const req = R.lastRequest(rows);
  const at = now || new Date().toISOString();
  let row = rows.find((r) => r.type === 'merged');
  const out = [];
  if (!row) {
    const view = ghFor(who.root, gh, repo)(pr) || { unavailable: 'no answer' };
    if (!view.unavailable && String(view.state || '').toUpperCase() !== 'MERGED') return { code: 1, out: `merge-gate.js: PR ${pr} is ${String(view.state || 'not merged').toLowerCase()} on GitHub, not merged.\nMerge it first: ${mergeCmd(pr, repo)}` };
    const head = view.headRefOid || a.head;
    if (!head) return { code: 2, out: `merge-gate.js: gh cannot read PR ${pr} (${view.unavailable}); name the merged head: merge-gate.js merged ${pr} --head <sha>` };
    // a merge without a passing review on its head (outside the gate) is recorded, and is a warning
    const v = R.evaluate(pr, rows, { head, ci: { state: 'green', names: [] }, mergeable: null, botsCount: botsCountOf(who.team), repo });
    row = R.append(who.root, pr, { type: 'merged', repo, head, beads: req ? req.beads || [] : [], gated: v.ok, by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    out.push(`${row.id}: PR ${pr} merged at ${R.short(head)}`);
    const unpublished = R.publish(who.root, pr, who.instance, 'merged', { env });
    if (unpublished) out.push(unpublished);
    if (!v.ok) {
      const w = require('./lib/warnings.js').record(who.root, { kind: 'merge-ungated', rule: 'R-32', bead: (req && req.beads && req.beads[0]) || null, detail: `PR ${pr} merged at ${R.short(head)} without a passing review of that head: ${v.why}`, raisedBy: who.instance, instance: who.instance });
      out.push(`warning ${w ? w.id : 'unrecorded'}: merged without a passing review of ${R.short(head)} (${v.why})`);
    }
  } else out.push(`${row.id}: PR ${pr} is recorded as merged at ${R.short(row.head)}`);
  if (!req) return { code: 0, out: [...out, `no bead is recorded for PR ${pr}: set its state by hand, \`evidence.js state <bead> merged --pr ${pr}\``].join('\n') };
  const m = markMerged(pr, req, who, { cwd, env, bd, now: at });
  out.push(...m.lines);
  // the deploy is the next step, and it is this role's: handed to the watchdog (lib/handoff.js), which
  // wakes this session at its next pass if its turn ends here, instead of after the two-hour stall limit
  out.push(...handOver(pr, req, who, { bd, now: at, head: row.head }));
  // fix on fix (R-22): a second fix on the same symptom within 48 h opens a spike for its cause
  try { out.push(...require('./lib/andon.js').fixChain(who.root, { pr, bd: bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 }), now: at, who })); } catch (err) { out.push(`note: the fix-on-fix check did not run (${err.message})`); }
  if (m.failed) return { code: 1, out: `${out.join('\n')}.\nRetry: ${R.cmd('merge-gate.js', `merged ${pr}`)}` };
  return { code: 0, out: out.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `merge-gate.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, gate, check, ghPrCalls, mergeCommandProblem, handOver };
