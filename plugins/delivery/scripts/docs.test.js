// scripts/docs.test.js — the front-door docs (README, docs/quickstart.md, docs/reference.md) name only things that
// exist: scripts, operator commands, skills, templates, prepare-role flags, and a manifest that
// validates. Light on purpose: it catches rot when a script, command or skill is renamed.
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateManifest, expandInstances } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8');
const README = read('README.md');
const QUICKSTART = read('docs', 'quickstart.md');
const START_SKILL = read('skills', 'start', 'SKILL.md');
const REFERENCE = read('docs', 'reference.md');

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

test('README follows the flow: Install, Quick start, what has been verified, verified shipping, feature map, how it works, not supported, reference', () => {
  const order = ['## Install', '## Quick start', '## What has been verified', '## Verified shipping', '## Feature map', '## How it works', '## Not part of the supported product', '## Reference'];
  const at = order.map((h) => README.indexOf(`\n${h}\n`));
  for (let i = 0; i < order.length; i++) assert.ok(at[i] > 0, `missing ${order[i]}`);
  for (let i = 1; i < order.length; i++) assert.ok(at[i - 1] < at[i], `${order[i - 1]} must come before ${order[i]}`);
  assert.equal(README.indexOf('\n## '), README.indexOf('\n## Install\n'), 'Install is the first section');
  const lines = README.split('\n').length;
  assert.ok(lines <= 100, `README is ${lines} lines; keep it at 100 or fewer and move detail to docs/reference.md`);
});

test('README quick start: the steps name the pipeline skills in order, and what is not yet verified is said so', () => {
  const qs = section(README, '## Quick start');
  const order = ['/delivery:brief', '/delivery:prd', '/delivery:architecture', '/delivery:roadmap', '/delivery:stories', '/delivery:sprint', '/delivery:sprint-review', '/delivery:status'];
  const at = order.map((s) => qs.indexOf(s));
  for (let i = 0; i < order.length; i++) assert.ok(at[i] >= 0, `the quick start names ${order[i]}`);
  for (let i = 1; i < order.length; i++) assert.ok(at[i - 1] < at[i], `${order[i - 1]} must come before ${order[i]}`);
  assert.match(qs, /storyboard in your own words/, 'the owner approves the storyboard in their own words');
  assert.ok(section(README, '## What has been verified').includes('Not yet run end to end'), 'the README says what has not been run end to end');
});

test('display names: the Delivery Manager is never called the Delivery Lead in the docs', () => {
  for (const [name, text] of [['README.md', README], ['docs/quickstart.md', QUICKSTART], ['docs/reference.md', REFERENCE]]) {
    assert.doesNotMatch(text, /Delivery Lead/, name);
  }
  for (const dir of ['skills', 'roles', 'agents', 'templates', 'references', 'docs']) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(PLUGIN_ROOT, dir)).filter((f) => f.endsWith('.md'))) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Delivery Lead/, path.relative(PLUGIN_ROOT, f));
    }
  }
  // the reference's roles table: one row per role brief, display name first, id second
  const rows = [...REFERENCE.matchAll(/^\| ([A-Z][A-Za-z ]+?)(?: \(optional, `full`\))? \| `([a-z-]+)`/gm)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(rows.map((r) => r[1]).sort(), fs.readdirSync(path.join(PLUGIN_ROOT, 'roles')).map((f) => f.replace(/\.md$/, '')).sort());
  assert.ok(rows.some(([name, id]) => name === 'Delivery Manager' && id === 'delivery-lead'), 'delivery-lead is displayed as the Delivery Manager');
  assert.match(REFERENCE, /## Sessions you run vs reviewers they call/);
  assert.match(REFERENCE, /Agents are reviewer lenses, not sessions/);
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) assert.ok(REFERENCE.includes('`' + f.replace(/\.md$/, '') + '`'), `reference lists the lens ${f}`);
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'roles'))) assert.ok(REFERENCE.includes('`' + f.replace(/\.md$/, '') + '`'), `reference lists the role ${f}`);
});

test('README and docs/reference.md: every relative link resolves', () => {
  for (const [name, text, base] of [['README.md', README, PLUGIN_ROOT], ['docs/reference.md', REFERENCE, path.join(PLUGIN_ROOT, 'docs')]]) {
    for (const m of text.matchAll(/\]\(((?!https?:|#)[^)#\s]+)(?:#[^)]*)?\)/g)) {
      assert.ok(fs.existsSync(path.join(base, m[1])), `${name} links ${m[1]}, which does not exist`);
    }
  }
});

test('quickstart: every script path it names exists', () => {
  const paths = new Set([...QUICKSTART.matchAll(/\b((?:scripts|hooks\/scripts|templates)\/[A-Za-z0-9_./-]+\.(?:json|js))\b/g)].map((m) => m[1]));
  assert.ok(paths.has('scripts/prepare-role.js'));
  assert.ok(paths.has('scripts/operator.js'));
  for (const p of paths) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, p)), `${p} named in docs/quickstart.md does not exist`);
});

