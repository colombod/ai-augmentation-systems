#!/usr/bin/env node
// scripts/plan.js — what the team can still finish, and what to start next (R-34, R-41, R-31).
//   plan.js budget [--json]            remaining against needed: the owner-set budget, spend so far,
//                                      in-flight work, and each area's current wave with its reserve
//   plan.js select [--record] [--json] ranks ready work: linked fixes and security fixes first, then
//                                      compounding work by score, then new areas; the budget decides
//                                      what may start now. --record (the Delivery Manager) writes the
//                                      score and reasons on the chosen bead and the warnings in the ledger
//   plan.js today [--json]             the Chief of Staff's ranked plan for the day, from the record only:
//                                      owner steps due, stops, blocking unknowns, the current wave's next
//                                      stories (select), pull requests waiting, reality checks pending; each
//                                      item names its role and its one action. Appends the dated plan record
//   plan.js brief                      the owner's briefing in plain words: outcome first, no ids, at most
//                                      briefing_lines, ending "Ask for details on any item"
//   plan.js routed [--json]            today's items not yet sent to their role, and any sent to the wrong one
// With the typed judge on, builds_on_verified and is_fix are asked as advisory input.
// Exit codes: 0 ok; 1 refused; 2 usage.
const W = require('./lib/waves.js');
const B = require('./lib/budget.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');

const USAGE = 'usage: plan.js budget [--json] | plan.js select [--record] [--json] | plan.js today [--json] | plan.js brief [--limit <lines>] | plan.js routed [--json]';
const n1 = B.n1;

function budgetLines(st, A, team) {
  const t = st.table;
  const lines = [];
  if (st.set) {
    lines.push(`Budget: ${B.units(st.remaining)} of ${n1(st.total)} left (${n1(st.weeklyPct)}% of the week used; counted from ${st.source}); work already started holds ${n1(st.inflightNeed)}, so ${B.units(st.free)} free. Level: ${st.level}${st.leanAt !== null ? `; lean at ${st.leanAt}% of the week` : ''}.`);
    if (st.partial) lines.push('The spend figure is partial: the transcript scan ran out of time and finishes on the next check.');
    if (st.nearLimit) lines.push('Near the limit: finish what is in flight; only linked fixes that fit start.');
    else if (st.lean) lines.push('Lean mode: one story at a time team-wide, no new builders, finish the current wave.');
  } else lines.push('Budget: not set by the owner, so budget checks only warn (the Chief of Staff asks: goal.js ask budget.weekly_units <n>).');
  lines.push(`Estimates: S ${t.units.S}, M ${t.units.M}, L ${t.units.L} units on sonnet (opus x1.7, haiku x0.35), reserve ${Math.round(t.reserve * 100)}%${t.overridden.length ? ` (owner-set: ${t.overridden.join(', ')})` : ' (seed values)'}.`);
  for (const x of A.values()) {
    if (!x.current) continue;
    const stories = x.waves.get(x.current);
    const need = stories.reduce((m, b) => m + (B.inFlight(b) ? B.stillNeeds(b, B.estimate(b, { t, team }), t) : B.estimate(b, { t, team }).units * (1 + t.reserve) * (W.finished(b) ? 0 : 1)), 0);
    // what other areas' work in flight already holds is not available to this wave (Copilot 660)
    const own = stories.filter(B.inFlight).reduce((m, b) => m + B.stillNeeds(b, B.estimate(b, { t, team }), t), 0);
    const available = st.set ? st.remaining - (st.inflightNeed - own) : 0;
    const fit = !st.set ? '' : need <= available ? ': fits' : `: does not fit (short by ${n1(need - Math.max(0, available))})`;
    lines.push(`- ${W.waveLine(x)}; still needs ${n1(need)} units with the reserve${fit}`);
  }
  return lines;
}

