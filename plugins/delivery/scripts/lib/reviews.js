// scripts/lib/reviews.js — review records and the merge gate's rule (R-32, R-24).
//
// One file per pull request, <project>/.delivery/reviews/prs/<pr>.ndjson: append-only and chained the
// way evidence is (seq, prev = sha12 of the previous line), written only by review.js and merge-gate.js
// (every lane refuses a hand write). Rows: request (who is asked, at which head, the beads the pull
// request refs and their authors), review (pass or changes at a head, independent or advisory), ci
// (a recorded result where gh cannot read the checks), sent-back (a conflict, a finding or red CI sent
// to the owner) and merged. The rule: a passing independent review of the current head, recorded after
// the last send-back, with no newer "changes" on that head, CI green and no conflict.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./lock.js');
const G = require('./gates.js');

const REL = path.join('.delivery', 'reviews', 'prs');
const PR = /^[1-9]\d{0,8}$/;
const SHA = /^[0-9a-f]{7,40}$/i;
// reviewers whose rows are advisory: bots (GitHub's [bot] suffix, Copilot and the like)
const BOT = /\[bot\]$|^(?:github-)?copilot\b|^coderabbit|^dependabot|^codex\b/i;
// generated files do not count toward a pull request's size (R-24)
const GENERATED = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|vendor)\/|\.min\.(?:js|css)$|\.snap$/;
const DEFAULT_SIZE = 600;
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const ROOT_CMD = 'node ${CLAUDE_PLUGIN_ROOT}/scripts';
const cmd = (script, args) => `\`${ROOT_CMD}/${script} ${args}\``;

const fileOf = (root, pr) => path.join(root, REL, `${pr}.ndjson`);
const isBot = (id) => BOT.test(String(id || ''));
const instanceOf = (actor) => String(actor || '').split('/').pop();

// { rows, problem }: a line that breaks the chain stops the read, and the gate refuses on it
function read(root, pr) {
  let text = '';
  try { text = fs.readFileSync(fileOf(root, pr), 'utf8'); } catch (err) { return { rows: [], problem: null }; }
  const rows = [];
  let prev = 'start';
  for (const line of text.split('\n').filter((l) => l.trim())) {
    let r;
    try { r = JSON.parse(line); } catch (err) { return { rows, problem: `line ${rows.length + 1} of PR ${pr}'s review record is not a row` }; }
    if (r.seq !== rows.length + 1 || r.prev !== prev) return { rows, problem: `row ${r.id || rows.length + 1} breaks PR ${pr}'s review chain (edited or deleted line)` };
    rows.push(r);
    prev = sha12(line);
  }
  return { rows, problem: null };
}

