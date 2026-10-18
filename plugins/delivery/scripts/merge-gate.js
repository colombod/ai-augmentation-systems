#!/usr/bin/env node
// scripts/merge-gate.js — the merge gate (R-32): the Delivery Manager merges only on a passing
// independent review of the pull request's current head, with CI green and no conflict.
//   merge-gate.js check <pr> [--head <sha>]     read only; exit 0 when the merge may go ahead
//   merge-gate.js merged <pr> [--head <sha>]    after the merge: the merged row, and state-merged on its beads
// The lane runs the same check before it lets the Delivery Manager's `gh pr merge` through, and asks
// for `--match-head-commit <sha>` so GitHub merges exactly the head that was reviewed. gh supplies
// the head, mergeable and the checks; where gh cannot read them, the head named on the command and
// the Delivery Manager's recorded `review.js ci` row stand in. Size and scope are warnings only.
// Exit codes: 0 passes / done; 1 refused; 2 usage.
const R = require('./lib/reviews.js');
const G = require('./lib/gates.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');
const { viewPr, repoOf } = require('./lib/gh-pr.js');

const USAGE = 'usage: merge-gate.js check <pr> [--head <sha>] | merge-gate.js merged <pr> [--head <sha>]';

function ghFor(team, root, gh, repo) {
  if (gh) return gh;
  const r = repo || repoOf(team && team.product_repo);
  return (pr) => viewPr(pr, { repo: r, cwd: root });
}

function sizeThreshold(root) {
  try { return require('./lib/goal.js').value(root, 'pr_size_lines', { warn: false }) || R.DEFAULT_SIZE; } catch (err) { return R.DEFAULT_SIZE; }
}

// { ok, why, fix, head, review, warnings, view }
function gate(root, pr, { head: named, gh, team, repo } = {}) {
  const view = ghFor(team, root, gh, repo)(pr) || { unavailable: 'no answer' };
  const { rows, problem } = R.read(root, pr);
  const seen = view.headRefOid || null;
  if (seen && named && !G.shaMatch(seen, named)) {
    return { ok: false, why: `PR ${pr} is now at ${R.short(seen)}, not ${R.short(named)}: new commits arrived after the review`, fix: `Ask for review of ${R.short(seen)}: ${R.cmd('review.js', `request ${pr} --reviewer ${(R.lastRequest(rows) || {}).reviewer || '<reviewer>'}`)}`, rows };
  }
  const head = seen || named || null;
  const ci = view.unavailable ? null : R.ciOf(view.statusCheckRollup);
  const botsCount = Boolean(team && team.review && team.review.bots_count === true);
  const v = R.evaluate(pr, rows, { head, ci, mergeable: view.mergeable, botsCount, problem });
  const req = R.lastRequest(rows);
  const lines = view.unavailable ? (req ? req.lines : null) : R.changedLines(view);
  const warnings = R.scopeWarnings({ pr, lines: lines == null ? NaN : lines, stories: req ? req.stories || [] : [], threshold: sizeThreshold(root) });
  return { ...v, head, warnings, view, rows };
}

function check(root, pr, opts) {
  const g = gate(root, pr, opts);
  const warn = g.warnings.map((w) => `warning: ${w.detail}`);
  if (!g.ok) return { code: 1, out: [`merge-gate: refused: ${g.why}.`, g.fix, ...warn].join('\n'), gate: g };
  const via = g.view.unavailable ? ` (gh: ${g.view.unavailable}; head and CI from the record)` : '';
  return { code: 0, out: [`merge-gate: PR ${pr} passes at ${R.short(g.head)}: review ${g.review.id} by ${g.review.reviewer}, CI green${via}.`,
    `Merge: \`gh pr merge ${pr} --match-head-commit ${g.head} --squash\`, then ${R.cmd('merge-gate.js', `merged ${pr}`)}`, ...warn].join('\n'), gate: g };
}

