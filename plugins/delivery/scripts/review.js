#!/usr/bin/env node
// scripts/review.js — review records for pull requests (R-32, R-24).
//   review.js request <pr> --reviewer <session or subagent id> [--bead <id>]... [--head <sha> --branch <head branch> --lines <n>]
//   review.js record <pr> --head <sha> --result pass|changes [--by <subagent id>] --summary '<one line>' [--findings <file>] [--advisory]
//   review.js ci <pr> --head <sha> --result pass|fail --run <run id or URL>        where gh cannot read the checks
//   review.js send-back <pr> --reason conflict|changes|ci|'<text>' [--note '<what to fix>']
//   review.js show <pr> | review.js list [--plain] [--json]                         read only
// Rows go to <project>/.delivery/reviews/prs/<pr>.ndjson (lib/reviews.js), for the product repository
// (team.json product_github; gh is always given -R).
// Who authored the pull request is a GitHub fact: its head branch, team/<builder instance>, the
// worktree branch prepare-role gives each builder. Every bead its body refs (`Refs <bead>`) must have
// that builder among its stamped authors; a bead with no recorded author, or another builder's, is
// refused. The Delivery Manager requests each review (a session or a subagent, never an author, never
// itself); only a requested reviewer's row for that head is recorded: a session records its own, the
// Delivery Manager records the subagent or bot it asked, by id, and never in a session's name. Bots
// are advisory. Identities are compared normalised (case, user@host/ and @host forms). Size and scope
// are warnings, never a refusal. Exit codes: 0 done; 1 refused; 2 usage.
const R = require('./lib/reviews.js');
const W = require('./lib/warnings.js');
const G = require('./lib/gates.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');
const { viewPr, productRepoOf, UNKNOWN } = require('./lib/gh-pr.js');

const USAGE = 'usage: review.js request <pr> --reviewer <id> [--bead <id>] | record <pr> --head <sha> --result pass|changes [--by <id>] --summary <text> [--advisory] | ci <pr> --head <sha> --result pass|fail --run <ref> | send-back <pr> --reason <why> [--note <text>] | show <pr> | list [--plain] [--json]';
const VALUE = ['--reviewer', '--head', '--branch', '--lines', '--result', '--by', '--summary', '--findings', '--run', '--reason', '--note', '--project'];
const DM = 'delivery-lead';

