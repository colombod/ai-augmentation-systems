// hooks/scripts/bd-guard.js — the record stays honest: evidence on close, no claim-jumping,
// structure only by the Delivery Manager.
// A discipline aid, not a security boundary: a segment it cannot parse is allowed.
const { splitCommand, tokens, splitBdGlobals } = require('./lane.js');

const TWO_WORD = new Set(['dep', 'label', 'comments', 'comment', 'dolt', 'epic', 'swarm']);
// Flags that never take a value, so the token after them is an id, not their argument.
const BOOLEAN_FLAGS = new Set(['--claim', '--json', '--all', '--force', '--silent', '--quiet', '--verbose']);
const CREATE = new Set(['create', 'new', 'q', 'create-form']);
// Verbs that restructure or rename the record whatever their arguments (`link` is shorthand for
// `dep add`; `mol` pours and bonds molecules). Only the Delivery Manager runs them.
const STRUCTURE_VERBS = new Set(['link', 'rename', 'rename-prefix', 'set-state', 'duplicate', 'supersede', 'todo', 'import']);
// Only these roles may bring a closed bead back: the Delivery Manager, and the observer who found it unproven.
const REOPENERS = new Set(['delivery-lead', 'progress-observer']);
// Verbs that close a bead on the way: they answer to the same evidence and live-claim rules as `close`.
const CLOSING = new Set(['close', 'duplicate', 'supersede']);
// `epic` and `swarm` read through these; any other form writes (close-eligible, create, ...).
const GROUP_READ = { epic: new Set(['status']), swarm: new Set(['status', 'validate', 'list']) };
const DEP_READ = new Set(['list', 'tree', 'cycles']);
const LABEL_WRITE = new Set(['add', 'remove', 'propagate']);
const LABEL_FLAGS = ['--add-label', '--remove-label', '--set-labels'];
const CLAIM_FLAGS = ['--claim', '--assignee', '--status', '-a', '-s'];
const STRUCTURE = 'structure belongs to the Delivery Manager; create a child bead under the bead you hold (`bd create --parent <id>`) or message the Delivery Manager.';

function parseBd(segment) {
  const t = tokens(segment);
  // `VAR=x bd ...` and `env bd ...` leave t[0] != 'bd': unparseable, so allowed.
  if (t[0] !== 'bd') return null;
  const { rest } = splitBdGlobals(t);
  if (!rest[0]) return null;
  let sub = rest[0];
  let i = 1;
  if (TWO_WORD.has(rest[0]) && rest[1]) { sub = `${rest[0]} ${rest[1]}`; i = 2; }
  const ids = [];
  const flags = new Map();
  for (; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.length > 1 && tok.startsWith('-')) {
      const eq = tok.indexOf('=');
      if (eq > 0) { flags.set(tok.slice(0, eq), tok.slice(eq + 1)); continue; }
      const next = rest[i + 1];
      if (!BOOLEAN_FLAGS.has(tok) && next !== undefined && !(next.length > 1 && next.startsWith('-'))) { flags.set(tok, next); i++; } else flags.set(tok, true);
    } else ids.push(tok);
  }
  return { sub, id: ids.length ? ids[0] : null, ids, flags };
}

function hoursBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / 3600000; }

function lookup(bd, id) { try { return bd.show(id); } catch (err) { return null; } }

// A bead held by another actor whose last change is younger than the staleness window.
function liveOther(bead, actor, staleHours, now) {
  if (!bead || bead.status !== 'in_progress' || !bead.assignee || bead.assignee === actor) return null;
  const age = hoursBetween(bead.updated_at || '1970-01-01T00:00:00Z', now || new Date().toISOString());
  return age < staleHours ? age : null;
}

// Whether any of these beads exists and is held by someone else. A failed lookup stays fail-open.
function heldByOther(ids, actor, bd) {
  return ids.some((id) => {
    let bead;
    try { bead = bd.show(id); } catch (err) { return false; }
    return Boolean(bead) && bead.assignee !== actor;
  });
}

