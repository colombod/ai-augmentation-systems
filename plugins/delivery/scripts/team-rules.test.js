// scripts/team-rules.test.js — the team rules, role briefs and decision skill say what the operator
// protocol does: records, never relays; and every operator.js command they quote really exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadRoleBrief, composeBrief, parseFrontmatter } = require('./lib/compose-brief.js');
const { expandInstances } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
// the full manifest the tests run against (templates/ holds the minimal one users start from)
const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');
const read = (...p) => fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8');
const RULES = read('templates', 'team-rules.md');
const SKILL = read('skills', 'decision', 'SKILL.md');
const ROLES = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
const roleText = (id) => read('roles', `${id}.md`);

function renderAll() {
  const team = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8'));
  return expandInstances(team).map((i) => ({
    instance: i.instance,
    text: composeBrief({ team, hosts, instance: i.instance, role: i.role, brief: loadRoleBrief(PLUGIN_ROOT, '/nonexistent', i.role.brief), rules: RULES }),
  }));
}

test('rendered rules: records, never relays; the old "passes as the operator\'s word" sentence is gone', () => {
  for (const { instance, text } of renderAll()) {
    assert.ok(text.includes('operator.js verify'), instance);
    assert.ok(!text.includes("passes as the operator's word"), instance);
    assert.ok(text.includes('12. **Operator decisions are records, never relays.**'), instance);
    assert.ok(text.includes('confidence inferred it is the operator\'s word to act on, preferring reversible steps until it is ratified'), instance);
  }
});

test('rules are numbered 1 to 15 in order; 11 is personal data, 12 operator decisions, 13 SendMessage', () => {
  const nums = RULES.split('\n').map((l) => /^(\d+)\. /.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(nums, Array.from({ length: 15 }, (_, i) => i + 1));
  const rule = (n) => RULES.split('\n').find((l) => l.startsWith(`${n}. `));
  assert.equal(rule(11), '11. **No personal data** in a message, a bead or a pull request.');
  assert.match(rule(12), /^12\. \*\*Operator decisions are records, never relays\.\*\*/);
  assert.match(rule(12), /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/operator\.js verify <id>/);
  assert.match(rule(12), /reply asking the sender for the record id, never the operator/);
  assert.match(rule(13), /^13\. \*\*Address sessions by name with SendMessage\*\*/);
});

test('briefs: workers and managers never address the operator; the Chief of Staff carries every answer', () => {
  const never = 'You never address the operator: message the Chief of Staff with one question; the answer arrives as a record id you verify.';
  const escalate = 'If an operator decision is needed, tell the Chief of Staff the single question and the bead; do not wait on the operator.';
  for (const id of ROLES) {
    const t = roleText(id);
    if (id === 'chief-of-staff' || id === 'product-manager') assert.ok(!t.includes(never), id);
    else assert.ok(t.includes(never), id);
    assert.equal(t.includes(escalate), ['delivery-lead', 'staffing', 'progress-observer'].includes(id), id);
  }
  const cos = roleText('chief-of-staff');
  assert.ok(cos.includes("### The operator's time is yours to protect"));
  assert.ok(cos.includes('You NEVER ask the operator to tell, send, forward, paste, relay, confirm or reply to another session or role'));
  assert.ok(cos.includes('**Answer on the operator\'s behalf whenever you can prove the basis.**'));
  assert.match(cos, /--reason 'conversational'/);
  assert.match(cos, /--confidence settled/);
  assert.match(cos, /--confidence inferred --rationale/);
  assert.ok(cos.indexOf('## As a session') < cos.indexOf("### The operator's time"));
  const pm = roleText('product-manager');
  assert.match(pm, /operator\.js record --cite/);
  assert.match(pm, /tell the Chief of Staff the record id/);
});

test('decision skill: frontmatter, the loop with exact commands, answer-on-behalf, briefing line, record before acting', () => {
  const { meta, body } = parseFrontmatter(SKILL);
  assert.ok(typeof meta.description === 'string' && meta.description.length > 40);
  assert.ok('argument-hint' in meta);
  for (const cmd of ['pending', 'record', 'ack', 'find', 'answer', 'ask', 'verify']) {
    assert.ok(body.includes(`node \${CLAUDE_PLUGIN_ROOT}/scripts/operator.js ${cmd}`), cmd);
  }
  assert.ok(body.indexOf('operator.js find') < body.indexOf('--confidence settled'), 'find comes before answering');
  assert.match(body, /--confidence inferred --rationale/);
  assert.match(body, /Ratify or override\?/);
  assert.match(body, /Never act on an operator input, and never pass it on, before it is recorded or acknowledged/);
  assert.match(body, /--reason 'conversational'/);
});

// USAGE of operator.js: command -> the flags its line names
function usage() {
  const text = execFileSync(process.execPath, [path.join(__dirname, 'operator.js'), '--help']).toString();
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!/^ {2}[a-z]/.test(line)) continue;
    for (const seg of line.trim().split(/ {2,}/)) {
      const m = /^([a-z]+)\b(.*)$/.exec(seg);
      // a command may have several usage lines (ack --input, ack --pending): their flags are united;
      // prose after a usage ("record that an instance moved") carries no flags
      if (!m) continue;
      map.set(m[1], new Set([...(map.get(m[1]) || []), ...(m[2].match(/--[a-z-]+/g) || []), '--json', '--project']));
    }
  }
  return map;
}

