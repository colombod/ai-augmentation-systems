// hooks/scripts/bd-guard.js — the record stays honest: evidence on close, no claim-jumping,
// structure only by the Delivery Manager.
// A discipline aid, not a security boundary: a segment it cannot parse is allowed.
const { splitCommand, tokens, splitBdGlobals } = require('./lane.js');
const { isStoryBead } = require('../../scripts/lib/gates.js');

const TWO_WORD = new Set(['dep', 'label', 'comments', 'comment', 'dolt', 'epic', 'swarm', 'gate', 'vc', 'federation']);
// Flags that never take a value, so the token after them is an id, not their argument.
const BOOLEAN_FLAGS = new Set(['--claim', '--json', '--all', '--force', '--silent', '--quiet', '--verbose']);
const CREATE = new Set(['create', 'new', 'q', 'create-form']);
// Verbs that restructure or rename the record whatever their arguments (`link` is shorthand for
// `dep add`; `mol` pours and bonds molecules). Only the Delivery Manager runs them.
const STRUCTURE_VERBS = new Set(['link', 'rename', 'rename-prefix', 'set-state', 'duplicate', 'supersede', 'todo', 'import']);
// Only these roles may bring a closed bead back: the Delivery Manager, and the observer who found it unproven.
const REOPENERS = new Set(['delivery-lead', 'progress-observer']);
// Verbs that close a bead on the way: they answer to the same evidence and live-claim rules as `close`.
// `done` is bd's alias of close; `gate resolve` closes the bead it names.
const CLOSING = new Set(['close', 'done', 'duplicate', 'supersede', 'gate resolve']);
// Writes outside the guarded verbs: a batch of lines, raw SQL, and history or peer merges.
// `vc` and `federation` subcommands other than these reads rewrite history or merge peers.
const RAW_READ = { vc: new Set(['status', 'log', 'diff', 'branch', 'history']), federation: new Set(['status', 'list-peers']) };
// `epic` and `swarm` read through these; any other form writes (close-eligible, create, ...).
const GROUP_READ = { epic: new Set(['status']), swarm: new Set(['status', 'validate', 'list']) };
const DEP_READ = new Set(['list', 'tree', 'cycles']);
const LABEL_WRITE = new Set(['add', 'remove', 'propagate']);
const LABEL_FLAGS = ['--add-label', '--remove-label', '--set-labels'];
const CLAIM_FLAGS = ['--claim', '--assignee', '--status', '-a', '-s'];
const STRUCTURE = 'structure belongs to the Delivery Manager.\nCreate a child bead under the bead you hold (`bd create --parent <id>`) or message the Delivery Manager.';

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
  // every occurrence of a repeated flag (--add-label a --add-label b); flags keeps the last
  const all = new Map();
  const put = (k, v) => { flags.set(k, v); (all.get(k) || all.set(k, []).get(k)).push(v); };
  for (; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.length > 1 && tok.startsWith('-')) {
      const eq = tok.indexOf('=');
      if (eq > 0) { put(tok.slice(0, eq), tok.slice(eq + 1)); continue; }
      const next = rest[i + 1];
      if (!BOOLEAN_FLAGS.has(tok) && next !== undefined && !(next.length > 1 && next.startsWith('-'))) { put(tok, next); i++; } else put(tok, true);
    } else ids.push(tok);
  }
  return { sub, id: ids.length ? ids[0] : null, ids, flags, all };
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
  // bd batch runs close and update lines the guard cannot see; bd sql writes rows directly
  if (p.sub === 'batch') return true;
  if (p.sub === 'sql') return !/^\s*(select|show|describe|explain)\b/i.test(String(p.ids[0] || ''));
  if (RAW_READ[head] && second !== undefined) return !second.startsWith('-') && !RAW_READ[head].has(second);
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

