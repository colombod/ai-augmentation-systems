#!/usr/bin/env node
// scripts/products.js — the work in flight of every product the Chief of Staff serves, read only from the
// records (lib/product-view.js): open work with its owner and state, pull requests in review, merged but
// not installed, installed but not checked on the customer's surface, and blockers with the owner's steps
// and questions. Every line names its product and cites its record (a bead id, a PR number, a sha, an
// evidence row id or the source it read).
//
//   products.js [--project <root>]... [--json]
//
// The products are the current project and each --project root (each root's team.json names the
// product, its prefix and product_github). The output holds no clock and is sorted, so the same records
// print the same bytes whichever session or directory runs it. When a source cannot be read (bd, gh, the
// install record, the owner queue, the operator records) the line names it and its product, the other
// sections still print, and the exit code is 1. Exit codes: 0 every source read; 1 a source missing;
// 2 usage or no product.
const path = require('path');
const PV = require('./lib/product-view.js');

const USAGE = 'usage: products.js [--project <root>]... [--json]';

function parse(argv) {
  const out = { projects: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') { if (!argv[i + 1]) throw new Error('--project needs a root'); out.projects.push(argv[++i]); }
    else if (a.startsWith('--project=')) out.projects.push(a.slice('--project='.length));
    else if (a === '--json') out.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

const one = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
const short = (s) => (s ? String(s).slice(0, 12) : 'unknown');

function criterionText(c) {
  if (c.row) return `criterion ${c.n} pass ${c.row}`;
  if (c.waiver) return `criterion ${c.n} waived ${c.waiver}`;
  return `criterion ${c.n} ${one(c.why) || 'no pass row'}`;
}

// the lines for one product's view; each starts with [<product>]
function render(v) {
  const p = `[${v.product}]`;
  const L = [];
  L.push(`${p} product ${v.product}: root ${v.root}, prefix ${v.prefix || 'none'}, repository ${v.repo || 'none'}`);
  for (const u of v.unavailable) L.push(`${p} SOURCE UNAVAILABLE: ${u.source} for product ${v.product} (${u.section}): ${one(u.why)}`);
  const noTeam = v.unavailable.some((u) => u.source === 'team.json');
  const notShown = (name, source) => L.push(`${p} ${name}: not shown, ${noTeam ? 'team.json' : source} could not be read for product ${v.product}`);

  if (v.install) L.push(`${p} install: ${v.install.key} ${v.install.version || 'unknown version'} at ${short(v.install.sha)} (installed_plugins.json)`);

  if (v.open) {
    L.push(`${p} open work: ${v.open.length} (bd list)`);
    for (const b of v.open) L.push(`${p} open work: ${b.id} ${b.status}, owner ${b.assignee || 'nobody'}, state ${b.state || 'none'}: ${one(b.title)}`);
  } else notShown('open work', 'bd');

  if (v.reviews) {
    L.push(`${p} in review: ${v.reviews.length} open pull request${v.reviews.length === 1 ? '' : 's'} (gh pr list -R ${v.repo})`);
    for (const r of v.reviews) L.push(`${p} in review: PR #${r.pr} at ${short(r.head)} on ${r.branch || 'unknown branch'}${r.draft ? ', draft' : ''}, review ${r.review}, refs ${r.refs.length ? r.refs.join(' ') : 'none'}: ${one(r.title)}`);
  } else notShown('in review', 'gh');

  if (v.notInstalled) {
    L.push(`${p} merged, not installed: ${v.notInstalled.length} (state-merged beads against ${v.install ? short(v.install.sha) : 'the install'})`);
    for (const m of v.notInstalled) {
      const why = !m.merge ? 'its merge commit is not recorded' : m.known ? 'the install does not contain it' : 'the install\'s clone cannot tell whether it contains it';
      L.push(`${p} merged, not installed: ${m.id} PR ${m.pr ? `#${m.pr}` : 'unknown'} merge ${short(m.merge)}; install ${m.installed.version || 'unknown version'} at ${short(m.installed.sha)}: ${why}`);
    }
  } else notShown('merged, not installed', v.install ? 'bd' : 'the install record');

  if (v.unchecked) {
    L.push(`${p} installed, not checked: ${v.unchecked.length} (deployed or installed beads without a pass row per criterion)`);
    for (const u of v.unchecked) {
      if (!u.sha) { L.push(`${p} installed, not checked: ${u.id} PR ${u.pr ? `#${u.pr}` : 'unknown'} merge ${short(u.merge)} is in the install at ${short(u.installed)}; ${u.problem}`); continue; }
      const detail = u.problem ? one(u.problem) : u.criteria.map(criterionText).join('; ');
      L.push(`${p} installed, not checked: ${u.id} deployed at ${short(u.sha)}: ${detail}`);
    }
  } else notShown('installed, not checked', 'bd');

  if (v.blockers) {
    L.push(`${p} blockers and owner questions: ${v.blockers.length}${v.blockersComplete ? '' : ' (incomplete: a source is unavailable)'}`);
    for (const b of v.blockers) {
      if (b.kind === 'bead') L.push(`${p} blocker: ${b.id} blocked, owner ${b.assignee || 'nobody'}: ${one(b.text)}`);
      else if (b.kind === 'owner-step') L.push(`${p} owner step: ${b.id} ${one(b.text)}`);
      else L.push(`${p} owner question: ${b.id} ${one(b.text)}`);
    }
  } else notShown('blockers and owner questions', 'team.json');
  return L;
}

// { code, out } for argv; deps go to lib/product-view.js (cwd and the project finder are injectable too)
function main(argv, { cwd = process.cwd(), findRoot, ...deps } = {}) {
  let a;
  try { a = parse(argv); } catch (err) { return { code: 2, out: `products.js: ${err.message}\n${USAGE}` }; }
  const here = (findRoot || require('./lib/manifest.js').findProjectRoot)(cwd);
  const roots = [...(here ? [here] : []), ...a.projects.map((r) => path.resolve(cwd, r))];
  if (!roots.length) return { code: 2, out: `products.js: no project here; pass --project <root>\n${USAGE}` };
  const views = PV.readProducts(roots, deps);
  const missing = views.some((v) => v.unavailable.length > 0);
  if (a.json) return { code: missing ? 1 : 0, out: JSON.stringify(views, null, 2) };
  const lines = [`products: ${views.length}: ${views.map((v) => v.product).join(', ')}`];
  for (const v of views) lines.push(...render(v));
  if (missing) lines.push(`INCOMPLETE: ${views.filter((v) => v.unavailable.length).map((v) => `${v.product} (${v.unavailable.map((u) => u.source).join(', ')})`).join('; ')} could not be read; the picture above is partial`);
  return { code: missing ? 1 : 0, out: lines.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `products.js: ${err.message}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, render, parse };
