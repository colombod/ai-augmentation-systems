#!/usr/bin/env node
// scripts/judge.js — the typed judge as a tool: ask a catalogued question, list the catalogue, read the log.
//
//   judge.js ask <question-id> --state <file|->   JSON state from a file or stdin; prints the typed result
//   judge.js questions                            the catalogue: id, version, type, mode, state fields, options
//   judge.js stats                                per question: calls, latency p50/p95, tokens, share at the thresholds
// The configuration is read only from the project of this session's role marker (or, outside a role,
// DELIVERY_PROJECT_ROOT); the caller cannot point it at another manifest. Exit codes: 0 answered (or listed); 3 skipped or failed (the result says why);
// 2 usage error. The judge is advisory: its answer informs a gate, it never decides one.
const fs = require('fs');
const path = require('path');
const J = require('./lib/judge.js');
const { loadManifest, TEAM_REL } = require('./lib/manifest.js');
const { findRoleMarker } = require('../hooks/scripts/role-context.js');

const USAGE = 'usage: judge.js ask <question-id> --state <file|-> | judge.js questions | judge.js stats';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') out.state = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

// the role marker's project, else DELIVERY_PROJECT_ROOT; null when neither names a project
function configRoot(cwd, env) {
  try {
    const found = findRoleMarker(cwd);
    const root = found && found.marker && found.marker.project_root;
    if (typeof root === 'string' && path.isAbsolute(root)) return root;
  } catch (err) { /* no usable marker */ }
  const r = env.DELIVERY_PROJECT_ROOT;
  return typeof r === 'string' && path.isAbsolute(r) && fs.existsSync(path.join(r, TEAM_REL)) ? r : null;
}

function teamOf(root) {
  if (!root) return null;
  try { return loadManifest(root).team; } catch (err) { return null; }
}

async function main(argv, { stdin = () => fs.readFileSync(0, 'utf8'), cwd = process.cwd(), env = process.env } = {}) {
  const args = parse(argv);
  const [cmd, id] = args._;
  const root = configRoot(cwd, env);
  if (cmd === 'questions') {
    const cat = J.loadCatalogue();
    const list = Object.entries(cat.questions).map(([qid, q]) => ({ id: qid, version: q.version, type: q.type, mode: q.mode || 'advisory', state: q.state,
      ...(q.criteria ? { options: Object.keys(q.criteria) } : {}) }));
    return { code: 0, out: { catalogue: cat.version, questions: list } };
  }
  if (cmd === 'stats') {
    const cfg = J.judgeConfig(teamOf(root), env);
    const dir = J.logDirOf(root);
    return { code: 0, out: { block_threshold: cfg.block_threshold, warn_threshold: cfg.warn_threshold, questions: dir ? J.stats(J.readLog(dir), { block: cfg.block_threshold, warn: cfg.warn_threshold }) : {} } };
  }
  if (cmd === 'ask' && id && args.state) {
    let state;
    // the error never echoes the state's content
    try { state = JSON.parse(args.state === '-' ? stdin() : fs.readFileSync(path.resolve(cwd, args.state), 'utf8')); } catch (err) { throw new Error('--state: not readable JSON'); }
    const r = await J.ask(id, state, { config: J.judgeConfig(teamOf(root), env), env, projectRoot: root, gate: 'cli' });
    return { code: r.skipped || r.error ? 3 : 0, out: r };
  }
  throw new Error(USAGE);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(({ code, out }) => {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    process.exitCode = code;
  }, (err) => {
    process.stderr.write(`judge.js: ${err.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main };
