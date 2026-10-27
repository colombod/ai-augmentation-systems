#!/usr/bin/env node
// scripts/reality-check.js — reality checks (R-33): an agent verifies a deployed story on the real
// customer surface by script, never the owner. One script per story, from its criteria and probes;
// the Reality Checker runs it with browser control or computer use and records one row per criterion.
//   reality-check.js plan <bead> [--attempts <n>] [--minutes <n>]   Delivery Manager: write
//       .delivery/reality-checks/<bead>.json (templates/reality-check.json is the format); once the story
//       is deployed, also create its reality-check child bead for the Reality Checker
//   reality-check.js refine <bead> [--criterion <n> (--step <k> | --add-step) | --setup <k>]
//       [--action ..] [--expect ..] [--command ..] [--match ..] [--capture a,b] [--pass-rule ..] [--account <name>] [--read-on-screen ..]
//       [--precondition <o-id>]   Delivery Manager: edit the shared script (the only way to change it)
//   reality-check.js show <bead>                                       the script, read only
//   reality-check.js run-record <bead> --criterion <n> --result pass|fail --artifact <path>
//       --observed-version <what the surface showed> [--host h] [--app a] [--mode m] [--install-artifact x]
//       a row through evidence.js, refused when the version on screen is not the deployed one, the
//       capture is missing or outside .delivery/evidence/artifacts/<bead>/, or the run cap is spent.
//       A counting fail raises the andon (goal.js pause path): its area stops until an A3 closes (a3.js).
// Exit codes: 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { tupleOf, TUPLE } = require('./lib/surface.js');
const { whoAmI, gateInputs, writerProblem, EVIDENCE_WRITERS } = require('./lib/gate-context.js');

const USAGE = 'usage: reality-check.js plan <bead> [--attempts <n>] [--minutes <n>] | refine <bead> [--criterion <n> (--step <k>|--add-step) | --setup <k>] [--action ..] [--expect ..] [--command ..] [--match ..] [--capture a,b] [--pass-rule ..] [--account <name>] [--read-on-screen ..] [--precondition <o-id>] | show <bead> | run-record <bead> --criterion <n> --result pass|fail --artifact <path> --observed-version <v> [--host h] [--app a] [--mode m] [--install-artifact x]';
const VALUE = ['--criterion', '--result', '--artifact', '--observed-version', '--attempts', '--minutes', '--project', '--host', '--app', '--mode', '--install-artifact',
  '--step', '--setup', '--action', '--expect', '--command', '--match', '--capture', '--pass-rule', '--account', '--read-on-screen', '--precondition'];
// a test account is named, never given: anything that looks like a password or token is refused
const SECRETISH = /pass(?:word|wd)?|secret|token|api[_-]?key|[:=]\S|\b[A-Za-z0-9+/_-]{24,}\b/i;
const DEFAULT_CAP = { attempts: 2, minutes: 30 };
const LABEL = 'reality-check';
const SIGNIN = "A sign-in, consent or payment wall stops the run: message the Chief of Staff with the one exact step for the owner queue (kind signin, consent or payment), and resume when it is done. Never type a password and never use the owner's own account.";

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--add-step') out.add_step = true;
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2).replace(/-/g, '_')] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const scriptRel = (bead) => `.delivery/reality-checks/${bead}.json`;
const artifactsRel = (bead) => `.delivery/evidence/artifacts/${bead}/`;
const refuse = (text) => ({ code: 1, out: `reality-check.js: ${text}` });
function readScript(root, bead) { try { return JSON.parse(fs.readFileSync(path.join(root, scriptRel(bead)), 'utf8')); } catch (err) { return null; } }

// The criteria a reality check covers: those whose probe says `by: reality-check`, and on a surface that
// is not scriptable, or is a command line (verify-run.js runs its commands), every criterion.
const covered = (story, surface) => story.criteria.filter((c) => (c.probe && c.probe.by === 'reality-check') || surface.scriptable === false || surface.command_line === true);
const expectOf = (c) => (c.probe ? c.probe.text.replace(/;\s*(?:where|by):[^;]*/gi, '').trim() : c.text);