function parse(argv) {
  const out = { _: [], bead: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bead') { if (argv[i + 1] === undefined) throw new Error('--bead needs a value'); out.bead.push(argv[++i]); }
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (['--advisory', '--plain', '--json'].includes(a)) out[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const refuse = (why, fix) => ({ code: 1, out: `review.js: ${why}.${fix ? `\n${fix}` : ''}` });

// The pull request as gh sees it in the product repository (or { unavailable })
function ghFor(who, gh, repo) {
  if (gh) return gh;
  return (pr) => viewPr(pr, { repo, cwd: who.root });
}

function beadsOf(store, ids) {
  const out = [];
  for (const id of ids) {
    let b = null;
    try { b = store.show(id); } catch (err) { b = null; }
    if (!b) return { missing: id };
    out.push(b);
    if (b.parent && !(b.labels || []).includes('story')) { try { const p = store.show(b.parent); if (p) out.push(p); } catch (err) { /* the bead alone */ } }
  }
  return { beads: out };
}

function sizeThreshold(root) {
  try { return require('./lib/goal.js').value(root, 'pr_size_lines', { warn: false }) || R.DEFAULT_SIZE; } catch (err) { return R.DEFAULT_SIZE; }
}

// open pull requests per builder (R-23): more than the limit (team.json budget.open_prs_per_builder, 2) warns.
// Open on GitHub (a pull request closed without merging stops counting, Copilot 925); where gh cannot
// read it, an unmerged request from the last 14 days counts
const STALE_DAYS = 14;
function openPrsWarning(who, pr, owner, view, at) {
  const v = who.team && who.team.budget && who.team.budget.open_prs_per_builder;
  const limit = Number.isInteger(v) && v > 0 ? v : 2;
  const open = R.listPrs(who.root).filter((p) => p !== String(pr)).filter((p) => {
    const { rows } = R.read(who.root, p);
    const req = R.lastRequest(rows);
    if (!req || req.owner !== owner || rows.some((r) => r.type === 'merged')) return false;
    const live = view ? view(p) : null;
    if (live && !live.unavailable && live.state) return String(live.state).toUpperCase() === 'OPEN';
    return Date.parse(at) - Date.parse(req.at) < STALE_DAYS * 86400e3;
  });
  return open.length >= limit ? [{ kind: 'open-prs', rule: 'R-23', detail: `${owner} already has ${open.length} open pull request(s) (${open.map((p) => `PR ${p}`).join(', ')}), the limit is ${limit}: get those merged before opening more` }] : [];
}

function instancesOf(who) {
  try { return who.team ? require('./lib/manifest.js').expandInstances(who.team) : []; } catch (err) { return []; }
}
// the Delivery Manager under any of its names: its instance, its role, the delivery-manager alias, its actor
const isManager = (who, id) => R.norm(id) === DM || [who.instance, who.actor].filter(Boolean).some((x) => R.norm(x) === R.norm(id));

function reviewerBrief(pr, head, req) {
  return [
    'Reviewer brief (give it to the reviewer as written):',
    `  Review pull request ${pr} of ${req.repo} at head ${head} only (\`gh pr diff ${pr} -R ${req.repo}\`; check it out and test it with \`node \${CLAUDE_PLUGIN_ROOT}/scripts/review-run.js checkout ${pr} ${head}\` and \`... review-run.js test ${pr}\`), against ${req.beads.join(', ')} and its story's acceptance criteria.`,
    '  Run the product\'s tests on that head and quote their real output. Do not modify code, push, approve on GitHub or merge.',
    '  Report `pass` or `changes` on the first line, then each finding: file:line, what is wrong, why it matters.',
    `Record the outcome: ${R.cmd('review.js', `record ${pr} --head ${head} --result pass|changes${req.session ? '' : ` --by ${req.reviewer}`} --summary '<one line>'`)}`,
  ];
}

// Bind the pull request to its author by its head branch, and every bead it refs to that author
function bindAuthor(pr, branch, beads, ids) {
  const owner = R.branchOwner(branch);
  if (!owner) return { why: `PR ${pr} is not on a builder's branch (${branch || 'unknown'}), so its author cannot be told`, fix: 'A builder opens its pull request from its own team/<instance> branch; ask its owner to reopen it from there' };
  for (const id of ids) {
    const b = beads.find((x) => x.id === id);
    const actors = G.authorsOf(b).actors;
    if (!actors.length) return { why: `${id} has no recorded author: no builder claimed it`, fix: `The builder claims it first (\`bd update ${id} --claim\`), then ask for the review again` };
    if (!actors.some((x) => R.norm(x) === owner)) return { why: `PR ${pr} is on ${owner}'s branch (${branch}), but ${id} was built by ${[...new Set(actors.map(R.norm))].join(', ')}`, fix: `Ask ${owner} to name its own bead in \`Refs\`, then ask for the review again` };
  }
  return { owner };
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, gh, now, who: given } = {}) {
  const a = parse(argv);
  const [sub, pr] = a._;
  if (!sub) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'review.js: no project found; pass --project <root>' };
  const at = now || new Date().toISOString();
  const store = () => bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });
  const repo = productRepoOf(who.team, { roleDir: who.roleDir });

  if (sub === 'list') return list(who.root, a, repo ? ghFor(who, gh, repo) : null, { botsCount: Boolean(who.team && who.team.review && who.team.review.bots_count === true), repo });
  if (!pr || !R.PR.test(pr)) return { code: 2, out: USAGE };
  const { rows, problem } = R.read(who.root, pr);
  if (sub === 'show') return { code: 0, out: rows.map((r) => JSON.stringify(r)).join('\n') + (problem ? `\nwarning: ${problem}` : '') || `no review records for PR ${pr}` };
  if (problem) return refuse(problem, `Restore it from git: \`git log -p -- ${R.REL}/${pr}/\``);
  const base = { repo, by: who.roleId, actor: who.actor || who.instance, at };
  const team = instancesOf(who);

  if (sub === 'request') {
    const wp = writerProblem(who, [DM]);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.reviewer) return { code: 2, out: USAGE };
    if (!repo) { const [why, fix] = UNKNOWN(pr).split('\n'); return refuse(why.replace(/\.$/, ''), fix); }
    const view = ghFor(who, gh, repo)(pr) || { unavailable: 'no answer' };
    const head = view.headRefOid || a.head;
    if (!head || !R.SHA.test(head)) return refuse(`PR ${pr}'s head is not known${view.unavailable ? ` (gh: ${view.unavailable})` : ''}`, `Name it: ${R.cmd('review.js', `request ${pr} --reviewer ${a.reviewer} --head <head sha> --branch <head branch>`)}`);
    const branch = view.headRefName || a.branch;
    const ids = [...new Set([...R.refsOf(view.body), ...a.bead])];
    if (!ids.length) return refuse(`PR ${pr} names no bead (\`Refs <bead id>\` in its body), so its author cannot be checked`, `Ask its owner to add the line, or name it: ${R.cmd('review.js', `request ${pr} --reviewer ${a.reviewer} --bead <id>`)}`);
    const got = beadsOf(store(), ids);
    if (got.missing) return refuse(`no bead ${got.missing}`, `Check the pull request's \`Refs\` line: \`bd show ${got.missing}\``);
    const bound = bindAuthor(pr, branch, got.beads, ids);
    if (bound.why) return refuse(bound.why, bound.fix);
    const authors = [...new Set([...R.authorsOfBeads(got.beads, team), bound.owner])];
    if (R.isAuthor(authors, a.reviewer)) return refuse(`${a.reviewer} is an author of PR ${pr} (${ids.join(', ')}): the builder is not its own reviewer`, `Ask someone else: ${R.cmd('review.js', `request ${pr} --reviewer <another session or a subagent>`)}`);
    if (isManager(who, a.reviewer)) return refuse('the Delivery Manager asks for the review and merges on it; it does not review its own merge', `Ask a reviewer subagent or another session: ${R.cmd('review.js', `request ${pr} --reviewer <id>`)}`);
    const stories = R.storiesOf(got.beads.filter((b) => ids.includes(b.id)));
    const lines = !view.unavailable ? R.changedLines(view) : Number(a.lines);
    const warnings = [...R.scopeWarnings({ pr, lines, stories, threshold: sizeThreshold(who.root) }), ...openPrsWarning(who, pr, bound.owner, ghFor(who, gh, repo), at)];
    const story = got.beads.find((b) => stories.includes(b.id));
    const session = team.some((i) => R.norm(i.instance) === R.norm(a.reviewer));
    const row = R.append(who.root, pr, { type: 'request', head, branch: branch || null, owner: bound.owner, reviewer: a.reviewer, session, beads: ids, stories, authors, title: (story && story.title) || view.title || null, lines: Number.isFinite(lines) ? lines : null, ...base }, who.instance);
    const warned = warnings.map((w) => { const x = W.record(who.root, { ...w, bead: stories[0], raisedBy: who.instance, instance: who.instance }); return `warning ${x ? x.id : 'unrecorded'}: ${w.detail}`; });
    return { code: 0, row, out: [`${row.id}: review of PR ${pr} at ${R.short(head)} requested from ${a.reviewer}`, ...warned, ...reviewerBrief(pr, head, row)].join('\n') };
  }

  if (sub === 'record') {
    if (!who.roleId) return refuse('a review is recorded from a role session; none is active here');
    const by = a.by || who.instance;
    if (!a.head || !R.SHA.test(a.head) || !['pass', 'changes'].includes(a.result) || !a.summary) return { code: 2, out: USAGE };
    const req = R.lastRequest(rows);
    if (!req) return refuse(`no review was requested for PR ${pr}, so its authors are not known`, `The Delivery Manager asks first: ${R.cmd('review.js', `request ${pr} --reviewer ${by}`)}`);
    let authors = req.authors || [];
    const fresh = beadsOf(store(), req.beads || []);
    if (fresh.beads) authors = [...new Set([...authors, ...R.authorsOfBeads(fresh.beads, team)])];
    if (R.isAuthor(authors, by)) return refuse(`${by} is an author of PR ${pr}: the builder is not its own reviewer, so its review does not count`, `Ask someone else: ${R.cmd('review.js', `request ${pr} --reviewer <another session or a subagent>`)}`);
    if (R.isAuthor(authors, who.instance) || R.isAuthor(authors, who.actor)) return refuse(`this session (${who.instance}) is an author of PR ${pr}: a review it records or dispatches does not count`, 'Hand the pull request to the Delivery Manager, which asks an independent reviewer.');
    if (who.roleId === DM && isManager(who, by)) return refuse('the Delivery Manager merges on the review; it does not review its own merge', 'Name the subagent whose outcome this is: --by <subagent id>');
    if (who.roleId === DM && team.some((i) => R.norm(i.instance) === R.norm(by))) return refuse(`${by} is a session of this team: it records its own review`, `Ask ${by} to run: ${R.cmd('review.js', `record ${pr} --head ${a.head} --result ${a.result} --summary '<one line>'`)}`);
    if (who.roleId !== DM && R.norm(by) !== R.norm(who.instance)) return refuse(`a session records only its own review (this is ${who.instance}, not ${by})`, 'A subagent\'s or a bot\'s review is recorded by the Delivery Manager that asked for it.');
    const asked = rows.some((r) => r.type === 'request' && R.norm(r.reviewer) === R.norm(by) && G.shaMatch(r.head, a.head));
    if (!asked) return refuse(`${by} was not asked to review PR ${pr} at ${R.short(a.head)}`, `Ask for it: ${R.cmd('review.js', `request ${pr} --reviewer ${by}`)}`);
    const kind = a.advisory || R.isBot(by) ? 'advisory' : 'independent';
    let note = '';
    const view = repo ? ghFor(who, gh, repo)(pr) : null;
    if (view && view.headRefOid && !G.shaMatch(view.headRefOid, a.head)) note = `\nnote: PR ${pr} is now at ${R.short(view.headRefOid)}, so this review of ${R.short(a.head)} will not count for the merge: review ${R.short(view.headRefOid)}`;
    const row = R.append(who.root, pr, { type: 'review', head: a.head, result: a.result, reviewer: by, kind, summary: String(a.summary).slice(0, 500), ...(a.findings ? { findings: a.findings } : {}), recorded_by: who.instance, ...base }, who.instance);
    const next = a.result === 'pass' ? `Next: ${R.cmd('merge-gate.js', `check ${pr}`)}` : `Next: ${R.cmd('review.js', `send-back ${pr} --reason changes --note '<the findings>'`)}`;
    return { code: 0, row, out: `${row.id}: ${a.result} by ${by} on ${R.short(a.head)} (${kind}${kind === 'advisory' ? ': does not satisfy the gate alone' : ''})${note}\n${next}` };
  }

  if (sub === 'ci') {
    const wp = writerProblem(who, [DM]);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.head || !R.SHA.test(a.head) || !['pass', 'fail'].includes(a.result) || !a.run) return { code: 2, out: USAGE };
    const row = R.append(who.root, pr, { type: 'ci', head: a.head, result: a.result, run: a.run, ...base }, who.instance);
    return { code: 0, row, out: `${row.id}: CI ${a.result} on ${R.short(a.head)} (${a.run})` };
  }

  if (sub === 'send-back') {
    const wp = writerProblem(who, [DM]);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.reason) return { code: 2, out: USAGE };
    const req = R.lastRequest(rows);
    if (!req) return refuse(`no review was requested for PR ${pr}, so its owner is not known`, `Ask first: ${R.cmd('review.js', `request ${pr} --reviewer <id>`)}`);
    const view = repo ? ghFor(who, gh, repo)(pr) : null;
    const head = (view && view.headRefOid) || [...rows].reverse().find((r) => r.head).head;
    const owners = req.owner ? [req.owner] : [...new Set((req.authors || []).map(R.norm))];
    const what = { conflict: 'it has conflicts with the default branch: merge or rebase the default branch into your branch and resolve them', changes: 'the review asked for changes', ci: 'CI is red' }[a.reason] || a.reason;
    const row = R.append(who.root, pr, { type: 'sent-back', head, reason: a.reason, note: a.note || null, owners, ...base }, who.instance);
    const text = `${at.slice(0, 10)}: PR ${pr} sent back at ${R.short(head)}: ${what}${a.note ? ` (${a.note})` : ''}; a new review is needed after the fix (${row.id})`;
    for (const id of req.beads || []) { try { store().update(id, { appendNotes: text }); } catch (err) { /* the row and the message still stand */ } }
    return { code: 0, row, out: `${row.id}: PR ${pr} sent back to ${owners.join(', ') || 'its owner'}; noted in ${(req.beads || []).join(', ')}\nMessage ${owners.join(', ') || 'the owner'}: "PR ${pr}: ${what}${a.note ? `: ${a.note}` : ''}. Fix it on your branch, push, and tell me; I will ask for a new review."` };
  }
  return { code: 2, out: USAGE };
}