async function main(argv, { cwd = process.cwd(), env = process.env, who: given, bd: givenBd, now, budget, budgetOpts, ask, gh, ci, pending } = {}) {
  const args = argv.filter((a) => !['--json', '--record'].includes(a));
  const json = argv.includes('--json');
  const recordIt = argv.includes('--record');
  const pi = args.indexOf('--project');
  const project = pi >= 0 ? args.splice(pi, 2)[1] : undefined;
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Number(args.splice(li, 2)[1]) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return { code: 2, out: `plan.js: --limit needs a whole number of lines\n${USAGE}` };
  const [cmd] = args;
  const who = given || whoAmI({ cwd, env, project });
  if (!who.root) return { code: 2, out: 'plan.js: no project found; pass --project <root>' };
  // the day's plan is the Chief of Staff's own project's: never another one named on the command line
  if (cmd === 'today' && project !== undefined && require('path').resolve(project) !== require('path').resolve(who.root)) return { code: 1, out: 'plan.js: the plan is for your own project.\nRun it there: `plan.js today`' };
  if (['today', 'brief', 'routed'].includes(cmd)) return daily(cmd, who, { bd: givenBd, now, budget, budgetOpts, gh, ci, json, limit, pending });
  if (!['budget', 'select'].includes(cmd)) return { code: 2, out: USAGE };
  if (recordIt) { const p = writerProblem(who); if (p) return { code: 1, out: `plan.js: ${p}` }; }
  const bd = givenBd || require('./lib/bd.js').makeBd({ cwd: who.root });
  let stories;
  try { stories = bd.list({ label: 'story', all: true }); } catch (err) { return { code: 1, out: `plan.js: bd could not be read (${String(err.message).split('\n')[0]}).\nCheck: \`bd where\`` }; }
  const ctx = W.contextFor(who.root, { bd, team: who.team, beads: stories, budget, now, budgetOpts });
  const st = ctx.budget;
  const A = W.areas(stories);

  if (cmd === 'budget') {
    if (json) return { code: 0, out: JSON.stringify({ ...st, waves: [...A.values()].filter((x) => x.current).map((x) => ({ area: x.area, wave: x.current, line: W.waveLine(x) })) }, null, 2) };
    return { code: 0, out: budgetLines(st, A, who.team).join('\n') };
  }

  // select
  const { ranked, byId } = W.selectRanked(bd, stories, ctx);
  // the typed judge, advisory: is_fix on labelled fixes, builds_on_verified on the top three
  const J = require('./lib/judge.js');
  const cfg = J.judgeConfig(who.team, env);
  const asker = ask || (cfg.enabled ? (q, state) => J.ask(q, state, { config: cfg, env, projectRoot: who.root, gate: 'plan.js' }) : null);
  if (asker) {
    const verified = stories.filter((b) => (b.labels || []).includes('state-verified')).slice(0, 20).map((b) => `${b.id}: ${b.title}`).join('\n') || 'none';
    for (const r of ranked.filter((x) => !x.refused).slice(0, 3)) {
      const b = byId.get(r.id);
      const fix = ctx.fixOf(b);
      try {
        const j = await asker('builds_on_verified', { candidate: `${b.id}: ${b.title}`, labels: (b.labels || []).join(', '), linked_item: fix.link || 'none', context: r.reasons.join('; ') || 'none', verified_work: verified });
        if (j && j.answer) { r.judge = { builds_on_verified: j.answer, confidence: j.confidence ?? null }; r.reasons.push(`judge: ${j.answer} (advisory)`); }
      } catch (err) { /* advisory */ }
    }
    for (const r of ranked.filter((x) => { const b = byId.get(x.id); return W.FIX_LABELS.some((l) => (b.labels || []).includes(l)); })) {
      const b = byId.get(r.id);
      const fix = ctx.fixOf(b);
      try {
        const j = await asker('is_fix', { candidate: `${b.id}: ${b.title}`, linked_item: fix.link || 'none', context: r.reasons.join('; ') || 'none' });
        if (j && typeof j.p === 'number') {
          r.judge = { ...(r.judge || {}), is_fix: j.p };
          if (j.p < 0.5) r.warnings.push(`the typed judge reads this as not a fix (p ${j.p.toFixed(2)}, advisory)`);
        }
      } catch (err) { /* advisory */ }
    }
  }
  const chosen = ranked.find((r) => !r.refused) || null;
  let recorded = null;
  if (recordIt) {
    const Wn = require('./lib/warnings.js');
    for (const r of ranked) for (const w of r.warnings) Wn.record(who.root, { kind: 'selection', rule: 'R-41', bead: r.id, detail: w, raisedBy: who.instance, instance: who.instance, now });
    if (chosen) {
      const b = byId.get(chosen.id);
      const selection = { tier: chosen.tier, score: chosen.score, reasons: chosen.reasons, ...(chosen.judge ? { judge: chosen.judge } : {}), budget: st.set ? st.level : 'not set', at: now || new Date().toISOString(), by: who.instance || null };
      try { bd.update(chosen.id, { metadata: { ...(b.metadata || {}), selection } }); recorded = chosen.id; } catch (err) { return { code: 1, out: `plan.js: the selection was not recorded on ${chosen.id} (${String(err.message).split('\n')[0]}).\nRetry: \`plan.js select --record\`` }; }
    }
  }
  if (json) return { code: 0, out: JSON.stringify({ budget: st.set ? { level: st.level, remaining: st.remaining, free: st.free } : null, chosen: chosen && chosen.id, recorded, ranked }, null, 2) };
  const lines = [`Selection (${st.set ? `budget ${st.level}, ${B.units(st.free)} free` : 'no owner-set budget: nothing is refused on budget'}):`];
  const tierName = { 1: 'fix', 2: 'compounding', 3: 'new area' };
  ranked.filter((r) => !r.refused).forEach((r, i) => lines.push(`${i + 1}. ${r.id} tier ${r.tier} (${tierName[r.tier]}), score ${r.score}${r.reasons.length ? `: ${r.reasons.join('; ')}` : ''}`));
  const refused = ranked.filter((r) => r.refused);
  if (refused.length) { lines.push('Not now:'); for (const r of refused) lines.push(`- ${r.id}: ${r.refused}`); }
  const warns = ranked.flatMap((r) => r.warnings.map((w) => `${r.id}: ${w}`));
  if (warns.length) { lines.push('Warnings:'); for (const w of warns) lines.push(`- ${w}`); }
  if (!ranked.length) lines.push('Nothing ready.');
  if (recorded) lines.push(`Recorded the selection on ${recorded}.`);
  return { code: 0, out: lines.join('\n') };
}