// A step group per covered criterion. A group the Delivery Manager already refined is kept as long as
// its criterion's wording is unchanged (matched by the criterion's hash).
function buildScript({ bead, story, surface, old, cap, at, by }) {
  const m = bead.metadata || {};
  const kept = new Map(((old && old.criteria) || []).map((g) => [g.criterion_hash, g]));
  const where = `${surface.app} (${surface.mode}) on ${surface.host}`;
  const version = m.deployed_version || m.deployed_sha || 'the deployed sha (not deployed yet)';
  return {
    id: `rc-${bead.id}`,
    kind: 'reality-check',
    story: bead.id,
    story_file: m.story_file || null,
    surface: { id: surface.id, ...tupleOf(surface) },
    account: { name: surface.test_account || (old && old.account && old.account.name) || null, signin: SIGNIN },
    artifact: { deployed_sha: m.deployed_sha || null, version: m.deployed_version || null, read_on_screen: surface.version_on_screen || (old && old.artifact && old.artifact.read_on_screen) || 'where the surface shows the installed version or build' },
    cap: { ...DEFAULT_CAP, ...((old && old.cap) || {}), ...cap },
    preconditions: (old && old.preconditions) || [],
    setup: [
      { action: `Open ${where} with ${surface.install_artifact} installed, using the test account`, expect: `the screen shows ${surface.app} in ${surface.mode}; any other app or mode stops the run`, capture: ['screenshot'] },
      { action: `Read the version ${surface.version_on_screen ? `(${surface.version_on_screen})` : 'the surface shows'}`, expect: `${version}; any other stops the run`, capture: ['screenshot', 'page-text'] },
    ],
    criteria: covered(story, surface).map((c) => {
      const hash = G.criterionHash(c);
      const k = kept.get(hash);
      if (k) return { ...k, criterion: c.n };
      return {
        criterion: c.n,
        criterion_hash: hash,
        text: c.text,
        steps: [{ n: 1, action: `On ${where}, as the persona: ${c.text}`, expect: expectOf(c), capture: ['screenshot', 'page-text', 'log'] }],
        pass_rule: `pass only when every step shows its expected observation on ${surface.id} at the version read in setup; anything else is a fail, recorded with its capture`,
      };
    }),
    always_capture: ['the version as the surface shows it', 'a screenshot or page text per step', "the server log lines for the run window, with the caller's client and surface"],
    planned_by: by,
    planned_at: at,
  };
}