test('quickstart and README: every operator.js command they name is a real command', () => {
  const src = read('scripts', 'operator.js');
  const list = /const COMMANDS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(list, 'operator.js declares COMMANDS');
  const commands = new Set([...list[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART]]) {
    const named = [...text.matchAll(/(?:`|\$ |\/scripts\/)operator\.js ([a-z][a-z-]*)/g)].map((m) => m[1]);
    assert.ok(named.length > 0, name);
    for (const c of named) assert.ok(commands.has(c), `${name} names operator.js ${c}, which does not exist`);
  }
});

test('quickstart, README and reference: every /delivery: skill they name exists', () => {
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['README.md', README], ['docs/reference.md', REFERENCE]]) {
    for (const m of text.matchAll(/\/delivery:([a-z][a-z-]*)/g)) {
      assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'skills', m[1], 'SKILL.md')), `${name} names /delivery:${m[1]}, which has no skill`);
    }
  }
});

test('quickstart: the prepare-role flags it uses are the ones prepare-role accepts', () => {
  const usage = read('scripts', 'prepare-role.js');
  const flags = new Set([...QUICKSTART.matchAll(/prepare-role\.js[^\n`]*/g)].flatMap((m) => [...m[0].matchAll(/--([a-z-]+)/g)].map((f) => f[1])));
  for (const f of ['project', 'instance', 'product-repo']) assert.ok(flags.has(f), `quickstart shows --${f}`);
  for (const f of flags) assert.ok(usage.includes(`[--${f} `) || usage.includes(`--${f} <`), `prepare-role.js does not accept --${f}`);
  for (const f of ['--team-dir', '--user']) assert.ok(QUICKSTART.includes(f) && usage.includes(f), f);
});

test('quickstart: the minimal team.json and hosts.json it shows validate and expand to the four roles', () => {
  const blocks = [...QUICKSTART.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  const team = blocks.find((b) => Array.isArray(b.roles));
  const hosts = blocks.find((b) => b.hosts);
  assert.ok(team && hosts, 'quickstart shows team.json and hosts.json');
  assert.deepStrictEqual(validateManifest(team, hosts), []);
  assert.deepStrictEqual(expandInstances(team).map((i) => i.instance), ['chief-of-staff', 'product-manager', 'delivery-lead', 'builder']);
  for (const r of team.roles) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'roles', `${r.brief.split('/')[1]}.md`)), r.brief);
});

test('front-door docs carry no local paths or personal data', () => {
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['README.md', README], ['docs/reference.md', REFERENCE]]) {
    assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|\/var\/folders\//, name);
    const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|org|net|io)\b/g)].map((m) => m[0])
      .filter((e) => !e.startsWith('git@') && !/@example\./.test(e) && !/^noreply@/.test(e));
    assert.deepStrictEqual(emails, [], `${name} carries an email address`);
  }
});

test('README "Install": the marketplace commands and what is needed', () => {
  const body = section(README, '## Install');
  for (const need of ['/plugin marketplace add colombod/ai-augmentation-systems', '/plugin install delivery@ai-augmentation-systems', 'Node 18', 'git']) assert.ok(body.includes(need), `Install names ${need}`);
});

test('start.js: every flag the docs and the start skill name is one start.js accepts, and the check minimums match', () => {
  const src = read('scripts', 'start.js');
  const known = /const KNOWN = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(known, 'start.js declares KNOWN');
  const accepted = new Set([...known[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  let seen = 0;
  // a line that runs start.js, or the quickstart's list of its other flags: every --flag after it must exist
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['skills/start/SKILL.md', START_SKILL]]) {
    for (const line of text.split('\n')) {
      const at = line.startsWith('Other flags:') ? 0 : line.indexOf('start.js');
      if (at < 0) continue;
      for (const m of line.slice(at).matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
        seen++;
        assert.ok(accepted.has(m[1]), `${name} names start.js --${m[1]}, which start.js does not accept`);
      }
    }
  }
  assert.ok(seen > 5);
  const { MIN_CLAUDE, MIN_NODE_MAJOR } = require('./start.js');
  for (const text of [QUICKSTART]) {
    assert.ok(text.includes(`v${MIN_CLAUDE.join('.')}`), 'docs state the Claude Code minimum start.js checks');
    assert.ok(text.includes(`Node ${MIN_NODE_MAJOR}`), 'docs state the Node minimum start.js checks');
  }
});