// A write of a state label, the story label or a gate field, which only the gate scripts and
// materialise set. Metadata is judged on its parsed keys, and only literal values are accepted.
const GATE_FIELDS = new Set(['ready_hash', 'ready_at', 'ready_record', 'deployed_sha', 'deployed_at', 'deployed_version', 'evidence_head', 'merged_pr', 'authors', 'story', 'story_file', 'surface', 'area', 'roadmap_ref', 'materialised_by', 'doc_id', 'wave', 'selection']);
// wave labels come from the story file through materialise: a relabel would move a story out of its wave
const PROTECTED_LABEL = /^(state-.*|story|wave-\d+)$/;
const EXPANSION = /\$\(|\$\{|\$[A-Za-z_]|`/;
const values = (p, f) => (p.all.get(f) || []).filter((v) => typeof v === 'string');
// what makes a bead a tier-1 fix (R-41): set by the Delivery Manager or the Product Manager only, so a
// builder cannot promote its own work past the wave, lean and new-area rules
const FIX_LABEL = /^(bug|security|finding)$/;
const FIX_FIELDS = new Set(['fixes', 'finding']);
const fixFieldWrite = (p) => gateFieldWrite(p, { labelRe: FIX_LABEL, fields: FIX_FIELDS });
function gateFieldWrite(p, { labelRe = PROTECTED_LABEL, fields = GATE_FIELDS } = {}) {
  if (labelRe === PROTECTED_LABEL && p.sub === 'update' && p.all.has('--set-labels')) return 'replacing every label (use --add-label or --remove-label)';
  const created = CREATE.has(p.sub) ? [...values(p, '--labels'), ...values(p, '-l')] : [];
  const labels = [...LABEL_FLAGS.flatMap((f) => values(p, f)), ...created, ...(['label add', 'label remove', 'tag'].includes(p.sub) ? p.ids.slice(1) : [])];
  if (labels.some((v) => EXPANSION.test(v))) return 'labels built by the shell';
  const bad = labels.flatMap((v) => v.split(',')).map((l) => l.trim()).find((l) => labelRe.test(l));
  if (bad) return `the label ${bad}`;
  if (p.sub !== 'update' && !CREATE.has(p.sub)) return null;
  for (const f of ['--metadata', '--set-metadata', '--unset-metadata']) {
    for (const v of values(p, f)) {
      if (EXPANSION.test(v)) return `metadata built by the shell (${f} must be a literal)`;
      let keys;
      if (f === '--metadata') {
        let obj;
        try { obj = JSON.parse(v); } catch (err) { return '--metadata that is not a literal JSON object'; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '--metadata that is not a literal JSON object';
        keys = Object.keys(obj);
      } else keys = v.split(',').map((x) => x.split('=')[0].trim());
      const hit = keys.find((k) => fields.has(k));
      if (hit) return `the gate field ${hit}`;
    }
  }
  return null;
}

function decideBd({ command, actor, roleId, staleHours, bd, now }) {
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    if (roleId !== 'delivery-lead' && structural(p, actor, bd)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: ${STRUCTURE}` };
    }
    const field = roleId !== 'delivery-lead' ? gateFieldWrite(p) : null;
    if (field) {
      return { reason: `Refused: ${field}: only materialise, ready.js and evidence.js change it, for the Delivery Manager.\nMessage the Delivery Manager with the bead id and what should change.` };
    }
    const fixField = !['delivery-lead', 'product-manager'].includes(roleId) ? fixFieldWrite(p) : null;
    if (fixField) {
      return { reason: `Refused: ${fixField}: whether a bead is a fix, and what it fixes, is the Delivery Manager's or the Product Manager's to record.\nMessage the Delivery Manager with the bead id and the defect or finding it fixes.` };
    }
    if (CLOSING.has(p.sub)) {
      for (const id of p.ids) {
        const bead = lookup(bd, id);
        const age = liveOther(bead, actor, staleHours, now);
        if (age !== null) {
          return { reason: `Bead ${id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago): a live claim cannot be released by someone else.\nAsk the holder, message the Delivery Manager, or wait for staleness (${staleHours}h).` };
        }
      }
    }
    if (p.sub === 'reopen' && !REOPENERS.has(roleId)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: reopening a closed bead is the Delivery Manager's or Progress Observer's call.\nMessage the Delivery Manager or Progress Observer with the evidence that it is not done.` };
    }
    // `assign <id> <who>` is a claim change: the second positional is a person, not a bead.
    const assigning = p.sub === 'assign' && p.ids.length > 0;
    if (assigning || (p.sub === 'update' && p.ids.length && CLAIM_FLAGS.some((f) => p.flags.has(f)))) {
      for (const id of assigning ? p.ids.slice(0, 1) : p.ids) {
        const bead = lookup(bd, id);
        // who built a story is evidence for the done gate: only the Delivery Manager reassigns it
        const reassign = assigning || p.flags.has('--assignee') || p.flags.has('-a');
        if (reassign && roleId !== 'delivery-lead' && bead && bead.assignee && isStoryBead(bead)) {
          return { reason: `Refused: ${id} is a claimed story; only the Delivery Manager reassigns or releases it.\nMessage the Delivery Manager: release ${id}.` };
        }
        // the Delivery Manager assigns work, so it may reassign or release a live claim
        const age = roleId === 'delivery-lead' ? null : liveOther(bead, actor, staleHours, now);
        if (age !== null) {
          return { reason: `Bead ${id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago): a claim is the only authority, do not take or release it.\nMessage the Delivery Manager, or wait for staleness (${staleHours}h).` };
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
// deny only on a divergence (D1, D2, D3); every other finding is a warning the hook records.
// Any read that fails leaves the command allowed (fail open), like the rest of this guard. The whole
// check has one deadline: every bd call checks it first (a spent budget fails open with a warning),
// lookups are cached, and the judge is asked at most once per command while time remains.
const path = require('path');
const statusOf = (p) => p.flags.get('--status') || p.flags.get('-s');
const assignee = (p) => (p.sub === 'assign' ? p.ids[1] : p.flags.get('--assignee') || p.flags.get('-a'));
// a claim, or work assigned to someone: both make the assignee the story's builder
const CLAIMING = (p) => (p.sub === 'assign' && p.ids.length > 1) || (p.sub === 'update' && p.ids.length > 0 && (p.flags.has('--claim') || statusOf(p) === 'in_progress' || (typeof assignee(p) === 'string' && assignee(p) !== '')));
// every way a bead ends up closed: close and its alias done, duplicate, supersede, gate resolve, and
// a status write of closed
const CLOSES = (p) => CLOSING.has(p.sub) || (p.sub === 'update' && p.ids.length > 0 && statusOf(p) === 'closed');
const JUDGE_RESERVE_MS = 2500;
const BD_CALL_MS = 4000;
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const script = (name) => `node ${path.join(SCRIPTS, name)}`;

// bd held to a deadline: each call first checks the time left (and gets at most BD_CALL_MS of it when
// the store accepts a timeout); show is cached for the hook's life. spent is set once a call is skipped.
function budgeted(bd, deadline) {
  if (!bd || bd.budgeted) return bd;
  const cache = new Map();
  const b = { budgeted: true, spent: false, deadline };
  const left = () => deadline - Date.now();
  const guard = (fn) => (...args) => {
    if (left() < 200) { b.spent = true; throw new Error('hook time budget spent'); }
    const ms = Math.min(BD_CALL_MS, left());
    if (typeof bd.setTimeout === 'function') bd.setTimeout(ms);
    const t0 = Date.now();
    try { return fn(...args); } finally {
      // a call that used its whole timeout was cut off (bd.show turns that into null): checks were skipped
      if (Date.now() - t0 >= ms - 50) b.spent = true;
    }
  };
  b.show = guard((id) => { if (!cache.has(id)) cache.set(id, bd.show(id)); return cache.get(id) && JSON.parse(JSON.stringify(cache.get(id))); });
  b.list = guard((o) => bd.list(o));
  b.update = guard((id, o) => { cache.delete(id); return bd.update(id, o); });
  return b;
}

// The second line of a refusal: the command for the Delivery Manager, a message for anyone else.
const nextStep = (roleId, dmCommand, ask) => (roleId === 'delivery-lead' ? `Run: ${dmCommand}` : `Message the Delivery Manager: ${ask}.`);
function claimFix(f, id) {
  if (f.rule === 'D2') return `set the story's surface: to an id in surface.json, then ${script('ready.js')} ${id} --record`;
  if (f.code === 'outside-wave' || f.code === 'wave-half-built') return `${script('wave.js')} show, then finish the current wave or cut its rest on the owner's record (${script('evidence.js')} cut <bead> --record <dec-...> --reason '<why>')`;
  if (f.code === 'budget-short' || f.code === 'fix-over-budget' || f.code === 'new-area-near-limit') return `${script('plan.js')} budget, then re-cut ${id} smaller or defer it`;
  if (f.code === 'new-area') return `${script('plan.js')} select for compounding work; a new area needs the owner's reason (the Chief of Staff: goal.js ask area_add ${f.area || '<area>'})`;
  if (f.code === 'child-scope') return `bd update ${id} --metadata '{"criterion": <n>}' with a criterion its story has, or make the new scope its own story`;
  return `${script('ready.js')} ${id} --record --owner-record <dec-...> once the change is agreed`;
}