function structural(p, actor, bd) {
  const [head, second] = p.sub.split(' ');
  if (CREATE.has(p.sub)) return !p.flags.has('--parent');
  if (p.sub === 'delete') return true;
  // `duplicates` lists; merging what it finds closes beads.
  if (p.sub === 'duplicates') return p.ids.includes('merge') || [...p.flags.keys()].some((f) => /^--(auto-)?merge/.test(f));
  // `tag <id> <label>` is `label add`: the second positional is the label, not a bead.
  if (p.sub === 'tag') return p.ids.length > 0 && heldByOther(p.ids.slice(0, 1), actor, bd);
  if (STRUCTURE_VERBS.has(p.sub)) return true;
  if (p.sub === 'mol' || head === 'mol') return second !== undefined || p.ids.length > 0;
  if (GROUP_READ[head] && second !== undefined) return !second.startsWith('-') && !GROUP_READ[head].has(second);
  if (head === 'dep' && second !== undefined) return !DEP_READ.has(second);
  if (head === 'label' && LABEL_WRITE.has(second)) return true;
  if (p.sub === 'update') {
    if (p.flags.has('--parent')) return true;
    if (LABEL_FLAGS.some((f) => p.flags.has(f))) {
      // Labels change only on beads the actor holds, every id given. A lookup that fails stays fail-open.
      return heldByOther(p.ids, actor, bd);
    }
  }
  return false;
}

// A write of a state label or a gate field, which only the gate scripts set.
const GATE_FIELDS = /\b(ready_hash|ready_at|deployed_sha|deployed_at|merged_pr)\b/;
function gateFieldWrite(p) {
  const labels = [...LABEL_FLAGS.map((f) => p.flags.get(f)), ...(['label add', 'label remove', 'tag'].includes(p.sub) ? p.ids.slice(1) : [])];
  if (labels.some((v) => typeof v === 'string' && /(^|,)\s*state-/.test(v))) return true;
  return p.sub === 'update' && ['--metadata', '--set-metadata', '--unset-metadata'].some((f) => typeof p.flags.get(f) === 'string' && GATE_FIELDS.test(p.flags.get(f)));
}

