// scripts/products.test.js — the per-product view of work in flight (products.js, lib/product-view.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { main } = require('./products.js');
const PV = require('./lib/product-view.js');
const R = require('./lib/reviews.js');

const SHA_INSTALLED = 'a'.repeat(40);
const SHA_MERGE = 'c'.repeat(40);
const SHA_DEPLOYED = 'd'.repeat(40);

function project(name, repo) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `products-${name}-`)));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: name, prefix: name, bd_host: 'pc', product_github: repo, roles: [] }));
  fs.copyFileSync(path.join(__dirname, 'testing', 'manifest', 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

const bead = (id, over = {}) => ({ id, title: `work ${id}`, status: 'open', assignee: null, labels: [], metadata: {}, ...over });

// one product's records: beads in each state, an open pull request, a merge on record, owner steps and questions
function records(name) {
  const p = (s) => `${name}-${s}`;
  return {
    beads: [
      bead(p('1'), { status: 'in_progress', assignee: `dev@pc/builder-${name}`, labels: ['story', 'state-merged'], metadata: {} }),
      bead(p('2'), { status: 'blocked', assignee: 'dev@pc/delivery-lead', title: `waits on ${name} sign-in` }),
      bead(p('3'), { status: 'open', labels: ['story', 'state-merged'], metadata: { merged_pr: '21' } }),
      bead(p('4'), { status: 'open', labels: ['story', 'state-deployed'], metadata: { merged_pr: '20', deployed_sha: SHA_DEPLOYED } }),
      bead(p('5'), { status: 'closed', labels: ['story', 'state-verified'], metadata: { deployed_sha: SHA_DEPLOYED } }),
    ],
    prs: [{ number: 22, title: `${name} change`, headRefName: `team/builder-${name}`, headRefOid: 'e'.repeat(40), isDraft: false, body: `Refs ${p('1')}` }],
    steps: [{ id: `o-${name}-1`, kind: 'signin', what: `Sign in to the ${name} store` }],
    questions: [{ id: `q-${name}-1`, text: `Ship ${name} to everyone?` }],
    verdicts: { [p('4')]: { ok: false, criteria: [{ n: 1, row: `ev-${p('4')}-1` }, { n: 2, why: 'no pass row' }] } },
  };
}

function memStore(list) {
  return {
    list({ label, all } = {}) {
      return list.filter((b) => (all || b.status !== 'closed') && (!label || b.labels.includes(label))).map((b) => JSON.parse(JSON.stringify(b)));
    },
    show(id) { return list.find((b) => b.id === id) || null; },
  };
}

// fakes for every source, over the records of each product root
function fakes(products, { market = {} } = {}) {
  const byRoot = new Map(products.map((p) => [p.root, p]));
  const byRepo = new Map(products.map((p) => [p.repo, p]));
  const installed = { version: 2, plugins: {} };
  const markets = {};
  for (const p of products) {
    const m = `${p.name}-market`;
    markets[m] = { source: { source: 'github', repo: p.repo }, installLocation: `/cfg/plugins/marketplaces/${m}` };
    installed.plugins[`${p.name}@${m}`] = [{ scope: 'user', installPath: `/cache/${p.name}`, version: '1.2.3', gitCommitSha: SHA_INSTALLED }];
  }
  Object.assign(markets, market);
  return {
    configDir: '/cfg',
    readFile: (f) => {
      if (f === path.join('/cfg', 'plugins', 'installed_plugins.json')) return JSON.stringify(installed);
      if (f === path.join('/cfg', 'plugins', 'known_marketplaces.json')) return JSON.stringify(markets);
      const e = new Error(`ENOENT: no such file or directory, open '${f}'`); e.code = 'ENOENT'; throw e;
    },
    bdFor: (root) => memStore(byRoot.get(root).rec.beads),
    gh: (args) => { const p = byRepo.get(args[args.indexOf('-R') + 1]); return p ? { status: 0, stdout: JSON.stringify(p.rec.prs) } : { status: 1, stderr: 'no such repo' }; },
    git: () => ({ status: 1 }),
    ownerSteps: (root) => byRoot.get(root).rec.steps,
    questions: (root) => byRoot.get(root).rec.questions,
    checkOf: (root, b) => byRoot.get(root).rec.verdicts[b.id] || { ok: true, criteria: [] },
    findRoot: () => null,
  };
}

function product(name) {
  const repo = `owner/${name}-repo`;
  const root = project(name, repo);
  R.append(root, 21, { type: 'merged', repo, merge_commit: SHA_MERGE, at: '2026-11-01T00:00:00Z' }, 'delivery-lead');
  return { name, repo, root, rec: records(name) };
}

test('9cp.1 c1: the command prints all five sections for a product, each line citing its record', () => {
  const a = product('alpha');
  const r = main(['--project', a.root], fakes([a]));
  assert.equal(r.code, 0, r.out);
  const lines = r.out.split('\n');
  const has = (re) => assert.ok(lines.some((l) => re.test(l)), `no line matches ${re}\n${r.out}`);
  // 1. open work with its owner and state
  has(/^\[alpha\] open work: alpha-1 in_progress, owner dev@pc\/builder-alpha, state merged: work alpha-1$/);
  has(/^\[alpha\] open work: alpha-2 blocked, owner dev@pc\/delivery-lead, state none/);
  // 2. pull requests in review, by number and head
  has(/^\[alpha\] in review: PR #22 at eeeeeeeeeeee on team\/builder-alpha, review no review requested, refs alpha-1: alpha change$/);
  // 3. merged, not installed: the bead, its PR and merge sha, the installed version and sha
  has(/^\[alpha\] merged, not installed: alpha-3 PR #21 merge cccccccccccc; install 1\.2\.3 at aaaaaaaaaaaa: the install does not contain it$/);
  // 4. installed, not checked: the bead, the deployed sha, the evidence row and the missing criterion
  has(/^\[alpha\] installed, not checked: alpha-4 deployed at dddddddddddd: criterion 1 pass ev-alpha-4-1; criterion 2 no pass row$/);
  // 5. blockers, owner steps and owner questions
  has(/^\[alpha\] blocker: alpha-2 blocked, owner dev@pc\/delivery-lead: waits on alpha sign-in$/);
  has(/^\[alpha\] owner step: o-alpha-1 signin: Sign in to the alpha store$/);
  has(/^\[alpha\] owner question: q-alpha-1 Ship alpha to everyone\?$/);
  // the install line names its record
  has(/^\[alpha\] install: alpha@alpha-market 1\.2\.3 at aaaaaaaaaaaa \(installed_plugins\.json\)$/);
  // a verified story and a merge the install contains are not reported as waiting
  assert.ok(!r.out.includes('alpha-5'), r.out);
  // every product line cites a record: a bead id, a PR number, a sha, an evidence or owner record, or the source read
  const cite = /alpha-\d|PR #\d+|[0-9a-f]{12}|\bev-|\bo-alpha|\bq-alpha|\(bd list\)|\(gh pr list|installed_plugins\.json|state-merged beads|pass row per criterion|root \//;
  for (const l of lines.filter((x) => x.startsWith('[alpha]'))) {
    if (/^\[alpha\] blockers and owner questions: \d+$/.test(l)) continue;
    assert.match(l, cite, `line cites no record: ${l}`);
  }
});

test('9cp.1 c1: a merge the install contains is installed, and waits on its check, not its install', () => {
  const a = product('alpha');
  const f = fakes([a]);
  f.git = (args) => ({ status: args.includes(SHA_MERGE) ? 0 : 1 });
  f.readFile = ((orig) => (file) => {
    const t = orig(file);
    if (!file.endsWith('known_marketplaces.json')) return t;
    const j = JSON.parse(t);
    j['alpha-market'].installLocation = '/cfg/plugins/marketplaces/alpha-market';
    return JSON.stringify(j);
  })(f.readFile);
  const r = main(['--project', a.root], f);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\[alpha\] installed, not checked: alpha-3 PR #21 merge cccccccccccc is in the install at aaaaaaaaaaaa; no deploy recorded$/m);
  assert.doesNotMatch(r.out, /merged, not installed: alpha-3/);
});

test('9cp.1 c3: with two products configured each line names its product and none crosses products', () => {
  const a = product('alpha');
  const b = product('beta');
  const r = main(['--project', b.root, '--project', a.root], fakes([a, b]));
  assert.equal(r.code, 0, r.out);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'products: 2: alpha, beta');
  for (const l of lines.slice(1)) {
    const m = /^\[(alpha|beta)\] /.exec(l);
    assert.ok(m, `line names no product: ${l}`);
    const other = m[1] === 'alpha' ? 'beta' : 'alpha';
    assert.ok(!l.includes(other), `a ${m[1]} line names ${other}: ${l}`);
  }
  for (const name of ['alpha', 'beta']) {
    for (const section of ['open work', 'in review', 'merged, not installed', 'installed, not checked', 'blocker', 'owner step', 'owner question']) {
      assert.ok(lines.some((l) => l.startsWith(`[${name}] ${section}: `)), `${name} has no ${section} line`);
    }
  }
  // the lib returns the same separation for the next caller
  const views = PV.readProducts([b.root, a.root], fakes([a, b]));
  assert.deepEqual(views.map((v) => v.product), ['alpha', 'beta']);
  assert.ok(views[0].open.every((x) => x.id.startsWith('alpha-')) && views[1].open.every((x) => x.id.startsWith('beta-')));
});

test('9cp.1 c4: bd failing is named with its product, the other sections print, and the exit is non-zero', () => {
  const a = product('alpha');
  const b = product('beta');
  const f = fakes([a, b]);
  const good = f.bdFor;
  f.bdFor = (root) => (root === a.root ? { list() { throw new Error('bd list --json --limit 0: database not found'); } } : good(root));
  const r = main(['--project', a.root, '--project', b.root], f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^\[alpha\] SOURCE UNAVAILABLE: bd for product alpha \(open work, merged not installed, installed not checked, blockers\): bd list --json --limit 0: database not found$/m);
  assert.match(r.out, /^\[alpha\] open work: not shown, bd could not be read for product alpha$/m);
  assert.match(r.out, /^\[alpha\] in review: PR #22 /m);
  assert.match(r.out, /^\[alpha\] owner step: o-alpha-1 /m);
  assert.match(r.out, /^\[alpha\] blockers and owner questions: 2 \(incomplete: a source is unavailable\)$/m);
  assert.match(r.out, /^\[beta\] open work: beta-1 /m);
  assert.match(r.out, /^INCOMPLETE: alpha \(bd\) could not be read; the picture above is partial$/m);
});

test('9cp.1 c4: gh failing is named with its product, the other sections print, and the exit is non-zero', () => {
  const a = product('alpha');
  const f = fakes([a]);
  f.gh = () => ({ status: 1, stderr: 'gh: not logged in to any hosts' });
  const r = main(['--project', a.root], f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^\[alpha\] SOURCE UNAVAILABLE: gh for product alpha \(in review\): gh pr list -R owner\/alpha-repo: gh: not logged in to any hosts$/m);
  assert.match(r.out, /^\[alpha\] in review: not shown, gh could not be read for product alpha$/m);
  assert.match(r.out, /^\[alpha\] open work: alpha-1 /m);
  assert.match(r.out, /^\[alpha\] installed, not checked: alpha-4 /m);
});

test('9cp.1 c4: a missing or unreadable install record is named with its product, and the exit is non-zero', () => {
  const a = product('alpha');
  for (const [broken, why] of [[() => { throw new Error("ENOENT: no such file or directory, open '/cfg/plugins/installed_plugins.json'"); }, /is missing or cannot be read/], [() => '{ not json', /is not JSON/]]) {
    const f = fakes([a]);
    const read = f.readFile;
    f.readFile = (file) => (file.endsWith('installed_plugins.json') ? broken() : read(file));
    const r = main(['--project', a.root], f);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`^\\[alpha\\] SOURCE UNAVAILABLE: install record for product alpha \\(merged not installed, installed not checked\\): the install record /cfg/plugins/installed_plugins.json ${why.source}`, 'm'));
    assert.match(r.out, /^\[alpha\] merged, not installed: not shown, the install record could not be read for product alpha$/m);
    assert.match(r.out, /^\[alpha\] open work: alpha-1 /m);
    assert.match(r.out, /^\[alpha\] in review: PR #22 /m);
  }
  // an install record that holds nothing from the product's repository cannot tell what is installed either
  const f = fakes([a]);
  const read = f.readFile;
  f.readFile = (file) => (file.endsWith('installed_plugins.json') ? JSON.stringify({ version: 2, plugins: {} }) : read(file));
  const r = main(['--project', a.root], f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^\[alpha\] SOURCE UNAVAILABLE: install record for product alpha .*no install of a plugin from owner\/alpha-repo$/m);
});

test('9cp.1 c4: the owner queue or the operator records failing is named, and the exit is non-zero', () => {
  const a = product('alpha');
  const f = fakes([a]);
  f.questions = () => { throw new Error('the operator records could not be read (1 problem: chain broken)'); };
  const r = main(['--project', a.root], f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^\[alpha\] SOURCE UNAVAILABLE: operator records for product alpha \(blockers and owner questions\): /m);
  assert.match(r.out, /^\[alpha\] owner step: o-alpha-1 /m);
});

// the real command in its own process, with fake bd and gh on PATH and an install record on disk
function onDisk(p) {
  fs.mkdirSync(path.join(p.root, '.beads'), { recursive: true });
  const issues = Object.fromEntries(p.rec.beads.map((b) => [b.id, { ...b, type: 'task' }]));
  fs.writeFileSync(path.join(p.root, '.beads', 'fake-store.json'), JSON.stringify({ issues, deps: [] }));
}

test('9cp.1 c2: two runs over the same records, in other processes and directories, print the same bytes', () => {
  const a = product('alpha');
  const b = product('beta');
  onDisk(a);
  onDisk(b);
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'products-cfg-'));
  fs.mkdirSync(path.join(cfg, 'plugins'));
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'alpha@alpha-market': [{ scope: 'user', version: '1.2.3', gitCommitSha: SHA_INSTALLED, installPath: '/x' }] } }));
  fs.writeFileSync(path.join(cfg, 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'alpha-market': { source: { source: 'github', repo: a.repo } } }));
  const ghStore = path.join(cfg, 'gh.json');
  fs.writeFileSync(ghStore, JSON.stringify({ repo: a.repo, prs: { 22: { title: 'alpha change', headRefName: 'team/builder-alpha', headRefOid: 'e'.repeat(40), isDraft: false, body: 'Refs alpha-1' } } }));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DELIVERY_|BEADS_|BD_)/.test(k)) env[k] = v;
  Object.assign(env, { PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: 'beads-dir', GH_FAKE_STORE: ghStore, CLAUDE_CONFIG_DIR: cfg });
  const run = (cwd, other) => spawnSync(process.execPath, [path.join(__dirname, 'products.js'), '--project', other], { cwd, env, encoding: 'utf8' });
  const first = run(a.root, b.root);
  // a later session, elsewhere, after a restart
  const second = run(b.root, a.root);
  assert.ok(first.stdout.length > 0, first.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.equal(second.status, first.status);
  // beta's gh repository and install are not in the fakes: named, and the exit says the picture is partial
  assert.equal(first.status, 1, first.stdout);
  assert.match(first.stdout, /^\[alpha\] open work: alpha-1 in_progress/m);
  assert.match(first.stdout, /^\[alpha\] in review: PR #22 /m);
  assert.match(first.stdout, /^\[alpha\] installed, not checked: alpha-4 deployed at dddddddddddd: the story has no acceptance criteria$/m);
  assert.match(first.stdout, /^\[beta\] SOURCE UNAVAILABLE: gh for product beta /m);
  assert.match(first.stdout, /^\[beta\] open work: beta-1 in_progress/m);
  // no clock in the output
  assert.doesNotMatch(first.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

test('9cp.1 c5: the Chief of Staff brief starts every session and every briefing from products.js', () => {
  const brief = fs.readFileSync(path.join(__dirname, '..', 'roles', 'chief-of-staff.md'), 'utf8');
  const para = brief.split('\n').find((l) => l.includes('scripts/products.js'));
  assert.ok(para, 'the brief names no products.js command');
  assert.ok(para.includes('`node ${CLAUDE_PLUGIN_ROOT}/scripts/products.js`'), para);
  assert.match(para, /Start every session and every briefing from the work in flight/);
  assert.match(para, /first command of every session, and the first of every briefing/);
  // and the command is in its lane: the read group every role holds, beside team-status.js
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'lane-groups.json'), 'utf8'));
  assert.ok(groups.read.some((g) => g.first === 'node' && g.arg_prefix === '${CLAUDE_PLUGIN_ROOT}/scripts/products.js' && !g.sub), 'products.js is not in the read lane group');
  assert.match(brief, /^lane_bash: read,/m);
});
