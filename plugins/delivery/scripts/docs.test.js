// scripts/docs.test.js — the front-door docs (README top, docs/quickstart.md) name only things that
// exist: scripts, operator commands, skills, templates, prepare-role flags, and a manifest that
// validates. Light on purpose: it catches rot when a script, command or skill is renamed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateManifest, expandInstances } = require('./lib/manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8');
const README = read('README.md');
const QUICKSTART = read('docs', 'quickstart.md');

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

test('README opens with what you get, the picture and the four things, before "Why this exists"', () => {
  const order = ['## What you get', '## How it works in one picture', '## Four things to know', '## Documentation map', '## Why this exists'];
  const at = order.map((h) => README.indexOf(`\n${h}\n`));
  for (let i = 0; i < order.length; i++) assert.ok(at[i] > 0, `missing ${order[i]}`);
  for (let i = 1; i < order.length; i++) assert.ok(at[i - 1] < at[i], `${order[i - 1]} must come before ${order[i]}`);
  const picture = section(README, '## How it works in one picture');
  assert.match(picture, /```[\s\S]*Chief of Staff[\s\S]*```/);
  for (const word of ['Staffing', 'Product', 'Delivery', 'Progress', 'Builders', 'Spike', 'operator.js verify', 'PROJECT repo', 'PRODUCT repo']) {
    assert.ok(picture.includes(word), `the picture shows ${word}`);
  }
  assert.ok(README.includes('(docs/quickstart.md)'), 'README links the quickstart');
  assert.ok(README.includes('### Which skill do I run when?'));
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
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['README.md', README]]) {
    const named = [...text.matchAll(/(?:`|\$ |\/scripts\/)operator\.js ([a-z][a-z-]*)/g)].map((m) => m[1]);
    assert.ok(named.length > 0, name);
    for (const c of named) assert.ok(commands.has(c), `${name} names operator.js ${c}, which does not exist`);
  }
});

test('quickstart and README: every /delivery: skill they name exists', () => {
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['README.md', README]]) {
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
  for (const [name, text] of [['docs/quickstart.md', QUICKSTART], ['README.md', README]]) {
    assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|\/var\/folders\//, name);
    const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(?:com|org|net|io)\b/g)].map((m) => m[0])
      .filter((e) => !e.startsWith('git@') && !/@example\./.test(e) && !/^noreply@/.test(e));
    assert.deepStrictEqual(emails, [], `${name} carries an email address`);
  }
});