function decideBd({ command, actor, roleId, staleHours, bd, now }) {
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    if (roleId !== 'delivery-lead' && structural(p, actor, bd)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: ${STRUCTURE}` };
    }
    if (roleId !== 'delivery-lead' && gateFieldWrite(p)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: the states (state-merged, state-deployed, state-verified) and the gate fields (ready_hash, deployed_sha) are set by ready.js and evidence.js, run by the Delivery Manager. Message the Delivery Manager.` };
    }
    if (CLOSING.has(p.sub)) {
      for (const id of p.ids) {
        const bead = lookup(bd, id);
        const age = liveOther(bead, actor, staleHours, now);
        if (age !== null) {
          return { reason: `Bead ${id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago): a live claim cannot be released by someone else. Ask the holder or the Delivery Manager, or wait for staleness (${staleHours}h).` };
        }
      }
    }
    if (p.sub === 'reopen' && !REOPENERS.has(roleId)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: reopening a closed bead is the Delivery Manager's or Progress Observer's call; message them with the evidence that it is not done.` };
    }
    // `assign <id> <who>` is a claim change: the second positional is a person, not a bead.
    const assigning = p.sub === 'assign' && p.ids.length > 0;
    if (assigning || (p.sub === 'update' && p.ids.length && CLAIM_FLAGS.some((f) => p.flags.has(f)))) {
      for (const id of assigning ? p.ids.slice(0, 1) : p.ids) {
        const bead = lookup(bd, id);
        const age = liveOther(bead, actor, staleHours, now);
        if (age !== null) {
          return { reason: `Bead ${id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago). A claim is the only authority: do not take or release it. Ask the Delivery Manager, or wait for staleness (${staleHours}h).` };
        }
      }
    }
  }
  return null;
}

// The manifest's staleness window; a configured 0 stays 0 (no claim is ever live).
function staleHoursOf(team) {
  const v = team && team.budget ? team.budget.staleness_hours : undefined;
  return v ?? 2;
}

// ---- the ready and done gates (R-10, R-11, R-12) ----
// Async because the typed judge may be asked (advisory, warn-only). Returns { deny, warnings }:
// deny only on a divergence (D1, D2, D3, D5); every other finding is a warning the hook records.
// Any read that fails leaves the command allowed (fail open), like the rest of this guard.
const CLAIMING = (p) => p.sub === 'update' && p.ids.length > 0 && (p.flags.has('--claim') || p.flags.get('--status') === 'in_progress' || p.flags.get('-s') === 'in_progress');

function describeFinding(f) { return `${f.rule}: ${f.detail}`; }

async function gateChecks({ command, roleId, bd, root, team, ask }) {
  const G = require('../../scripts/lib/gates.js');
  const { gateInputs, maxUnverified } = require('../../scripts/lib/gate-context.js');
  const out = { deny: null, warnings: [] };
  if (!root) return out;
  const add = (bead, f) => out.warnings.push({ kind: f.code, rule: f.rule, bead, detail: f.detail });
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    const claiming = CLAIMING(p);
    if (!claiming && p.sub !== 'close') continue;
    for (const id of p.ids) {
      const bead = lookup(bd, id);
      if (!bead) continue;
      const isStory = (bead.labels || []).includes('story');
      let inp;
      try { inp = gateInputs(root, bead, { bd, team }); } catch (err) { continue; }
      if (claiming) {
        const findings = [];
        if (isStory && inp.story) {
          let judged = null;
          if (ask) { try { judged = await ask('shippable_unit', G.shippableState(inp.story, inp.surface)); } catch (err) { judged = null; } }
          findings.push(...G.readyFindings({ story: inp.story, surfaces: inp.surfaces, surfaceMissing: inp.surfaceMissing, bead, judged }));
        }
        let overCap = null;
        if (isStory) { try { overCap = G.unverifiedOver(bd.list({ label: 'story' }), bead, maxUnverified(team)); } catch (err) { overCap = null; } }
        findings.push(...G.claimDivergence({ story: isStory ? inp.story : null, bead, parent: inp.parent, parentStory: inp.parentStory, overCap }));
        const blocks = findings.filter((f) => f.level === 'block');
        for (const f of findings.filter((x) => x.level === 'warn')) add(id, f);
        if (blocks.length) {
          out.deny = `Claim of ${id} refused: it opens a divergence from what was agreed. ${blocks.map(describeFinding).join(' ')} The Delivery Manager resolves it (an owner record, a fixed story, or verifying the area first).`;
          return out;
        }
        continue;
      }
      // close
      const reason = p.flags.get('--reason') || p.flags.get('-r');
      if (!isStory || !inp.story || !inp.story.criteria.length) {
        if (isStory) add(id, { code: 'close-no-criteria', rule: 'R-11', detail: 'closed with no acceptance criteria to check: the done gate could not run (migration path)' });
        else if (typeof reason !== 'string' || !reason.trim()) add(id, { code: 'close-no-reason', rule: 'R-11', detail: 'closed with no --reason: say what it answered or shipped and where the proof is' });
        continue;
      }
      const done = G.doneCheck({ story: inp.story, bead, rows: inp.rows, surface: inp.surface, instances: inp.instances });
      if (!done.ok) {
        const missing = done.criteria.filter((c) => !c.row && !c.waiver).map((c) => `criterion ${c.n}: ${c.why}`).join('; ');
        out.deny = `Close of ${id} refused (D3): every agreed criterion needs a pass row on ${inp.surface ? inp.surface.id : 'the declared surface'}, on the deployed sha, recorded by a role other than the author. Missing: ${missing}. The Delivery Manager (or the reality check) records rows with evidence.js add ${id} --criterion <n> --result pass --surface <id> --sha <deployed sha>.`;
        return out;
      }
      if (ask && typeof reason === 'string' && reason.trim()) {
        let j = null;
        try { j = await ask('divergence', { agreed_criteria: inp.story.criteria.map((c) => `${c.n}. ${c.text}`).join('\n'), customer_surface: inp.surface ? `${inp.surface.app}, ${inp.surface.mode}` : 'not declared', change_summary: reason }); } catch (err) { j = null; }
        if (j && j.answer === 'serious') add(id, { code: 'divergence-judge', rule: 'D1-D5', detail: `the typed judge rates this change a serious divergence (confidence ${Number(j.confidence).toFixed(2)}); warn-only until re-measured` });
      }
    }
  }
  return out;
}

module.exports = { parseBd, decideBd, staleHoursOf, gateChecks };