function plan(who, store, id, a, at) {
  const wp = writerProblem(who);
  if (wp) return refuse(wp);
  const bead = store.show(id);
  if (!bead) return refuse(`no bead ${id}`);
  const inp = gateInputs(who.root, bead, { bd: store, team: who.team });
  if (!inp.story) return refuse(`${id} has no readable story file (metadata story_file under .delivery/stories/)`);
  if (!inp.surface) return refuse(`${id} names no declared customer surface (surface.json), so there is nothing to set up: declare it first (R-09)`);
  const groups = covered(inp.story, inp.surface);
  if (!groups.length) return refuse(`${id} has no criterion whose probe says by: reality-check, and ${inp.surface.id} is scriptable: its probes run as tests`);
  const cap = {};
  for (const k of ['attempts', 'minutes']) {
    if (a[k] === undefined) continue;
    const n = Number(a[k]);
    if (!Number.isInteger(n) || n < 1) return { code: 2, out: `reality-check.js: --${k} must be a whole number of at least 1` };
    cap[k] = n;
  }
  const script = buildScript({ bead, story: inp.story, surface: inp.surface, old: readScript(who.root, id), cap, at, by: who.instance });
  fs.mkdirSync(path.join(who.root, '.delivery', 'reality-checks'), { recursive: true });
  fs.writeFileSync(path.join(who.root, scriptRel(id)), `${JSON.stringify(script, null, 2)}\n`);
  const lines = [`${scriptRel(id)}: ${groups.length} criterion group(s) on ${inp.surface.id}, cap ${script.cap.attempts} attempts and ${script.cap.minutes} minutes`];
  const sha = (bead.metadata || {}).deployed_sha;
  if (!sha) {
    lines.push(`not deployed yet: after \`evidence.js state ${id} deployed --sha <sha>\`, run plan again to dispatch the check`);
    return { code: 0, out: lines.join('\n') };
  }
  // one check bead per deployed sha: a new deploy is a new check, the old one stays as it was
  const child = `${id}-rc-${String(sha).slice(0, 7)}`;
  if (!store.show(child)) {
    store.create({ id: child, parent: id, type: 'task', labels: [LABEL], title: `Reality check: ${inp.story.meta.title || id} on ${inp.surface.id} at ${String(sha).slice(0, 7)}`,
      metadata: { reality_check_for: id, script: scriptRel(id), deployed_sha: sha } });
    lines.push(`${child}: created for the Reality Checker (label ${LABEL})`);
  } else lines.push(`${child}: already dispatched`);
  let hasChecker = false;
  try { hasChecker = (who.team.roles || []).some((r) => r.id === 'reality-checker' && !r.retired); } catch (err) { hasChecker = false; }
  lines.push(hasChecker ? 'message the Reality Checker with the bead id' : 'warning: the team has no Reality Checker: add it to team.json and prepare it; the check is never the owner\'s');
  return { code: 0, out: lines.join('\n') };
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// Where a capture may come from: the bead's artifacts directory in the shared project checkout (where
// rows and scripts live), or in the checker's own project clone (<role dir>/project, where its lane
// writes). Real paths, so `..` and symlinks cannot leave it. { real, rel, sha256 } or { problem }.
function captureOf(who, id, file, shown) {
  const bases = [who.root, who.roleDir ? path.join(who.roleDir, 'project') : null].filter(Boolean).map((b) => path.join(b, artifactsRel(id)));
  let real = null;
  try { real = fs.realpathSync(file); } catch (err) { real = null; }
  if (!real) return { problem: `no capture at ${shown}: save the page text, DOM text, log or screenshot file there first` };
  for (const b of bases) {
    let base;
    try { base = fs.realpathSync(b); } catch (err) { continue; }
    const rel = path.relative(base, real);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const stat = fs.statSync(real);
    if (!stat.isFile() || !stat.size) return { problem: `no capture at ${shown}: save the page text, DOM text, log or screenshot file there first` };
    return { real, rel, sha256: sha256(real) };
  }
  return { problem: `the capture must be under ${artifactsRel(id)} in the project checkout or your own project clone (got ${shown})` };
}

// The capture is copied into the shared store, so the row's path resolves for every reader.
function publish(root, id, cap) {
  const dir = path.join(root, artifactsRel(id));
  let rel = cap.rel;
  let dest = path.join(dir, rel);
  const same = (() => { try { return fs.realpathSync(dest) === cap.real; } catch (err) { return false; } })();
  if (!same) {
    if (fs.existsSync(dest) && sha256(dest) !== cap.sha256) { rel = path.join(path.dirname(rel), `${cap.sha256.slice(0, 8)}-${path.basename(rel)}`); dest = path.join(dir, rel); }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(cap.real, dest);
  }
  return { path: `artifacts/${id}/${rel.split(path.sep).join('/')}`, sha256: cap.sha256 };
}

// A row elsewhere that already cites these bytes: another bead, another criterion, or another deploy.
function citedElsewhere(root, hash, { bead, criterion, sha }) {
  let files = [];
  try { files = fs.readdirSync(path.join(root, '.delivery', 'evidence')).filter((f) => f.endsWith('.ndjson')); } catch (err) { return null; }
  for (const f of files) {
    for (const r of G.readEvidence(root, f.replace(/\.ndjson$/, ''))) {
      if (!r.capture || r.capture.sha256 !== hash) continue;
      if (r.bead !== bead || Number(r.criterion) !== criterion || !G.shaMatch(r.sha, sha)) return r;
    }
  }
  return null;
}

function runRecord(who, store, id, a, { cwd, env, now, verifyRecord }) {
  const wp = writerProblem(who, EVIDENCE_WRITERS);
  if (wp) return refuse(wp);
  if (!a.criterion || !['pass', 'fail'].includes(a.result) || !a.artifact || !a.observed_version) return { code: 2, out: USAGE };
  const bead = store.show(id);
  if (!bead) return refuse(`no bead ${id}`);
  const m = bead.metadata || {};
  if (!m.deployed_sha) return refuse(`${id} has no deployed sha: a reality check runs on a deploy (evidence.js state ${id} deployed --sha <sha>)`);
  const script = readScript(who.root, id);
  if (!script) return refuse(`no reality-check script for ${id}: the Delivery Manager writes it (reality-check.js plan ${id})`);
  if (!G.shaMatch(script.artifact && script.artifact.deployed_sha, m.deployed_sha)) return refuse(`the script is for ${(script.artifact && script.artifact.deployed_sha) || 'no deploy'}, not the deployed ${m.deployed_sha}: message the Delivery Manager to plan it again`);
  const n = Number(a.criterion);
  const group = (script.criteria || []).find((g) => g.criterion === n);
  if (!group) return refuse(`criterion ${a.criterion} is not in the script (${(script.criteria || []).map((g) => g.criterion).join(', ') || 'none'}): its probe runs as a test`);
  // the steps that were run must be the ones for this wording of the criterion
  const inp = gateInputs(who.root, bead, { bd: store, team: who.team });
  const current = inp.story && inp.story.criteria.find((c) => c.n === n);
  if (!current || group.criterion_hash !== G.criterionHash(current)) return refuse(`criterion ${n} changed since the script was planned, so its steps checked another outcome.\nMessage the Delivery Manager to plan it again (reality-check.js plan ${id})`);
  // the build on screen must be the deployed one: a run on another build checks nothing here (D3)
  const seen = String(a.observed_version).trim();
  const versionOk = G.shaMatch(seen, m.deployed_sha) || (m.deployed_version && seen.toLowerCase() === String(m.deployed_version).trim().toLowerCase());
  if (!versionOk) return refuse(`the surface shows ${seen}, not the deployed ${m.deployed_version ? `${m.deployed_version} (${m.deployed_sha})` : m.deployed_sha}: that run checked another build, so nothing is recorded.\nMessage the Delivery Manager: the deploy has not reached the surface`);
  const cap0 = captureOf(who, id, path.resolve(cwd, a.artifact), a.artifact);
  if (cap0.problem) return refuse(cap0.problem);
  // a capture backs one run: the same bytes for another bead, criterion or deploy are not a new observation
  const reused = citedElsewhere(who.root, cap0.sha256, { bead: id, criterion: n, sha: m.deployed_sha });
  if (reused) return refuse(`that capture already backs ${reused.id} (criterion ${reused.criterion} of ${reused.bead} at ${String(reused.sha).slice(0, 12)}): capture this run`);
  const capture = publish(who.root, id, cap0);
  // the run cap: main-arm attempts per criterion on this deploy (a run on the wrong surface does not
  // count against it); a second run after a fail is a recorded warning
  const mine = G.readEvidence(who.root, id).filter((r) => r.type === 'row' && r.via === LABEL && r.arm !== 'side' && Number(r.criterion) === n && G.shaMatch(r.sha, m.deployed_sha));
  const cap = (script.cap && script.cap.attempts) || DEFAULT_CAP.attempts;
  if (mine.length >= cap) return refuse(`criterion ${n} already has ${mine.length} run(s) on ${String(m.deployed_sha).slice(0, 12)}, the script's cap.\nStop and message the Delivery Manager: a new run needs a new deploy or a new script`);
  const retry = mine.some((r) => r.result === 'fail');
  const argv = ['add', id, '--criterion', String(n), '--result', a.result, '--surface', script.surface.id, '--sha', m.deployed_sha, '--run', `${script.id}#${capture.path}`];
  // the tuple observed is the script's (what was set up), overridden by what the checker saw
  for (const k of TUPLE) { const v = a[k] !== undefined ? a[k] : script.surface[k]; if (v !== undefined) argv.push(`--${k.replace('_', '-')}`, v); }
  const r = require('./evidence.js').main(argv, { cwd, env, bd: store, now, verifyRecord, who, via: { by: LABEL, capture, observed_version: seen } });
  const out = [r.out.replace(/^evidence\.js: /, 'reality-check.js: ')];
  if (retry && r.row) {
    const w = W.record(who.root, { kind: 'reality-retry', rule: 'R-33', bead: id, detail: `criterion ${n} run again on ${String(m.deployed_sha).slice(0, 12)} after a fail, with no new deploy`, raisedBy: who.instance, instance: who.instance, now });
    if (w) out.push(`warning ${w.id}: a second run after a fail on the same sha`);
  }
  if (r.code === 0 && a.result === 'fail') {
    const p = require('./lib/goal.js').pauseOnTrigger({ root: who.root, who, trigger: `andon:${r.row.id}`, bead: store.show(id), now });
    out.push(p.ok ? `andon:${r.row.id} raised: area ${G.areaOf(store.show(id) || bead)} stops (fixes only) until its A3 closes on a proved fix; draft its problem: a3.js new --trigger andon:${r.row.id} --problem '<what the surface showed>'` : `andon not raised (${p.error}): message the Delivery Manager`);
  }
  return { code: r.code, out: out.join('\n'), row: r.row };
}

// The Delivery Manager's edits go through here: the script lives in the shared project checkout, which
// run-record reads, and no lane writes it directly.
function refine(who, id, a, at) {
  const wp = writerProblem(who);
  if (wp) return refuse(wp);
  const s = readScript(who.root, id);
  if (!s) return refuse(`no reality-check script for ${id}: plan it first (reality-check.js plan ${id})`);
  const fields = (step) => {
    if (a.action !== undefined) step.action = a.action;
    if (a.expect !== undefined) step.expect = a.expect;
    // a command-line surface: verify-run.js runs this at the deployed sha and decides pass or fail from it
    if (a.command !== undefined) step.command = a.command;
    if (a.match !== undefined) step.match = a.match;
    if (a.capture !== undefined) step.capture = a.capture.split(',').map((x) => x.trim()).filter(Boolean);
  };
  const changed = [];
  if (a.criterion !== undefined) {
    const g = (s.criteria || []).find((x) => x.criterion === Number(a.criterion));
    if (!g) return refuse(`criterion ${a.criterion} is not in the script`);
    if (a.add_step) {
      if (!a.action || !a.expect) return { code: 2, out: 'reality-check.js: --add-step needs --action and --expect' };
      const step = { n: g.steps.length + 1, capture: ['screenshot', 'page-text'] };
      fields(step);
      g.steps.push(step);
      changed.push(`criterion ${g.criterion} step ${step.n} added`);
    } else if (a.step !== undefined) {
      const step = g.steps.find((x) => x.n === Number(a.step));
      if (!step) return refuse(`criterion ${g.criterion} has no step ${a.step} (1..${g.steps.length})`);
      fields(step);
      changed.push(`criterion ${g.criterion} step ${step.n}`);
    }
    if (a.pass_rule !== undefined) { g.pass_rule = a.pass_rule; changed.push(`criterion ${g.criterion} pass rule`); }
  } else if (a.setup !== undefined) {
    const step = (s.setup || [])[Number(a.setup) - 1];
    if (!step) return refuse(`no setup step ${a.setup} (1..${(s.setup || []).length})`);
    fields(step);
    changed.push(`setup step ${a.setup}`);
  }
  if (a.account !== undefined) {
    if (SECRETISH.test(a.account)) return refuse('the test account is a name, never a secret: its sign-in is an owner-queue step');
    s.account = { ...s.account, name: a.account };
    changed.push('account');
  }
  if (a.read_on_screen !== undefined) { s.artifact = { ...s.artifact, read_on_screen: a.read_on_screen }; changed.push('version on screen'); }
  if (a.precondition !== undefined) { s.preconditions = [...new Set([...(s.preconditions || []), a.precondition])]; changed.push('preconditions'); }
  if (!changed.length) return { code: 2, out: USAGE };
  s.refined_by = who.instance;
  s.refined_at = at;
  fs.writeFileSync(path.join(who.root, scriptRel(id)), `${JSON.stringify(s, null, 2)}\n`);
  return { code: 0, out: `${scriptRel(id)}: ${changed.join(', ')}` };
}

// open reality-check beads, for /delivery:team
const pending = (beads) => (beads || []).filter((b) => (b.labels || []).includes(LABEL) && b.status !== 'closed');

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord, who: given } = {}) {
  const a = parse(argv);
  const [cmd, id] = a._;
  if (!['plan', 'refine', 'show', 'run-record'].includes(cmd) || !id) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'reality-check.js: no project found; pass --project <root>' };
  if (cmd === 'show') {
    const s = readScript(who.root, id);
    return s ? { code: 0, out: JSON.stringify(s, null, 2) } : refuse(`no reality-check script for ${id}: the Delivery Manager writes it (reality-check.js plan ${id})`);
  }
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  const at = now || new Date().toISOString();
  if (cmd === 'plan') return plan(who, store, id, a, at);
  if (cmd === 'refine') return refine(who, id, a, at);
  return runRecord(who, store, id, a, { cwd, env, now: at, verifyRecord });
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `reality-check.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, buildScript, readScript, pending, scriptRel, artifactsRel, DEFAULT_CAP, LABEL };