// Who builds a story when this claim goes through: the --assignee target or the claimer, never the
// Delivery Manager, who assigns work and records evidence.
function builderOf(p, actor, roleId, instance) {
  const target = assignee(p);
  const who = typeof target === 'string' && target ? target : actor;
  if (!who || (who === actor && roleId === 'delivery-lead') || /\/delivery-lead$/.test(who)) return null;
  return { actor: who, instance: who === actor ? instance || null : String(who).split('/').pop(), role: who === actor ? roleId || null : null };
}

async function gateChecks({ command, roleId, actor, instance, bd: rawBd, root, team, ask, deadline, verifyRecord, budget }) {
  const G = require('../../scripts/lib/gates.js');
  const { gateInputs, maxUnverified, recordChecker } = require('../../scripts/lib/gate-context.js');
  const out = { deny: null, warnings: [] };
  if (!root) return out;
  const end = deadline || Date.now() + 8000;
  const bd = budgeted(rawBd, end);
  const recordOk = recordChecker(root, verifyRecord);
  let asked = false;
  const judge = async (q, state) => {
    if (!ask || asked || Date.now() + JUDGE_RESERVE_MS > end) return null;
    asked = true;
    try { return await ask(q, state); } catch (err) { return null; }
  };
  const add = (bead, code, rule, detail) => out.warnings.push({ kind: code, rule, bead, detail });
  const finish = () => {
    if (bd && bd.spent) add(null, 'budget-spent', 'R-11', 'the hook ran out of time and skipped part of the gate checks (allowed, fail open)');
    return out;
  };
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    const claiming = CLAIMING(p);
    const closing = CLOSES(p);
    if (!claiming && !closing) continue;
    for (const id of p.sub === 'assign' ? p.ids.slice(0, 1) : p.ids) {
      const bead = lookup(bd, id);
      if (!bead) continue;
      const story = G.isStoryBead(bead);
      let inp;
      try { inp = gateInputs(root, bead, { bd, team }); } catch (err) { continue; }
      if (claiming) {
        const findings = [];
        if (story && inp.story) {
          const judged = await judge('shippable_unit', G.shippableState(inp.story, inp.surface));
          findings.push(...G.readyFindings({ story: inp.story, surfaces: inp.surfaces, surfaceMissing: inp.surfaceMissing, bead, judged }));
        }
        let overCap = null;
        let stories = null;
        const fixLabelled = (bead.labels || []).some((l) => l === 'bug' || l === 'security');
        if (story || fixLabelled) { try { stories = bd.list({ label: 'story', all: true }); } catch (err) { stories = null; } }
        if (story && stories) overCap = G.unverifiedOver(stories, bead, maxUnverified(team));
        findings.push(...G.claimDivergence({ story: story ? inp.story : null, isStory: story, bead, parent: inp.parent, parentStory: inp.parentStory, overCap }));
        // waves, the budget, new areas and fixes (R-34, R-36, R-41; D1 and D5 only on serious divergence)
        if (stories) {
          try {
            const W = require('../../scripts/lib/waves.js');
            const ctx = W.contextFor(root, { bd, team, beads: stories, verifyRecord, budget });
            findings.push(...W.claimFindings(bead, { ...ctx, fix: ctx.fixOf(bead), reason: ctx.reasonOf(G.areaOf(bead)) }));
          } catch (err) { /* fail open */ }
        }
        const blocks = findings.filter((f) => f.level === 'block');
        for (const f of findings.filter((x) => x.level === 'warn')) add(id, f.code, f.rule, f.detail);
        if (blocks.length) {
          out.deny = `Claim of ${id} refused (${blocks.map((f) => `${f.rule}: ${f.detail}`).join('; ')}).\n${nextStep(roleId, claimFix(blocks[0], id), `${id} ${blocks[0].code}`)}`;
          return finish();
        }
        // stamp who builds the story, so clearing the assignee later does not make the builder a non-author
        const who = story ? builderOf(p, actor, roleId, instance) : null;
        if (who) {
          const m = bead.metadata || {};
          const authors = Array.isArray(m.authors) ? m.authors : [];
          if (!authors.some((a) => a && a.actor === who.actor)) {
            try { bd.update(id, { metadata: { ...m, authors: [...authors, who] } }); } catch (err) { /* fail open */ }
          }
        }
        continue;
      }
      // closing
      const reason = p.flags.get('--reason') || p.flags.get('-r');
      if (!story) {
        if (typeof reason !== 'string' || !reason.trim()) add(id, 'close-no-reason', 'R-11', 'closed with no --reason: say what it answered or shipped and where the proof is');
        continue;
      }
      if (inp.evidenceProblem) {
        out.deny = `Close of ${id} refused (D3): its evidence file does not match what evidence.js wrote: ${inp.evidenceProblem}.\n${nextStep(roleId, `restore .delivery/evidence/${id}.ndjson to its last evidence.js write (the bead's evidence_head names the row), then ${script('evidence.js')} check ${id}`, `${id} evidence-edited`)}`;
        return finish();
      }
      if (inp.rows.some((r) => r.type === 'cut' && recordOk(r.record))) continue;
      const drift = G.scopeDrift(inp.story, bead);
      if (drift) {
        out.deny = `Close of ${id} refused (D1): ${drift.detail}.\n${nextStep(roleId, `${script('ready.js')} ${id} --record --owner-record <dec-...>, then new evidence rows`, `${id} criteria-changed`)}`;
        return finish();
      }
      const done = G.doneCheck({ story: inp.story, bead, rows: inp.rows, surface: inp.surface, noSurface: inp.noSurface, instances: inp.instances, recordOk });
      if (!(bead.metadata || {}).ready_hash) {
        add(id, 'close-not-ready', 'R-11', 'closed without the done gate: the story was never made ready (ready.js --record), so no agreed criteria were checked');
        continue;
      }
      if (!done.ok) {
        const open = done.criteria.filter((c) => !c.row && !c.waiver);
        const missing = open.slice(0, 3).map((c) => `${c.n}: ${c.why}`).join('; ') + (open.length > 3 ? `; and ${open.length - 3} more (evidence.js check ${id})` : '');
        out.deny = `Close of ${id} refused (D3): criteria without a counting pass row: ${missing}.\n${nextStep(roleId, `${script('evidence.js')} add ${id} --criterion <n> --result pass --surface <id> --sha <deployed sha> --run <ref>`, `${id} needs evidence rows`)}`;
        return finish();
      }
      if (done.noSurface) add(id, 'no-surface', 'R-09', 'closed on evidence with no declared customer surface: the surface was not checked');
      if (typeof reason === 'string' && reason.trim()) {
        const j = await judge('divergence', { agreed_criteria: inp.story.criteria.map((c) => `${c.n}. ${c.text}`).join('\n'), customer_surface: inp.surface ? `${inp.surface.app}, ${inp.surface.mode}` : 'not declared', change_summary: reason });
        if (j && j.answer === 'serious') add(id, 'divergence-judge', 'D1-D5', `the typed judge rates this change a serious divergence (confidence ${Number(j.confidence).toFixed(2)}); warn-only until re-measured`);
      }
    }
  }
  return finish();
}

module.exports = { parseBd, decideBd, staleHoursOf, gateChecks, budgeted };