// The words of each `gh pr merge` in a command: [{ pr, head, flags, repo }]
const VALUE_FLAGS = ['--match-head-commit', '-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '-R', '--repo'];
function mergeCalls(command) {
  const L = require('../hooks/scripts/lane.js');
  const out = [];
  for (const seg of L.splitCommand(command)) {
    const t = L.tokens(seg).filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && x !== 'env');
    if (require('path').basename(t[0] || '') !== 'gh') continue;
    const words = [];
    let repo = null;
    let head = null;
    const flags = [];
    for (let i = 1; i < t.length; i++) {
      const [f, inline] = t[i].startsWith('--') ? t[i].split(/=(.*)/s) : [t[i], undefined];
      if (VALUE_FLAGS.includes(f)) {
        const val = inline !== undefined ? inline : t[++i];
        if (f === '-R' || f === '--repo') repo = val;
        if (f === '--match-head-commit') head = val;
        continue;
      }
      if (t[i].startsWith('-')) { flags.push(f); continue; }
      words.push(t[i]);
    }
    if (words[0] !== 'pr' || words[1] !== 'merge') continue;
    const target = words[2] || '';
    const m = /^(\d+)$/.exec(target) || /\/pull\/(\d+)(?:[/?#].*)?$/.exec(target);
    out.push({ pr: m ? m[1] : null, target, head, flags, repo });
  }
  return out;
}

// The lane's check for the Delivery Manager's merge: null to allow, or the two-line reason
function mergeCommandProblem(command, { root, team, gh } = {}) {
  for (const c of mergeCalls(command)) {
    const which = c.pr || '<pr number>';
    if (!c.pr) return `merging needs the pull request's number, so its review can be checked (got ${c.target ? `"${c.target.slice(0, 60)}"` : 'none'}).\nRun: ${R.cmd('merge-gate.js', `check ${which}`)}, then \`gh pr merge ${which} --match-head-commit <head sha> --squash\``;
    const bad = c.flags.find((f) => ['--admin', '--auto'].includes(f));
    if (bad) return `\`gh pr merge ${bad}\` merges outside the gate (${bad === '--admin' ? 'it bypasses the branch rules' : 'it merges later, on whatever head is there'}).\nMerge now, on the reviewed head: \`gh pr merge ${c.pr} --match-head-commit <head sha> --squash\``;
    let g;
    try { g = gate(root, c.pr, { head: c.head, gh, team, repo: c.repo }); } catch (err) { return `the merge gate could not run (${String(err.message).split('\n')[0]}), so the merge is refused.\nRun: ${R.cmd('merge-gate.js', `check ${c.pr}`)}`; }
    if (!g.ok) return `merge of PR ${c.pr} refused: ${g.why}.\n${g.fix}`;
    if (!c.head) return `merge of PR ${c.pr} refused: name the reviewed head, so GitHub merges exactly that commit.\nRun: \`gh pr merge ${c.pr} --match-head-commit ${g.head} --squash\``;
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

function main(argv, { cwd = process.cwd(), env = process.env, bd, gh, now, who: given } = {}) {
  const a = parse(argv);
  const [sub, pr] = a._;
  if (!sub || !pr || !R.PR.test(pr)) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'merge-gate.js: no project found; pass --project <root>' };
  if (sub === 'check') return check(who.root, pr, { head: a.head, gh, team: who.team });
  if (sub !== 'merged') return { code: 2, out: USAGE };
  const wp = writerProblem(who, ['delivery-lead']);
  if (wp) return { code: 1, out: `merge-gate.js: ${wp}` };
  const { rows, problem } = R.read(who.root, pr);
  if (problem) return { code: 1, out: `merge-gate.js: ${problem}.` };
  if (rows.some((r) => r.type === 'merged')) return { code: 0, out: `PR ${pr} is already recorded as merged` };
  const view = ghFor(who.team, who.root, gh)(pr) || { unavailable: 'no answer' };
  if (!view.unavailable && String(view.state || '').toUpperCase() !== 'MERGED') return { code: 1, out: `merge-gate.js: PR ${pr} is ${String(view.state || 'not merged').toLowerCase()} on GitHub, not merged.\nMerge it first: \`gh pr merge ${pr} --match-head-commit <head sha> --squash\`` };
  const head = view.headRefOid || a.head;
  if (!head) return { code: 2, out: `merge-gate.js: gh cannot read PR ${pr} (${view.unavailable}); name the merged head: merge-gate.js merged ${pr} --head <sha>` };
  const req = R.lastRequest(rows);
  // a merge without a passing review on its head (outside the gate) is recorded, and is a warning
  const v = R.evaluate(pr, rows, { head, ci: { state: 'green', names: [] }, mergeable: null, botsCount: Boolean(who.team && who.team.review && who.team.review.bots_count === true) });
  const at = now || new Date().toISOString();
  const beads = req ? req.beads || [] : [];
  const row = R.append(who.root, pr, { type: 'merged', head, beads, gated: v.ok, by: who.roleId, actor: who.actor || who.instance, at });
  const lines = [`${row.id}: PR ${pr} merged at ${R.short(head)}`];
  if (!v.ok) {
    const w = require('./lib/warnings.js').record(who.root, { kind: 'merge-ungated', rule: 'R-32', bead: beads[0] || null, detail: `PR ${pr} merged at ${R.short(head)} without a passing review of that head: ${v.why}`, raisedBy: who.instance, instance: who.instance });
    lines.push(`warning ${w ? w.id : 'unrecorded'}: merged without a passing review of ${R.short(head)} (${v.why})`);
  }
  const evidence = require('./evidence.js');
  const stories = req ? (req.stories || beads) : [];
  for (const id of stories) {
    const r = evidence.main(['state', id, 'merged', '--pr', String(pr)], { cwd, env, bd, now: at, who });
    lines.push(r.out.replace(/^evidence\.js: /, ''));
  }
  if (!stories.length) lines.push(`no bead is recorded for PR ${pr}: set its state by hand, \`evidence.js state <bead> merged --pr ${pr}\``);
  return { code: 0, out: lines.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `merge-gate.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, gate, check, mergeCalls, mergeCommandProblem };
