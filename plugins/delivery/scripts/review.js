#!/usr/bin/env node
// scripts/review.js — review records for pull requests (R-32, R-24).
//   review.js request <pr> --reviewer <role instance|subagent id> [--bead <id>]... [--head <sha>] [--lines <n>]
//   review.js record <pr> --head <sha> --result pass|changes --by <reviewer id> --summary '<one line>' [--findings <file>] [--advisory]
//   review.js ci <pr> --head <sha> --result pass|fail --run <run id or URL>        where gh cannot read the checks
//   review.js send-back <pr> --reason conflict|changes|ci|'<text>' [--note '<what to fix>']
//   review.js show <pr> | review.js list [--plain] [--json]                         read only
// Rows go to <project>/.delivery/reviews/prs/<pr>.ndjson (lib/reviews.js). The Delivery Manager
// requests, records CI and sends back; a reviewer session records its own review, and the Delivery
// Manager records the review of a subagent it dispatched (--by <the subagent's id>) or of a bot (an
// advisory row). The reviewer is never an author of the pull request: an actor stamped on the beads it
// refs (`Refs <bead>` in its body), nor a review recorded from an author's session. Size and scope
// are warnings, never a refusal. Exit codes: 0 done; 1 refused; 2 usage.
const R = require('./lib/reviews.js');
const W = require('./lib/warnings.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');
const { viewPr, repoOf } = require('./lib/gh-pr.js');

const USAGE = 'usage: review.js request <pr> --reviewer <id> [--bead <id>] | record <pr> --head <sha> --result pass|changes --by <id> --summary <text> [--advisory] | ci <pr> --head <sha> --result pass|fail --run <ref> | send-back <pr> --reason <why> [--note <text>] | show <pr> | list [--plain] [--json]';
const VALUE = ['--reviewer', '--head', '--lines', '--result', '--by', '--summary', '--findings', '--run', '--reason', '--note', '--project'];

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