// the raw text of a pull request's chains (for the title of a damaged record)
function fsRead(root, pr) {
  const fs = require('fs');
  try { return fs.readdirSync(R.dirOf(root, pr)).filter((f) => f.endsWith('.ndjson')).map((f) => fs.readFileSync(require('path').join(R.dirOf(root, pr), f), 'utf8')).join('\n'); } catch (err) { return ''; }
}

const PLAIN = {
  damaged: (t) => `${t} has a damaged review record; the Delivery Manager restores it before anything merges`,
  waiting: (t) => `${t} is waiting for review`,
  stale: (t) => `${t} changed after its review and needs review again`,
  changes: (t) => `${t} has changes requested by its reviewer`,
  'sent-back': (t) => `${t} went back to its builder to fix before it can merge`,
  failing: (t) => `${t} is reviewed, but its build is failing`,
  passed: (t) => `${t} is reviewed; the merge check comes next`,
  ready: (t) => `${t} is reviewed and ready to merge`,
  merged: (t) => `${t} is reviewed and merged; checking it on the customer's app next`,
};

// where each pull request stands; with gh (live) the head and the checks are read for the open ones
function list(root, a, live, { botsCount = false, repo } = {}) {
  const out = R.listPrs(root).map((pr) => {
    const { rows, problem } = R.read(root, pr);
    // a broken chain is reported as such: its readable rows are not the record
    if (problem) {
      const req = [...String(fsRead(root, pr)).matchAll(/"title":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).pop();
      return { pr: Number(pr), state: 'damaged', problem, title: req || null };
    }
    const req = R.lastRequest(rows);
    const merged = rows.some((r) => r.type === 'merged');
    const view = live && !merged ? live(pr) : null;
    return { pr: Number(pr), state: R.stateOf(rows, view, { botsCount, repo }), title: req && req.title, reviewer: req && req.reviewer };
  });
  if (a.json) return { code: 0, out: JSON.stringify(out) };
  if (!out.length) return { code: 0, out: 'No pull requests under review.' };
  // the Chief of Staff's wording: the change in plain words, never a bead or pull request number
  if (a.plain) return { code: 0, out: out.map((p) => PLAIN[p.state](p.title ? `The change "${p.title}"` : 'A change')).join('\n') };
  return { code: 0, out: out.map((p) => `PR ${p.pr}: ${p.state}${p.problem ? ` (${p.problem})` : ''}${p.reviewer ? ` (reviewer ${p.reviewer})` : ''}${p.title ? ` ${p.title}` : ''}`).join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `review.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, list };
