#!/usr/bin/env node
// scripts/stories.js — the only way a story file changes (lib/stories.js); every lane refuses a hand
// write of a story file. The generated index is retired (ADR-004), so there is no index command.
//   stories.js new --from <draft> [--file <name>.md]   create a story from a whole draft (written to a
//       temporary file first); nothing is written unless every field passes
//   stories.js set <story> <field> <value>             one frontmatter field
//   stories.js criterion <story> <n> --text '<criterion>' --probe '<what>; where: <surface>; by: test|reality-check'
//       replace criterion n, or add the next one; the others stay byte for byte
//   stories.js section <story> --heading '<heading>' (--body '<text>' | --body-file <f>) [--new]
//       rewrite a section by heading (an existing heading, or a template one); --new adds a free-text section
// <story> is a file name in the stories folder, or a story id. A change takes effect in the plan when
// plan-sync.js apply publishes it. A refusal names the field and leaves the file unchanged. Exit codes:
// 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const S = require('./lib/stories.js');
const G = require('./lib/gates.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = "usage: stories.js new --from <draft> [--file <name>.md] | set <story> <field> <value> | criterion <story> <n> --text '<text>' --probe '<probe>' | section <story> --heading '<heading>' (--body '<text>' | --body-file <f>) [--new]";
const VALUE = ['--from', '--file', '--text', '--probe', '--heading', '--body', '--body-file', '--project'];
// the Delivery Manager writes stories; a session with no role (the plugin used outside a team) may too
const WRITERS = ['delivery-lead'];

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--new') out.new = true;
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const refuse = (field, why, way) => ({ code: 1, out: `stories.js: ${field}: ${why}\n${way || 'Nothing was written; correct it and run the command again.'}` });

// a file name in the stories folder (with or without .md), else the story whose frontmatter id it is
function storyFile(root, name) {
  const dir = S.dirOf(root);
  const n = path.basename(String(name || ''));
  if (n && n !== 'README.md' && fs.existsSync(path.join(dir, n.endsWith('.md') ? n : `${n}.md`))) return n.endsWith('.md') ? n : `${n}.md`;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md'); } catch (err) { files = []; }
  const idOf = (f) => String(G.parseStory(fs.readFileSync(path.join(dir, f), 'utf8')).meta.id || '').replace(/\s+#.*$/, '');
  return files.find((f) => idOf(f) === String(name)) || null;
}

const done = (r, what) => (r.field ? refuse(r.field, r.why) : { code: 0, out: `${what}; wrote ${r.written.join(', ')}` });

function main(argv, { cwd = process.cwd(), env = process.env, who: given } = {}) {
  const a = parse(argv);
  const [cmd, name, ...rest] = a._;
  if (!cmd) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'stories.js: no project found; pass --project <root>' };
  if (who.roleId && !WRITERS.includes(who.roleId)) return refuse('role', `stories are the Delivery Manager's to change (this session is ${who.roleId}).`, 'Message the Delivery Manager with the change.');
  const root = who.root;
  if (cmd === 'new') {
    if (!a.from || name) return { code: 2, out: USAGE };
    let text;
    try { text = fs.readFileSync(path.resolve(cwd, a.from), 'utf8'); } catch (err) { return refuse('from', `no draft at ${a.from}`); }
    const bad = S.checkDraft(text);
    if (bad) return refuse(bad.field, bad.why, 'No story file was written; correct the draft and run `stories.js new --from` again.');
    const id = G.parseStory(text).meta.id;
    const file = a.file || `${id}.md`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(file) || file === 'README.md') return refuse('file', `"${file}" is not a story file name (letters, digits, dots and dashes, ending .md)`);
    if (storyFile(root, id)) return refuse('id', `a story with id ${id} already exists`, `Change it with \`stories.js set ${id} ...\` instead.`);
    return done(S.change(root, file, () => ({ text }), { create: true }), `${file} created (${id})`);
  }
  if (!['set', 'criterion', 'section'].includes(cmd) || !name) return { code: 2, out: USAGE };
  const file = storyFile(root, name);
  if (!file) return refuse('story', `no story ${name}`, 'List the stories by reading the stories folder.');
  if (cmd === 'set') {
    if (rest.length !== 2) return { code: 2, out: USAGE };
    const [key, value] = rest;
    return done(S.change(root, file, (t) => S.setField(t, key, value)), `${file}: ${key} is ${value}`);
  }
  if (cmd === 'criterion') {
    const n = Number(rest[0]);
    if (rest.length !== 1 || a.text === undefined) return { code: 2, out: USAGE };
    return done(S.change(root, file, (t) => S.setCriterion(t, n, a.text, a.probe)), `${file}: criterion ${n} written`);
  }
  if (a.heading === undefined || (a.body === undefined) === (a['body-file'] === undefined) || rest.length) return { code: 2, out: USAGE };
  let body = a.body;
  if (body === undefined) { try { body = fs.readFileSync(path.resolve(cwd, a['body-file']), 'utf8'); } catch (err) { return refuse('body-file', `no file at ${a['body-file']}`); } }
  return done(S.change(root, file, (t) => S.setSection(t, a.heading, body, { allowNew: a.new === true })), `${file}: section ${a.heading} written`);
}

module.exports = { main, storyFile };

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: err.message && /held by another writer/.test(err.message) ? 1 : 2, out: `stories.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}