// ---- the Chief of Staff's day (lib/daily-plan.js) ----
const ROUTE_HINT = 'Send each item to its role with SendMessage, carrying its reference in [brackets]; `plan.js routed` lists what is not sent yet.';
function daily(cmd, who, { bd: givenBd, now, budget, budgetOpts, gh, ci, json, limit: asked, pending }) {
  const DP = require('./lib/daily-plan.js');
  if (cmd === 'routed') {
    const u = DP.unrouted(who.root, { now });
    if (json) return { code: 0, out: JSON.stringify(u, null, 2) };
    if (!u.plan) return { code: 0, out: 'No plan for today yet: `plan.js today`' };
    const lines = [u.open.length ? `${u.open.length} of ${u.total} items not sent yet:` : `All ${u.total} items sent to their roles.`];
    for (const it of u.open) lines.push(`- ${DP.ROLE_WORD[it.role] || it.role} (${it.instance}): ${it.action} [${it.ref}]`);
    for (const m of u.misroutes) lines.push(`Misrouted: ${m.key} went to ${m.to || 'an unknown session'}; send it to its role.`);
    return { code: 0, out: lines.join('\n') };
  }
  if (cmd === 'today' && who.roleId !== 'chief-of-staff') return { code: 1, out: 'plan.js: the Chief of Staff writes the day\'s plan.\nMessage the Chief of Staff, or read it: `plan.js routed`' };
  const bd = givenBd || require('./lib/bd.js').makeBd({ cwd: who.root });
  let f;
  // a record that cannot be read refuses the plan and the brief: no snapshot from a failed read (B2)
  try { f = DP.facts(who.root, { bd, team: who.team, now, gh, ci, budget, budgetOpts, pending }); } catch (err) {
    if (!(err instanceof DP.ReadError)) throw err;
    return { code: 1, out: `plan.js: ${err.message}.\nCheck: \`${err.hint}\`` };
  }
  if (cmd === 'brief') {
    const own = require('./lib/goal.js').value(who.root, 'briefing_lines', { warn: false }) || 12;
    return { code: 0, out: DP.brief(f, { prev: DP.previous(who.root, DP.today(now)), limit: asked ? Math.min(asked, own) : own }).join('\n') };
  }
  let row;
  try { row = DP.record(who.root, f, { by: who.instance, now }); } catch (err) { return { code: 1, out: `plan.js: the plan was not recorded (${String(err.message).split('\n')[0]}).\nRetry: \`plan.js today\`` }; }
  if (json) return { code: 0, out: JSON.stringify(row, null, 2) };
  const lines = [`Plan for ${DP.today(row.at)}: ${row.items.length} item${row.items.length === 1 ? '' : 's'}, from the record.`];
  // stalls first, and when the team resumes after a usage limit (R-04, R-43); the plan never pauses work
  const resumes = DP.resumesAt(f);
  if (resumes) lines.push(`The team resumes at ${require('./lib/watchdog.js').clock(Date.parse(resumes))}, when the usage limit resets (restart scheduled: the watchdog wakes each stopped session then).`);
  const stalls = row.items.filter((x) => x.section === 0);
  if (stalls.length) {
    lines.push('0. Stalls first:');
    for (const it of stalls) lines.push(`   - ${DP.ROLE_WORD[it.role] || it.role} (${it.instance}): ${it.action} [${it.ref}]`);
  }
  DP.SECTIONS.forEach((name, i) => {
    const its = row.items.filter((x) => x.section === i + 1);
    lines.push(`${i + 1}. ${name}: ${its.length ? '' : 'none'}`.trimEnd());
    for (const it of its) lines.push(`   - ${it.role === 'chief-of-staff' ? 'you' : `${DP.ROLE_WORD[it.role] || it.role} (${it.instance})`}: ${it.action} [${it.ref}]`);
  });
  lines.push(ROUTE_HINT);
  return { code: 0, out: lines.join('\n') };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => r, (err) => ({ code: 2, out: `plan.js: ${err.message}\n${USAGE}` })).then((r) => {
    (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
    process.exitCode = r.code;
  });
}

module.exports = { main };