test('every operator.js command quoted in the rules, briefs and skill exists with the flags it is given', () => {
  const U = usage();
  assert.ok(U.has('record') && U.get('record').has('--quote'));
  const sources = [['team-rules', RULES], ['decision skill', SKILL], ...ROLES.map((id) => [id, roleText(id)])];
  let seen = 0;
  for (const [name, text] of sources) {
    for (const span of text.match(/`[^`]*operator\.js [^`]*`/g) || []) {
      const m = /(\S*)operator\.js ([a-z]+)(.*)`$/.exec(span);
      assert.equal(m[1], '${CLAUDE_PLUGIN_ROOT}/scripts/', `${name}: ${span} uses the invocable path`);
      assert.ok(/node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/operator\.js/.test(span), `${name}: ${span} starts with node`);
      assert.ok(U.has(m[2]), `${name}: unknown command in ${span}`);
      for (const f of m[3].match(/--[a-z-]+/g) || []) assert.ok(U.get(m[2]).has(f), `${name}: ${m[2]} has no flag ${f} (${span})`);
      assert.ok(!/--(quote|statement|reason|text|question|answer|rationale|grant) "/.test(span), `${name}: quote in single quotes (${span})`);
      seen++;
    }
  }
  assert.ok(seen >= 20, `only ${seen} commands found`);
});

// Run the thing: the commands the briefs and the skill tell a role to type, rendered with the absolute
// plugin root the way the role session receives them, pass that role's lane and actually run. The
// plugin root is tried as is and through a path with a space and a quote in it.
test('rendered operator.js commands carry the absolute plugin root, pass the role\'s lane and run, also from a path with spaces', () => {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const { resolvePluginRoot, operatorCommand } = require('./lib/plugin-root.js');
  const groups = JSON.parse(read('hooks', 'lane-groups.json'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-lane-'));
  const spaced = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-root-')), "plugin cache's 0.20.0");
  fs.symlinkSync(PLUGIN_ROOT, spaced);
  const concrete = (cmd) => cmd
    .replace(/\[[^\]]*\]/g, '') // optional parts
    .replace(/'<[^>]*>'/g, "'the operator said: don'\\''t ship yet, ok? A|B'") // a quoted value with awkward characters
    .replace(/<[^>]*>/g, 'x1');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-proj-'));
  fs.mkdirSync(path.join(project, '.delivery', 'team'), { recursive: true });
  for (const f of ['team.json', 'hosts.json']) fs.copyFileSync(path.join(MANIFEST_FIXTURE, f), path.join(project, '.delivery', 'team', f));
  let n = 0;
  for (const root of [PLUGIN_ROOT, spaced]) {
    const prefix = operatorCommand(root);
    if (root === spaced) assert.ok(prefix.startsWith("node '"), prefix);
    const cases = [['chief-of-staff', roleText('chief-of-staff')], ['chief-of-staff', SKILL], ['product-manager', roleText('product-manager')], ['chief-of-staff', RULES]];
    for (const [role, raw] of cases) {
      const text = resolvePluginRoot(raw, root);
      assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'));
      const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + role });
      const spans = text.split('`').filter((x, k) => k % 2 === 1 && x.startsWith(prefix + ' '));
      assert.ok(spans.length >= 1, `${role}: no rendered command for ${root}`);
      for (const span of spans) {
        const command = concrete(span);
        const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy, roleDir, groups, pluginRoot: root, hostHeadless: false });
        assert.equal(d.allow, true, `${role}: ${command}\n${d.reason || ''}`);
        n++;
      }
    }
    // the rendered verify command from rule 12 runs: the script is found and answers for the fixture
    const verify = resolvePluginRoot(RULES, root).split('`').find((x) => x.startsWith(prefix + ' verify'));
    const r = spawnSync('sh', ['-c', `${verify.replace('<id>', 'dec-chief-of-staff-000001')} --project '${project}'`], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' } });
    assert.ok(!/Cannot find module/.test(r.stderr), r.stderr);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /NOT VERIFIED dec-chief-of-staff-000001: not_found/);
  }
  assert.ok(n >= 40, String(n));
});

