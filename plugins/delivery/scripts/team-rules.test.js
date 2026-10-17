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
const read = (...p) => fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8');
const RULES = read('templates', 'team-rules.md');
const SKILL = read('skills', 'decision', 'SKILL.md');
const ROLES = fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
const roleText = (id) => read('roles', `${id}.md`);

function renderAll() {
  const team = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'hosts.json'), 'utf8'));
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

test('rules are numbered 1 to 13 in order; 11 is personal data, 12 operator decisions, 13 SendMessage', () => {
  const nums = RULES.split('\n').map((l) => /^(\d+)\. /.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(nums, Array.from({ length: 13 }, (_, i) => i + 1));
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
  for (const cmd of ['sync', 'pending', 'record', 'ack', 'delegate', 'decide', 'find', 'answer', 'ask', 'ratify', 'verify']) {
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
      // the first mention is the command line; later prose ("record that an instance moved") is not
      if (!m || map.has(m[1])) continue;
      map.set(m[1], new Set([...(m[2].match(/--[a-z-]+/g) || []), '--json', '--project']));
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

// Run the thing: the commands the briefs and the skill tell a role to type pass that role's lane.
test('the operator.js commands in each manager brief and the decision skill pass that role\'s lane', () => {
  const os = require('os');
  const { loadPolicy, decideLane } = require('../hooks/scripts/lane.js');
  const groups = JSON.parse(read('hooks', 'lane-groups.json'));
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-lane-'));
  const concrete = (span) => span.slice(1, -1)
    .replace(/\[[^\]]*\]/g, '') // optional parts
    .replace(/'<[^>]*>'/g, "'the operator said: don'\\''t ship yet, ok? A|B'") // a quoted value with awkward characters
    .replace(/<[^>]*>/g, 'x1');
  const cases = [['chief-of-staff', roleText('chief-of-staff')], ['chief-of-staff', SKILL], ['product-manager', roleText('product-manager')]];
  let n = 0;
  for (const [role, text] of cases) {
    const policy = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/' + role });
    for (const span of text.match(/`node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/operator\.js [^`]*`/g) || []) {
      const command = concrete(span);
      const d = decideLane({ toolName: 'Bash', toolInput: { command }, policy, roleDir, groups, pluginRoot: PLUGIN_ROOT, hostHeadless: false });
      assert.equal(d.allow, true, `${role}: ${command}\n${d.reason || ''}`);
      n++;
    }
  }
  assert.ok(n >= 20, String(n));
});
