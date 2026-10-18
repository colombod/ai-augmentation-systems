#!/usr/bin/env node
// scripts/wave.js — compounding waves per product area (R-36), for the Delivery Manager.
//   wave.js show [<area>] [--json]   the current wave per area, in plain words, and its stories
//   wave.js plan [--json]            the waves per area with estimate and reserve, unwaved stories and
//                                    file overlaps inside a wave; records the plan in .delivery/waves.ndjson
//   wave.js close <area> <n>         records a finished wave: every story verified or cut (a cut is the
//                                    owner's, through evidence.js cut); refused otherwise
// Wave membership comes from each story's `wave:` frontmatter, stamped by materialise as wave-<n>.
// Exit codes: 0 ok; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const W = require('./lib/waves.js');
const B = require('./lib/budget.js');
const G = require('./lib/gates.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');

const USAGE = 'usage: wave.js show [<area>] [--json] | wave.js plan [--json] | wave.js close <area> <n>';
const ledger = (root) => path.join(root, '.delivery', 'waves.ndjson');

function readLedger(root) {
  try { return fs.readFileSync(ledger(root), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter(Boolean); } catch (err) { return []; }
}
function append(root, row) {
  fs.mkdirSync(path.dirname(ledger(root)), { recursive: true });
  fs.appendFileSync(ledger(root), `${JSON.stringify(row)}\n`);
}

const stateWord = (b) => G.stateOf(b) || (b.status === 'in_progress' ? 'in progress' : b.status);

function main(argv, { cwd = process.cwd(), env = process.env, who: given, bd: givenBd, now, budget, budgetOpts } = {}) {
  const args = argv.filter((a) => a !== '--json');
  const json = argv.includes('--json');
  const pi = args.indexOf('--project');
  const project = pi >= 0 ? args.splice(pi, 2)[1] : undefined;
  const [cmd, area, n] = args;
  const who = given || whoAmI({ cwd, env, project });
  if (!who.root) return { code: 2, out: 'wave.js: no project found; pass --project <root>' };
  const bd = givenBd || require('./lib/bd.js').makeBd({ cwd: who.root });
  let beads;
  try { beads = bd.list({ label: 'story', all: true }); } catch (err) { return { code: 1, out: `wave.js: bd could not be read (${String(err.message).split('\n')[0]}).\nCheck: \`bd where\`` }; }
  const A = W.areas(beads);
  const closed = new Set(readLedger(who.root).filter((r) => r.type === 'close').map((r) => `${r.area}#${r.wave}`));

  if (cmd === 'show') {
    const list = [...A.values()].filter((x) => x.order.length && (!area || x.area === area));
    if (json) return { code: 0, out: JSON.stringify(list.map((x) => ({ area: x.area, current: x.current, waves: x.order, line: W.waveLine(x), stories: x.current ? x.waves.get(x.current).map((b) => ({ id: b.id, state: stateWord(b) })) : [] })), null, 2) };
    if (!list.length) return { code: 0, out: area ? `${area}: no waves (stories carry wave: in their frontmatter; materialise stamps it)` : 'No waves yet: stories carry wave: <n> in their frontmatter and materialise stamps it.' };
    const lines = [];
    for (const x of list) {
      lines.push(W.waveLine(x));
      if (x.current) for (const b of x.waves.get(x.current)) lines.push(`  ${b.id} ${stateWord(b)}${b.assignee ? ` (${b.assignee})` : ''}`);
    }
    return { code: 0, out: lines.join('\n') };
  }

  if (cmd === 'plan' || cmd === 'close') {
    const problem = writerProblem(who);
    if (problem) return { code: 1, out: `wave.js: ${problem}` };
  }

  if (cmd === 'plan') {
    // fix beads in flight count as in plan.js (re-review m-a)
    const st = budget || W.contextFor(who.root, { bd, team: who.team, beads, now, budgetOpts }).budget;
    const t = st.table;
    const out = [];
    const rows = [];
    for (const x of A.values()) {
      // an area of unwaved stories only is listed too, with its warning (Copilot 670)
      if (!x.order.length && !x.unwaved.some((b) => !W.finished(b))) continue;
      const waves = x.order.map((k) => {
        const s = x.waves.get(k);
        const units = s.reduce((m, b) => m + B.stillNeeds(b, B.estimate(b, { t, team: who.team }), t), 0);
        const overlaps = [];
        for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
          const hit = W.overlap(readFiles(who.root, s[i]), readFiles(who.root, s[j]));
          if (hit.length) overlaps.push(`${s[i].id} and ${s[j].id} touch ${hit.slice(0, 3).join(', ')}`);
        }
        return { wave: k, stories: s.map((b) => b.id), needs: units, done: s.every(W.finished), closed: closed.has(`${x.area}#${k}`), overlaps };
      });
      rows.push({ area: x.area, current: x.current, waves, unwaved: x.unwaved.filter((b) => !W.finished(b)).map((b) => b.id) });
    }
    append(who.root, { type: 'plan', at: now || new Date().toISOString(), by: who.instance || null, areas: rows.map((r) => ({ area: r.area, waves: Object.fromEntries(r.waves.map((w) => [w.wave, w.stories])) })) });
    if (json) return { code: 0, out: JSON.stringify({ budget: st.set ? { remaining: st.remaining, free: st.free, level: st.level } : null, areas: rows }, null, 2) };
    if (!rows.length) return { code: 0, out: 'No waves yet: give each story wave: <n> in its frontmatter (the roadmap cuts each phase into waves), then materialise.' };
    for (const r of rows) {
      out.push(`${r.area}:`);
      for (const w of r.waves) {
        const tag = w.done ? (w.closed ? 'closed' : 'done, not closed: wave.js close') : w.wave === r.current ? 'current' : 'waits';
        out.push(`  wave ${w.wave} (${tag}): ${w.stories.length} stories, ${B.n1(w.needs)} units still needed with the reserve`);
        for (const o of w.overlaps) out.push(`    warning: ${o}; parallel builders take file-disjoint stories (R-23)`);
      }
      if (r.unwaved.length) out.push(`  warning: no wave: ${r.unwaved.join(', ')} (give each a wave: in its story file)`);
    }
    out.push(st.set ? `Budget: ${B.units(st.remaining)} left, ${B.units(st.free)} free after work already started (${st.level}).` : 'Budget: not set by the owner (budget checks only warn).');
    return { code: 0, out: out.join('\n') };
  }

  if (cmd === 'close' && area && /^\d+$/.test(String(n || ''))) {
    const x = A.get(area);
    const stories = x && x.waves.get(Number(n));
    if (!stories) return { code: 1, out: `wave.js: refused: ${area} has no wave ${n}.\nSee the waves: \`wave.js show ${area}\`` };
    const open = stories.filter((b) => !W.finished(b));
    if (open.length) return { code: 1, out: `wave.js: refused: wave ${n} of ${area} is not finished: ${open.map((b) => `${b.id} ${stateWord(b)}`).join(', ')}.\nVerify them on the customer's app, or cut one on the owner's record: \`evidence.js cut <bead> --record <dec-...> --reason '<why>'\`` };
    if (closed.has(`${area}#${n}`)) return { code: 0, out: `wave ${n} of ${area} was already closed` };
    const verified = stories.filter((b) => G.stateOf(b) === 'verified').map((b) => b.id);
    const cut = stories.filter((b) => G.stateOf(b) === 'cut').map((b) => b.id);
    append(who.root, { type: 'close', area, wave: Number(n), verified, cut, at: now || new Date().toISOString(), by: who.instance || null });
    return { code: 0, out: `wave ${n} of ${area} closed: ${verified.length} verified${cut.length ? `, ${cut.length} cut` : ''}` };
  }
  return { code: 2, out: USAGE };
}

function readFiles(root, b) {
  const s = require('./lib/gate-context.js').readStory(root, b);
  return (s && s.files) || [];
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `wave.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, readLedger };