test('rendered briefs and the SessionStart block contain no literal ${CLAUDE_PLUGIN_ROOT}', () => {
  const team = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8'));
  const { shortBrief } = require('./lib/compose-brief.js');
  for (const i of expandInstances(team)) {
    const text = composeBrief({ team, hosts, instance: i.instance, role: i.role, brief: loadRoleBrief(PLUGIN_ROOT, '/nonexistent', i.role.brief), rules: RULES, pluginRoot: PLUGIN_ROOT });
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'), i.instance);
    assert.ok(text.includes(path.join(PLUGIN_ROOT, 'scripts', 'operator.js')), i.instance);
    const short = shortBrief({ team, hosts, instance: i.instance, role: i.role, roleDir: '/r', pluginRoot: PLUGIN_ROOT });
    assert.ok(short.includes(`Operator commands: \`node ${path.join(PLUGIN_ROOT, 'scripts', 'operator.js')} <command>\``), i.instance);
  }
});

test('A1: stage 3 is owned: the Delivery Manager runs acceptance, the Product Manager realign and pivots, builders take spikes when no Spike Researcher is hired', () => {
  const dl = roleText('delivery-lead');
  assert.match(dl, /phase-review beads and acceptance/);
  assert.match(dl, /\/delivery:sprint-review/);
  const pm = roleText('product-manager');
  assert.match(pm, /You own realign and pivots/);
  assert.match(pm, /\/delivery:realign/);
  const b = roleText('builder');
  assert.match(b, /This team has no Spike Researcher, so spikes are yours/);
});

test('A5: builders pick the subagent model from size-L or a bead model; the Delivery Manager sizes stories honestly', () => {
  assert.match(roleText('builder'), /`size-L`, or one whose metadata carries `model`, gets that model for the implementer and reviewer subagents/);
  assert.match(roleText('builder'), /reviewer is at least as capable as the implementer/);
  assert.match(roleText('delivery-lead'), /Set `size:` honestly in every story: S is routine, M is ordinary work, L means risky or ambiguous/);
});

test('A6: optional roles promise only what exists', () => {
  const po = roleText('progress-observer');
  for (const gone of ['roster bead', 'evidence rows', 'evening review', 'retention window']) assert.ok(!po.includes(gone), gone);
  assert.match(po, /optional role/);
  const st = roleText('staffing');
  assert.ok(!st.includes('converges its sessions'));
  assert.match(st, /runs `prepare-role` for the new or changed instances/);
  const { PRESETS } = require('./start.js');
  for (const id of ['spike-researcher', 'staffing', 'progress-observer']) {
    assert.ok(!PRESETS.minimal.includes(id), `${id} is opt-in`);
    assert.ok(PRESETS.full.includes(id), `${id} stays available`);
  }
});

test('ruling 3: briefs and the decision skill teach only the day-one operator commands; the rest is in docs/operator-reference.md', () => {
  const DAY_ONE = new Set(['pending', 'find', 'record', 'ack', 'ask', 'answer', 'verify']);
  const texts = [['decision skill', SKILL], ['team-rules', RULES], ...ROLES.map((id) => [id, roleText(id)])];
  for (const [name, text] of texts) {
    for (const m of text.matchAll(/operator\.js ([a-z]+)/g)) assert.ok(DAY_ONE.has(m[1]), `${name} teaches operator.js ${m[1]}`);
  }
  for (const id of ROLES.filter((r) => !['chief-of-staff', 'product-manager'].includes(r))) {
    const cmds = new Set([...roleText(id).matchAll(/operator\.js ([a-z]+)/g)].map((m) => m[1]));
    for (const c of cmds) assert.equal(c, 'verify', `${id}: workers only verify`);
  }
  const ref = read('docs', 'operator-reference.md');
  for (const cmd of ['delegate', 'decide', 'revoke', 'ratify', 'withdraw', 'rehost', 'quarantine', 'repair', 'problems', 'ledger', 'show']) {
    assert.ok(ref.includes(`operator.js ${cmd}`), `reference covers ${cmd}`);
  }
});

test('final I1: the builder brief tells builders to take spikes first only when the team has no Spike Researcher', () => {
  const full = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), 'utf8'));
  const minimal = { ...full, roles: full.roles.filter((r) => r.id !== 'spike-researcher') };
  const render = (team) => {
    const i = expandInstances(team).find((x) => x.instance === 'builder-1');
    return composeBrief({ team, hosts, instance: 'builder-1', role: i.role, brief: loadRoleBrief(PLUGIN_ROOT, '/nonexistent', i.role.brief), rules: RULES });
  };
  const without = render(minimal);
  const withSr = render(full);
  assert.match(without, /Run `bd ready --label spike` first/);
  assert.match(without, /bd close <id> --reason "<the answer in one line, and where the proof is>"/);
  assert.doesNotMatch(without, /Spike beads are the Spike Researcher's/);
  assert.doesNotMatch(withSr, /bd ready --label spike/);
  assert.match(withSr, /Spike beads are the Spike Researcher's: leave them/);
  for (const t of [without, withSr]) assert.ok(!/<!-- (if|unless|end)/.test(t), 'no markers reach the session');
});
