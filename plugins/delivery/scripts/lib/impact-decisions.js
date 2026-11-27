// scripts/lib/impact-decisions.js — a story's "## Impact decisions" table against what it reaches.
// Every existing feature a story reaches needs one recorded decision, so a change to existing
// behaviour is decided (guard it, decommission it, or accept it) before work starts, not found later
// as a regression or as dead code. Pure functions; the gate proves a decision exists and its evidence
// resolves, never that the decision is wise.
const fs = require('fs');
const path = require('path');

const DECISIONS = ['guard', 'decommission', 'accept'];
const RELATIONS = ['extends', 'conflicts', 'duplicates', 'supersedes', 'none'];
// the share of live features at which an impact is large (the owner's number)
const LARGE = 0.5;

// reach.live: { reached: [ids], total, counted, uncounted: [paths] }, the declared features a story
// affects out of those shipped. A share is never guessed: with unplaced files it is a lower bound,
// and with none placed it is not known.
function share(reach) {
  if (!reach || reach.error || !reach.live) return { line: '', findings: [] };
  const { reached, total, counted, uncounted = [] } = reach.live;
  if (!total) return { line: 'Impact: no live feature found (.delivery/features.json is missing, unreadable, or declares no code here), so no share', findings: [] };
  const left = uncounted.length ? ` (not counted: ${uncounted.join(', ')})` : '';
  if (uncounted.length && !counted) return { line: `Impact: share not known${left}`, findings: [] };
  const said = `${uncounted.length ? 'at least ' : ''}${reached.length}/${total} live features affected${reached.length ? `: ${reached.join(', ')}` : ''}${left}`;
  const large = reached.length / total >= LARGE;
  return { line: `Impact: ${said}`, findings: large ? [{ level: 'warn', rule: 'R-35', code: 'impact-large', detail: `${said}. That is ${LARGE * 100}% or more: the owner decides whether to take on all that work or prune first` }] : [] };
}

// rows of the table under "## Impact decisions": | feature(s) | decision | relation | evidence |
// `known` holds the reached feature ids: a declared id may contain spaces, so a known id is read
// whole before a cell is split on spaces.
function parseTable(text, known = []) {
  const m = /^##\s+Impact decisions\s*$/im.exec(String(text || ''));
  if (!m) return null;
  const rest = String(text).slice(m.index + m[0].length).split(/^##\s/m)[0];
  const rows = [];
  for (const line of rest.split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    // the header is the row naming the decision column, so a feature id may start with "feature"
    if (cells.length < 4 || /^:?-+:?$/.test(cells[0]) || /^`?decision`?$/i.test(cells[1])) continue;
    const ids = cells[0].split(',').flatMap((part) => {
      const whole = part.replace(/`/g, '').trim();
      if (known.includes(whole) || /^\s*`[^`]+`\s*$/.test(part)) return [whole];
      return whole.split(/\s+/);
    }).filter(Boolean);
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

// What a pull request reaches that its stories never decided, as one warning line, or null. reach:
// what its changed files reach at its head; texts: its stories. A widened impact is told, not refused.
function widened({ pr, reach, texts }) {
  if (reach.error) return `impact of PR ${pr} not checked: ${reach.error}`;
  // both: what the files reach, and the live features that only claim a new file by their anchors
  const reached = [...new Set([...reach.features.map((x) => x.id), ...reach.live.reached])];
  const listed = new Set(texts.flatMap((t) => (parseTable(t, reached) || []).flatMap((r) => r.ids)));
  const added = reached.filter((id) => !listed.has(id));
  const { reached: live, total, uncounted = [] } = reach.live;
  const left = uncounted.length ? ` Not counted: ${uncounted.join(', ')}.` : '';
  if (!added.length) return left ? `impact of PR ${pr} only partly checked.${left}` : null;
  const share = total ? ` Live features affected: ${uncounted.length ? 'at least ' : ''}${live.length}/${total}; its stories list ${live.filter((id) => listed.has(id)).length} of those.` : '';
  const large = total && live.length / total >= LARGE ? ` That is ${LARGE * 100}% or more: the owner decides before this merge.` : '';
  return `PR ${pr} reaches ${added.length} feature${added.length === 1 ? '' : 's'} its stories do not list: ${added.join(', ')}.${share}${large} Tell the owner, and decide each in the story.${left}`;
}

// reach: { features: [{ id, hops }] } or { error }. Findings: [{ level, rule, code, detail }]
function check({ text, reach, root, ownerRecord }) {
  const f = (level, code, detail) => ({ level, rule: 'R-35', code, detail });
  const reached = reach && !reach.error ? reach.features : [];
  const rows = parseTable(text, reached.map((x) => x.id));
  if (!rows) {
    // a story known to reach features is not ready until each is decided; with no computed reach
    // there is nothing to name, so it stays a warning
    if (reach && !reach.error && !reached.length) return [];
    if (!reached.length) return [f('warn', 'impact-undecided', 'no "## Impact decisions" table and the reach is not known: what this story does to existing features is undecided')];
    return [f('block', 'impact-undecided', `no "## Impact decisions" table: ${reached.map((x) => x.id).join(', ')} ${reached.length === 1 ? 'is' : 'are'} reached and undecided`)];
  }
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

module.exports = { parseTable, check, share, widened, DECISIONS, RELATIONS, LARGE };
