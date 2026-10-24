// scripts/lib/experts.js — a product's own experts, installed into each role session.
//
// Staffing hires experts on evidence and writes them to the project repo's
// .delivery/team/experts/<name>.md (its lane). Each is a Claude Code subagent definition: frontmatter
// with `name` (the file's own name) and `description`, optionally `components`. The project repo is
// the private one, which is why experts live there and not in the product repo: they encode hosts,
// lanes, data stores and security rules.
//
// prepare-role copies them into <roleDir>/.claude/agents/, where a session loads project subagents.
// A copy, not a link: the session runs from its role directory, and a re-prepare picks up changes.
// What this module installed is listed in a sidecar so that an expert removed from the project
// (retired) is removed from the role too, and an agent the user wrote is never touched.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter } = require('./compose-brief.js');

const EXPERTS_REL = path.join('.delivery', 'team', 'experts');
const SIDECAR = '.delivery-managed-agents.json';
// "a handful": more is allowed, but it is said, since each expert costs every session context
const HANDFUL = 5;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The experts a project defines, each checked; a bad one is reported, never silently skipped.
function readExperts(projectRoot) {
  const dir = path.join(projectRoot, EXPERTS_REL);
  if (!fs.existsSync(dir)) return { experts: [], warnings: [] };
  const experts = [];
  const warnings = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const { meta } = parseFrontmatter(text);
    const base = file.slice(0, -3);
    const where = `${path.join(EXPERTS_REL, file)}`;
    if (!meta.name) { warnings.push(`expert ${where} not installed: its frontmatter has no name`); continue; }
    if (meta.name !== base) { warnings.push(`expert ${where} not installed: its name "${meta.name}" is not its file name "${base}"`); continue; }
    if (!NAME.test(base)) { warnings.push(`expert ${where} not installed: the name must be lowercase letters, digits and hyphens`); continue; }
    if (!meta.description) { warnings.push(`expert ${where} not installed: its frontmatter has no description, so no session would know when to call it`); continue; }
    experts.push({ name: base, file, text, sha256: sha256(text) });
  }
  if (experts.length > HANDFUL) warnings.push(`${experts.length} experts in ${EXPERTS_REL}: more than a handful (${HANDFUL}); every role session loads each one`);
  return { experts, warnings };
}

// Install the project's experts into one role directory. Returns { installed, removed, warnings }.
function installExperts({ projectRoot, roleDir }) {
  const { experts, warnings } = readExperts(projectRoot);
  const agentsDir = path.join(roleDir, '.claude', 'agents');
  const sidecarFile = path.join(roleDir, '.claude', SIDECAR);
  let owned = {};
  try { owned = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')).agents || {}; } catch (err) { owned = {}; }

  const installed = [];
  const removed = [];
  const nowOwned = {};
  for (const e of experts) {
    const target = path.join(agentsDir, `${e.name}.md`);
    const ours = Object.prototype.hasOwnProperty.call(owned, e.name);
    if (fs.existsSync(target) && !ours) {
      warnings.push(`expert ${e.name} not installed: ${target} exists and was not written by the plugin; rename one of them`);
      continue;
    }
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(target, e.text);
    nowOwned[e.name] = { sha256: e.sha256, source: path.join(EXPERTS_REL, e.file) };
    installed.push(target);
  }
  // retired: installed earlier, no longer defined by the project
  for (const name of Object.keys(owned)) {
    if (nowOwned[name]) continue;
    const target = path.join(agentsDir, `${name}.md`);
    if (fs.existsSync(target)) { fs.rmSync(target); removed.push(target); }
  }
  if (Object.keys(nowOwned).length || Object.keys(owned).length) {
    fs.mkdirSync(path.dirname(sidecarFile), { recursive: true });
    fs.writeFileSync(sidecarFile, `${JSON.stringify({ agents: nowOwned }, null, 2)}\n`);
  }
  return { installed, removed, warnings };
}

module.exports = { readExperts, installExperts, EXPERTS_REL, HANDFUL };
