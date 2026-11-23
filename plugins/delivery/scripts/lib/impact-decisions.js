// scripts/lib/impact-decisions.js — a story's "## Impact decisions" table against what it reaches.
// Every existing feature a story reaches needs one recorded decision, so a change to existing
// behaviour is decided (guard it, decommission it, or accept it) before work starts, not found later
// as a regression or as dead code. Pure functions; the gate proves a decision exists and its evidence
// resolves, never that the decision is wise.
const fs = require('fs');
const path = require('path');

const DECISIONS = ['guard', 'decommission', 'accept'];
const RELATIONS = ['extends', 'conflicts', 'duplicates', 'supersedes', 'none'];

// rows of the table under "## Impact decisions": | feature(s) | decision | relation | evidence |
function parseTable(text) {
  const m = /^##\s+Impact decisions\s*$/im.exec(String(text || ''));
  if (!m) return null;
  const rest = String(text).slice(m.index + m[0].length).split(/^##\s/m)[0];
  const rows = [];
  for (const line of rest.split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 4 || /^:?-+:?$/.test(cells[0]) || /^feature/i.test(cells[0])) continue;
    const ids = cells[0].replace(/`/g, '').split(/[,\s]+/).filter(Boolean);
    rows.push({ ids, decision: cells[1].replace(/`/g, '').toLowerCase(), relation: cells[2].replace(/`/g, '').toLowerCase(), evidence: cells.slice(3).join('|').trim() });
  }
  return rows;
}

function evidenceProblem(row, { root, storyText, ownerRecord }) {
  const ev = row.evidence.replace(/`/g, '').trim();
  if (!ev) return 'no evidence';
  if (row.decision === 'accept') return /\S+:\d+/.test(ev) ? null : 'an accept needs a reason naming what was read, as file:line';
  if (row.decision === 'decommission') {
    const dec = /\bdec-[\w.-]+/.exec(ev);
    if (!dec) return 'a decommission needs the owner\'s record (dec-...)';
    const v = ownerRecord ? ownerRecord(dec[0]) : { ok: false, why: 'no verifier' };
    return v.ok ? null : v.why;
  }
  // guard: a property id, or a test path that exists or that this story names
  const ids = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'properties.json'), 'utf8')); } catch (err) { return null; } })();
  const props = ids ? (Array.isArray(ids) ? ids : ids.properties || Object.keys(ids)).map((p) => (p && p.id) || p) : [];
  if (props.includes(ev)) return null;
  const p = ev.split(/\s+/)[0];
  if (fs.existsSync(path.join(root, p)) || String(storyText).split(p).length > 2) return null;
  return `a guard needs a property id or a test path present or named by this story (${p} is neither)`;
}

// reach: { features: [{ id, hops }] } or { error }. Findings: [{ level, rule, code, detail }]
function check({ text, reach, root, ownerRecord }) {
  const f = (level, code, detail) => ({ level, rule: 'R-35', code, detail });
  const rows = parseTable(text);
  const reached = reach && !reach.error ? reach.features : [];
  if (!rows) return reach && !reach.error && !reached.length ? [] : [f('warn', 'impact-undecided', 'no "## Impact decisions" table: what this story does to the features it reaches is undecided')];
  if (reach && reach.error) return [f('block', 'impact-reach', `the reach was not computed (${reach.error}); missing evidence is never a pass`)];
  const out = [];
  const seen = new Map();
  for (const r of rows) {
    if (!DECISIONS.includes(r.decision)) out.push(f('block', 'impact-decision', `${r.ids.join(', ')}: decision "${r.decision}" is not one of ${DECISIONS.join(', ')}`));
    else if (!RELATIONS.includes(r.relation)) out.push(f('block', 'impact-relation', `${r.ids.join(', ')}: relation "${r.relation}" is not one of ${RELATIONS.join(', ')}`));
    else {
      const why = evidenceProblem(r, { root, storyText: text, ownerRecord });
      if (why) out.push(f('block', 'impact-evidence', `${r.ids.join(', ')} (${r.decision}): ${why}`));
      if (r.relation === 'conflicts' && r.decision === 'accept') out.push(f('block', 'impact-conflict-accepted', `${r.ids.join(', ')}: a known conflict is never accepted; decommission it (the owner decides) or guard it`));
    }
    if (r.ids.length > 1 && r.decision !== 'accept') out.push(f('block', 'impact-shared-row', `${r.ids.join(', ')}: only an accept row may cover several features`));
    for (const id of r.ids) seen.set(id, (seen.get(id) || 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) out.push(f('block', 'impact-duplicate', `${id} appears in ${n} rows; one decision per feature`));
  for (const x of reached) if (!seen.has(x.id)) out.push(f('block', 'impact-missing', `${x.id} (${x.hops} hop${x.hops === 1 ? '' : 's'}) is reached and has no decision`));
  for (const id of seen.keys()) if (!reached.some((x) => x.id === id)) out.push(f('warn', 'impact-unreached', `${id} has a decision but this story no longer reaches it`));
  return out;
}

module.exports = { parseTable, check, DECISIONS, RELATIONS };
