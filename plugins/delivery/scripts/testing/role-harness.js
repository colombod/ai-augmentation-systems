// scripts/testing/role-harness.js — role sessions for tests: real role markers, the real PreToolUse hook
// processes (role-lane.js, then bd-guard-hook.js) on every Bash command, the fake bd, the real scripts.
// A command runs only when both hooks allow it, as in a role session. Never used in production.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeProject } = require('./gate-fixture.js');

const P = path.join(__dirname, '..', '..');

// root: a project from gate-fixture (or makeProject()); beads: { id: bead } for the fake bd; deps: [{ id, blockedBy }];
// prs: { "<n>": gh pr view fields } for the fake gh (testing/fake-gh.js) on repo, which also becomes the
// manifest's product_github; without prs gh is signed out
// runs: CI runs for `gh run list` (with prs, or alone)
// restOnly: gh refuses GraphQL (as in Claude Code's cloud sessions) and answers `gh api` from prs
// clone: each role's project/ is its own copy of the project, as prepare-role's clone is (default: a link
// to the shared root, which the lane refuses to write)
function harness({ root = makeProject(), beads = {}, deps = [], prs = null, runs = null, repo = 'example/example', clone = false, restOnly = false } = {}) {
  const tj = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(tj, 'utf8'));
  if (!team.roles.some((r) => r.id === 'reality-checker')) team.roles.push({ id: 'reality-checker', brief: 'delivery/reality-checker', host: 'pc', model: 'sonnet' });
  if ((prs || runs) && repo) team.product_github = repo;
  fs.writeFileSync(tj, JSON.stringify(team, null, 2));
  const store = path.join(root, 'bd-store.json');
  const issues = {};
  for (const b of Object.values(beads)) issues[b.id] = { title: b.id, status: 'open', type: 'task', notes: '', priority: 1, description: '', assignee: '', updated_at: new Date().toISOString(), labels: [], metadata: {}, ...b };
  fs.writeFileSync(store, JSON.stringify({ issues, deps: deps.map((d) => ({ id: d.id, blocked_by: d.blockedBy })) }, null, 2));
  const ghStore = path.join(root, 'gh-store.json');
  if (prs || runs) fs.writeFileSync(ghStore, JSON.stringify({ repo, prs: prs || {}, runs: runs || [], ...(restOnly ? { rest_only: true } : {}) }, null, 2));
  const rolesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  const roleDir = (inst) => {
    const d = path.join(rolesDir, inst);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(path.join(d, 'product'), { recursive: true });
      if (clone) fs.cpSync(root, path.join(d, 'project'), { recursive: true }); else fs.symlinkSync(root, path.join(d, 'project'));
      fs.writeFileSync(path.join(d, '.delivery-role.json'), JSON.stringify({ instance: inst, project_root: root, actor: `dev@pc/${inst}` }));
    }
    return d;
  };
  const env = (inst) => ({ ...process.env, DELIVERY_ROLE: inst, DELIVERY_ROLE_DIR: roleDir(inst), BD_FAKE_STORE: store, GH_FAKE_STORE: ghStore, PATH: `${__dirname}${path.delimiter}${process.env.PATH}`,
    BEADS_ACTOR: `dev@pc/${inst}`, CLAUDE_PLUGIN_ROOT: P, TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9' });
  const hook = (script, inst, toolName, toolInput, event = 'PreToolUse') => {
    const cwd = roleDir(inst);
    const r = spawnSync('node', [path.join(P, 'hooks', 'scripts', script)], { input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd, hook_event_name: event }), env: env(inst), cwd, encoding: 'utf8', timeout: 30000 });
    let j = null;
    try { j = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch (err) { j = null; }
    const h = (j && j.hookSpecificOutput) || {};
    return { deny: h.permissionDecision === 'deny' ? h.permissionDecisionReason : null, ctx: h.additionalContext || '' };
  };
  // the PreToolUse chain for Bash, then the command itself when both hooks allow it
  const bash = (inst, command, { run = true } = {}) => {
    const lane = hook('role-lane.js', inst, 'Bash', { command });
    if (lane.deny) return { deny: `lane: ${lane.deny}` };
    const g = hook('bd-guard-hook.js', inst, 'Bash', { command });
    if (g.deny) return { deny: `bd guard: ${g.deny}` };
    if (!run) return { deny: null, ctx: g.ctx };
    const r = spawnSync('bash', ['-c', command], { env: env(inst), cwd: roleDir(inst), encoding: 'utf8' });
    return { deny: null, ctx: g.ctx, out: `${r.stdout}${r.stderr}`.trim(), code: r.status };
  };
  const script = (name) => `node ${path.join(P, 'scripts', name)}`;
  const db = () => JSON.parse(fs.readFileSync(store, 'utf8'));
  const setBead = (id, f) => { const s = db(); f(s.issues[id]); fs.writeFileSync(store, JSON.stringify(s, null, 2)); };
  const gh = () => (fs.existsSync(ghStore) ? JSON.parse(fs.readFileSync(ghStore, 'utf8')).prs : {});
  const setPr = (n, f) => { const s = JSON.parse(fs.readFileSync(ghStore, 'utf8')); f(s.prs[n]); fs.writeFileSync(ghStore, JSON.stringify(s, null, 2)); };
  const setRuns = (list) => { const g = JSON.parse(fs.readFileSync(ghStore, 'utf8')); g.runs = list; fs.writeFileSync(ghStore, JSON.stringify(g, null, 2)); };
  return { root, store, roleDir, gh, setPr, setRuns, bash, tool: (inst, name, input) => hook('role-lane.js', inst, name, input), script,
    // a sent message as the session's hooks see it: the lane first, then the PostToolUse route check
    send: (inst, toolName, input) => { const lane = hook('role-lane.js', inst, toolName, input); return lane.deny ? { deny: `lane: ${lane.deny}` } : { deny: null, ctx: hook('route-check.js', inst, toolName, input, 'PostToolUse').ctx }; }, db, setBead };
}

const evIdOf = (out) => (/(ev-[a-z0-9.-]+-\d+)/.exec(out || '') || [])[1];

module.exports = { harness, evIdOf };