function append(root, pr, row) {
  const file = fileOf(root, pr);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLock(`${file}.lock`, () => {
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()); } catch (err) { lines = []; }
    const seq = lines.length + 1;
    const full = { id: `rv-${pr}-${seq}`, pr: Number(pr), seq, prev: lines.length ? sha12(lines[lines.length - 1]) : 'start', ...row };
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`);
    return full;
  }, { strict: true, waitMs: 2000 });
}

function listPrs(root) {
  try { return fs.readdirSync(path.join(root, REL)).map((f) => /^(\d+)\.ndjson$/.exec(f)).filter(Boolean).map((m) => m[1]).sort((a, b) => a - b); } catch (err) { return []; }
}

// `Refs <bead>` lines in a pull request body (the builder brief's form; "Refs: <id>" too)
function refsOf(body) {
  const out = [];
  const re = /\bRefs:?\s+([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])/g;
  let m;
  while ((m = re.exec(String(body || '')))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// The stories a set of beads belong to: a story bead itself, else its parent
function storiesOf(beads) {
  return [...new Set(beads.map((b) => ((b.labels || []).includes('story') || !b.parent ? b.id : b.parent)))];
}

// Every actor stamped on the beads (and their stories) as an author, as actors and instances
function authorsOfBeads(beads, instances = []) {
  const actors = new Set();
  for (const b of beads) for (const a of G.authorsOf(b, instances).actors) actors.add(a);
  return [...actors];
}
const isAuthor = (authors, id) => !!id && authors.some((a) => a === id || instanceOf(a) === id);

// Changed lines that count toward the size cap: generated files are left out
function changedLines(pr) {
  if (Array.isArray(pr.files) && pr.files.length) return pr.files.filter((f) => !GENERATED.test(String(f.path || ''))).reduce((n, f) => n + (Number(f.additions) || 0) + (Number(f.deletions) || 0), 0);
  return (Number(pr.additions) || 0) + (Number(pr.deletions) || 0);
}

// Size and scope warnings (R-24, R-23): never a refusal
function scopeWarnings({ pr, lines, stories, threshold }) {
  const out = [];
  if (Number.isFinite(lines) && lines > threshold) out.push({ kind: 'pr-size', rule: 'R-24', detail: `PR ${pr} changes ${lines} lines, over ${threshold}: split it, or say in the review request why it is one change` });
  if (stories.length > 1) out.push({ kind: 'pr-scope', rule: 'R-24', detail: `PR ${pr} touches ${stories.length} stories (${stories.join(', ')}): one story per pull request` });
  return out;
}

// The checks gh reports, as green / pending / red with the names that are not green; none when empty
function ciOf(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return { state: 'none', names: [] };
  const red = [];
  const pending = [];
  for (const c of rollup) {
    const name = c.name || c.context || 'check';
    if (c.__typename === 'StatusContext' || (c.state && !c.status)) {
      const s = String(c.state || '').toUpperCase();
      if (s === 'SUCCESS') continue;
      (['PENDING', 'EXPECTED'].includes(s) ? pending : red).push(name);
      continue;
    }
    if (String(c.status || '').toUpperCase() !== 'COMPLETED') { pending.push(name); continue; }
    if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(c.conclusion || '').toUpperCase())) red.push(name);
  }
  if (red.length) return { state: 'red', names: red };
  if (pending.length) return { state: 'pending', names: pending };
  return { state: 'green', names: [] };
}

// The latest request's beads, authors and title (the review rows are checked against them)
function lastRequest(rows) { return [...rows].reverse().find((r) => r.type === 'request') || null; }
const cutOf = (rows) => rows.reduce((n, r) => (r.type === 'sent-back' ? r.seq : n), 0);

// The merge gate's rule. ctx: { head, ci: { state, names } | null (gh not readable), mergeable, botsCount }.
// { ok, review, why, fix } — why and fix are the two lines of a refusal.
function evaluate(pr, rows, { head, ci, mergeable, botsCount = false, problem } = {}) {
  const req = lastRequest(rows);
  const reviewer = req ? req.reviewer : '<reviewer>';
  const again = cmd('review.js', `request ${pr} --reviewer ${reviewer}`);
  const sendBack = (reason) => cmd('review.js', `send-back ${pr} --reason ${reason}`);
  if (problem) return { ok: false, why: problem, fix: `Restore the record from git (\`git log -p -- ${REL}/${pr}.ndjson\`) or ask for a fresh review: ${again}` };
  if (!head) return { ok: false, why: `PR ${pr}'s current head is not known (gh could not read it)`, fix: `Name it: \`gh pr merge ${pr} --match-head-commit <head sha>\`` };
  if (String(mergeable || '').toUpperCase() === 'CONFLICTING') return { ok: false, why: `PR ${pr} has conflicts with its base: its owner resolves them, never the Delivery Manager`, fix: `Send it back: ${sendBack('conflict')}; once the owner pushes the fix, ask for review again` };
  const cut = cutOf(rows);
  const live = rows.filter((r) => r.type === 'review' && r.seq > cut);
  const onHead = live.filter((r) => G.shaMatch(r.head, head));
  const counts = (r) => r.kind === 'independent' || (botsCount && r.kind === 'advisory');
  const pass = [...onHead].reverse().find((r) => counts(r) && r.result === 'pass');
  const changes = [...onHead].reverse().find((r) => r.kind === 'independent' && r.result === 'changes');
  if (changes && (!pass || changes.seq > pass.seq)) return { ok: false, why: `review ${changes.id} by ${changes.reviewer} asked for changes on ${short(head)}: ${String(changes.summary || '').slice(0, 120)}`, fix: `Send it back to its owner: ${sendBack('changes')}; after the fix, ask for review again: ${again}` };
  if (!pass) {
    const older = [...live].reverse().find((r) => counts(r) && r.result === 'pass');
    if (older) return { ok: false, why: `the review is for an older head (${short(older.head)}); PR ${pr} is now at ${short(head)}`, fix: `Ask for review of ${short(head)}: ${again}` };
    const advisory = onHead.find((r) => r.kind === 'advisory');
    if (advisory) return { ok: false, why: `PR ${pr} has only advisory reviews (${advisory.reviewer}) on ${short(head)}; they do not count alone`, fix: `Ask an independent reviewer: ${again}` };
    const resent = cut && rows.some((r) => r.type === 'review' && r.seq < cut);
    return { ok: false, why: resent ? `PR ${pr} was sent back, so its earlier reviews no longer count` : `PR ${pr} has no independent review`, fix: `Ask for one: ${again}` };
  }
  let ciState = ci;
  if (!ciState || ciState.state === 'none') {
    // gh could not read the checks, or none are configured: the Delivery Manager's recorded result
    const row = [...rows].reverse().find((r) => r.type === 'ci' && r.seq > cut && G.shaMatch(r.head, head));
    ciState = row ? { state: row.result === 'pass' ? 'green' : 'red', names: row.result === 'pass' ? [] : [row.run || 'recorded run'], row: row.id } : null;
  }
  if (!ciState) return { ok: false, why: `no CI result for ${short(head)}${ci ? ' (the pull request reports no checks)' : ' (gh could not read the checks)'}`, fix: `Record the run: ${cmd('review.js', `ci ${pr} --head ${head} --result pass|fail --run <run id or URL>`)}` };
  if (ciState.state === 'pending') return { ok: false, why: `CI is still running on ${short(head)} (${ciState.names.slice(0, 3).join(', ')})`, fix: `Wait for it: \`gh pr checks ${pr} --watch\`, then ${cmd('merge-gate.js', `check ${pr}`)}` };
  if (ciState.state !== 'green') return { ok: false, why: `CI is red on ${short(head)} (${ciState.names.slice(0, 3).join(', ')})`, fix: `Send it back to its owner: ${sendBack('ci')}; after the fix, ask for review again` };
  return { ok: true, review: pass, ci: ciState };
}
const short = (s) => String(s || '').slice(0, 12);

// Where a pull request stands from its rows alone (no gh): for team-status and the plain status
function stateOf(rows) {
  if (rows.some((r) => r.type === 'merged')) return 'merged';
  const cut = cutOf(rows);
  const last = [...rows].reverse().find((r) => ['request', 'review', 'sent-back'].includes(r.type));
  if (!last) return 'waiting';
  if (last.type === 'sent-back') return 'sent-back';
  const head = [...rows].reverse().find((r) => r.head && r.type !== 'ci');
  const onHead = rows.filter((r) => r.type === 'review' && r.seq > cut && r.kind === 'independent' && head && G.shaMatch(r.head, head.head));
  const latest = onHead[onHead.length - 1];
  if (latest && latest.result === 'pass') return 'ready';
  if (latest && latest.result === 'changes') return 'changes';
  return 'waiting';
}

module.exports = { REL, PR, SHA, DEFAULT_SIZE, fileOf, read, append, listPrs, refsOf, storiesOf, authorsOfBeads, isAuthor, isBot, instanceOf, changedLines, scopeWarnings, ciOf, evaluate, lastRequest, stateOf, cmd, short };