// The pull request as gh sees it (or { unavailable }), for the product repository in team.json
function ghFor(who, gh) {
  if (gh) return gh;
  const repo = repoOf(who.team && who.team.product_repo);
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

function reviewerBrief(pr, head, req) {
  return [
    'Reviewer brief (give it to the reviewer as written):',
    `  Review pull request ${pr} at head ${head} only (\`gh pr diff ${pr}\`; check it out in a scratch clone), against ${req.beads.join(', ')} and its story's acceptance criteria.`,
    '  Run the product\'s tests on that head and quote their real output. Do not modify code, push, approve on GitHub or merge.',
    '  Report `pass` or `changes` on the first line, then each finding: file:line, what is wrong, why it matters.',
    `Record the outcome: ${R.cmd('review.js', `record ${pr} --head ${head} --result pass|changes --by ${req.reviewer} --summary '<one line>'`)}`,
  ];
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, gh, now, who: given } = {}) {
  const a = parse(argv);
  const [sub, pr] = a._;
  if (!sub) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'review.js: no project found; pass --project <root>' };
  const at = now || new Date().toISOString();
  const store = () => bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });

  if (sub === 'list') return list(who.root, a);
  if (!pr || !R.PR.test(pr)) return { code: 2, out: USAGE };
  const { rows, problem } = R.read(who.root, pr);
  if (sub === 'show') return { code: 0, out: rows.map((r) => JSON.stringify(r)).join('\n') + (problem ? `\nwarning: ${problem}` : '') || `no review records for PR ${pr}` };
  if (problem) return refuse(problem, `Restore it from git: \`git log -p -- ${R.REL}/${pr}.ndjson\``);
  const base = { by: who.roleId, actor: who.actor || who.instance, at };

  if (sub === 'request') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.reviewer) return { code: 2, out: USAGE };
    const view = ghFor(who, gh)(pr);
    const head = (view && view.headRefOid) || a.head;
    if (!head || !R.SHA.test(head)) return refuse(`PR ${pr}'s head is not known${view && view.unavailable ? ` (gh: ${view.unavailable})` : ''}`, `Name it: ${R.cmd('review.js', `request ${pr} --reviewer ${a.reviewer} --head <head sha>`)}`);
    const ids = [...new Set([...R.refsOf(view && view.body), ...a.bead])];
    if (!ids.length) return refuse(`PR ${pr} names no bead (\`Refs <bead id>\` in its body), so its author cannot be checked`, `Ask its owner to add the line, or name it: ${R.cmd('review.js', `request ${pr} --reviewer ${a.reviewer} --bead <id>`)}`);
    const got = beadsOf(store(), ids);
    if (got.missing) return refuse(`no bead ${got.missing}`, `Check the pull request's \`Refs\` line: \`bd show ${got.missing}\``);
    const authors = R.authorsOfBeads(got.beads, instancesOf(who));
    if (R.isAuthor(authors, a.reviewer)) return refuse(`${a.reviewer} is an author of PR ${pr} (${ids.join(', ')}): the builder is not its own reviewer`, `Ask someone else: ${R.cmd('review.js', `request ${pr} --reviewer <another session or a subagent>`)}`);
    if (a.reviewer === who.instance || a.reviewer === who.roleId) return refuse('the Delivery Manager asks for the review and merges on it; it does not review its own merge', `Ask a reviewer subagent or another session: ${R.cmd('review.js', `request ${pr} --reviewer <id>`)}`);
    const stories = R.storiesOf(got.beads.filter((b) => ids.includes(b.id)));
    const lines = view && !view.unavailable ? R.changedLines(view) : Number(a.lines);
    const warnings = R.scopeWarnings({ pr, lines, stories, threshold: sizeThreshold(who.root) });
    const story = got.beads.find((b) => stories.includes(b.id));
    const row = R.append(who.root, pr, { type: 'request', head, reviewer: a.reviewer, beads: ids, stories, authors, title: (story && story.title) || (view && view.title) || null, lines: Number.isFinite(lines) ? lines : null, ...base });
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
    if (fresh.beads) authors = [...new Set([...authors, ...R.authorsOfBeads(fresh.beads, instancesOf(who))])];
    if (R.isAuthor(authors, by)) return refuse(`${by} is an author of PR ${pr}: the builder is not its own reviewer, so its review does not count`, `Ask someone else: ${R.cmd('review.js', `request ${pr} --reviewer <another session or a subagent>`)}`);
    if (R.isAuthor(authors, who.instance) || R.isAuthor(authors, who.actor)) return refuse(`this session (${who.instance}) is an author of PR ${pr}: a review it records or dispatches does not count`, 'Hand the pull request to the Delivery Manager, which asks an independent reviewer.');
    if (who.roleId === 'delivery-lead' && by === who.instance) return refuse('the Delivery Manager merges on the review; it does not review its own merge', `Name the reviewer whose outcome this is: --by <subagent id or session>`);
    if (who.roleId !== 'delivery-lead' && by !== who.instance) return refuse(`a session records only its own review (this is ${who.instance}, not ${by})`, 'A subagent\'s or a bot\'s review is recorded by the Delivery Manager that dispatched or read it.');
    const kind = a.advisory || R.isBot(by) ? 'advisory' : 'independent';
    let note = '';
    const view = ghFor(who, gh)(pr);
    if (view && view.headRefOid && !require('./lib/gates.js').shaMatch(view.headRefOid, a.head)) note = `\nnote: PR ${pr} is now at ${R.short(view.headRefOid)}, so this review of ${R.short(a.head)} will not count for the merge: review ${R.short(view.headRefOid)}`;
    const row = R.append(who.root, pr, { type: 'review', head: a.head, result: a.result, reviewer: by, kind, summary: String(a.summary).slice(0, 500), ...(a.findings ? { findings: a.findings } : {}), recorded_by: who.instance, ...base });
    const next = a.result === 'pass' ? `Next: ${R.cmd('merge-gate.js', `check ${pr}`)}` : `Next: ${R.cmd('review.js', `send-back ${pr} --reason changes --note '<the findings>'`)}`;
    return { code: 0, row, out: `${row.id}: ${a.result} by ${by} on ${R.short(a.head)} (${kind}${kind === 'advisory' ? ': does not satisfy the gate alone' : ''})${note}\n${next}` };
  }

  if (sub === 'ci') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.head || !R.SHA.test(a.head) || !['pass', 'fail'].includes(a.result) || !a.run) return { code: 2, out: USAGE };
    const row = R.append(who.root, pr, { type: 'ci', head: a.head, result: a.result, run: a.run, ...base });
    return { code: 0, row, out: `${row.id}: CI ${a.result} on ${R.short(a.head)} (${a.run})` };
  }

  if (sub === 'send-back') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!a.reason) return { code: 2, out: USAGE };
    const req = R.lastRequest(rows);
    if (!req) return refuse(`no review was requested for PR ${pr}, so its owner is not known`, `Ask first: ${R.cmd('review.js', `request ${pr} --reviewer <id>`)}`);
    const view = ghFor(who, gh)(pr);
    const head = (view && view.headRefOid) || [...rows].reverse().find((r) => r.head).head;
    const owners = [...new Set((req.authors || []).map(R.instanceOf))];
    const what = { conflict: 'it has conflicts with the default branch: merge or rebase the default branch into your branch and resolve them', changes: 'the review asked for changes', ci: 'CI is red' }[a.reason] || a.reason;
    const row = R.append(who.root, pr, { type: 'sent-back', head, reason: a.reason, note: a.note || null, owners, ...base });
    const text = `${at.slice(0, 10)}: PR ${pr} sent back at ${R.short(head)}: ${what}${a.note ? ` (${a.note})` : ''}; a new review is needed after the fix (${row.id})`;
    for (const id of req.beads || []) { try { store().update(id, { appendNotes: text }); } catch (err) { /* the row and the message still stand */ } }
    return { code: 0, row, out: `${row.id}: PR ${pr} sent back to ${owners.join(', ') || 'its owner'}; noted in ${(req.beads || []).join(', ')}\nMessage ${owners.join(', ') || 'the owner'}: "PR ${pr}: ${what}${a.note ? `: ${a.note}` : ''}. Fix it on your branch, push, and tell me; I will ask for a new review."` };
  }
  return { code: 2, out: USAGE };
}

