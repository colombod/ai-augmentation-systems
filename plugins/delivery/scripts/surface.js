#!/usr/bin/env node
// scripts/surface.js — check or show an initiative's customer surface (.delivery/initiatives/<slug>/surface.json).
//   surface.js check <initiative> [--project <root>]   problems exit 1; warnings are printed, exit 0
//   surface.js show <initiative> [--project <root>]    the surfaces as JSON
const { loadSurface, surfaceFile, describe } = require('./lib/surface.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: surface.js check|show <initiative> [--project <root>]';

function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const i = argv.indexOf('--project');
  const project = i >= 0 ? argv[i + 1] : undefined;
  const [cmd, slug] = argv.filter((x, k) => k !== i && k !== i + 1);
  if (!['check', 'show'].includes(cmd) || !/^[a-z0-9][a-z0-9-]*$/.test(String(slug || ''))) return { code: 2, out: USAGE };
  const who = whoAmI({ cwd, env, project });
  if (!who.root) return { code: 2, out: 'surface.js: no project found; pass --project <root>' };
  const s = loadSurface(who.root, slug);
  if (s.missing) return { code: 1, out: `surface.js: ${surfaceFile(who.root, slug)} does not exist; write it from templates/surface.json` };
  if (cmd === 'show') return { code: s.problems.length ? 1 : 0, out: JSON.stringify(s.doc, null, 2) };
  const lines = [...s.problems.map((p) => `problem: ${p}`), ...s.warnings.map((w) => `warning: ${w}`)];
  if (!s.problems.length) lines.unshift(`ok: ${s.surfaces.map(describe).join('; ')}`);
  return { code: s.problems.length ? 1 : 0, out: lines.join('\n') };
}

if (require.main === module) {
  const r = main(process.argv.slice(2));
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