function instancesOf(who) {
  try { return who.team ? require('./lib/manifest.js').expandInstances(who.team) : []; } catch (err) { return []; }
}

const PLAIN = {
  waiting: (t) => `${t} is waiting for review`,
  changes: (t) => `${t} needs changes after review; its builder is fixing it`,
  'sent-back': (t) => `${t} went back to its builder to fix before it can merge`,
  ready: (t) => `${t} is reviewed and ready to merge`,
  merged: (t) => `${t} is reviewed and merged; checking it on the customer's app next`,
};

function list(root, a) {
  const out = R.listPrs(root).map((pr) => {
    const { rows } = R.read(root, pr);
    const req = R.lastRequest(rows);
    return { pr: Number(pr), state: R.stateOf(rows), title: req && req.title, reviewer: req && req.reviewer };
  });
  if (a.json) return { code: 0, out: JSON.stringify(out) };
  if (!out.length) return { code: 0, out: 'No pull requests under review.' };
  // the Chief of Staff's wording: the change in plain words, never a bead or pull request number
  if (a.plain) return { code: 0, out: out.map((p) => PLAIN[p.state](p.title ? `The change "${p.title}"` : 'A change')).join('\n') };
  return { code: 0, out: out.map((p) => `PR ${p.pr}: ${p.state}${p.reviewer ? ` (reviewer ${p.reviewer})` : ''}${p.title ? ` ${p.title}` : ''}`).join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `review.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, list };
