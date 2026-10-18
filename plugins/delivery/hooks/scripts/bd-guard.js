// hooks/scripts/bd-guard.js — the record stays honest: evidence on close, no claim-jumping,
// structure only by the Delivery Manager.
// A discipline aid, not a security boundary. A bd call behind a wrapper (env, VAR=, command, an absolute
// path, nice, timeout, exec, nohup, sh -c, eval, a subshell or a command substitution) is unwrapped and
// checked like a plain one; a call the guard cannot read (xargs bd, find -exec bd, ...) is refused to
// every role but the Delivery Manager and Product Manager. Known limit (cooperative trust): a program
// that spawns bd itself (python, node) is not seen.
const { splitCommand, tokens, splitBdGlobals } = require('./lane.js');
const G0 = require('../../scripts/lib/gates.js');
const { isStoryBead } = G0;

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

const isBd = (w) => /(?:^|\/)bd(?:\.exe)?$/.test(String(w || ''));
const WRAPPERS = new Set(['env', 'command', 'exec', 'nice', 'nohup', 'time', 'timeout', 'stdbuf', 'ionice', 'builtin', 'sudo']);
const WRAPPER_VALUE_FLAGS = new Set(['-n', '-u', '-s', '-k', '-c', '-p', '-S', '-C', '--signal', '--kill-after', '--adjustment']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// commands that only mention bd as an argument or read about it
const MENTIONS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'cat', 'less', 'head', 'tail', 'which', 'type', 'man', 'git', 'gh', 'wc', 'ls', 'true', 'test', 'whereis', 'hash']);
const base = (w) => String(w || '').split('/').pop();

// programs that run their arguments as commands: a bd inside an argument is a bd call the guard cannot read
const RUNNERS = new Set(['parallel', 'watch', 'xargs', 'find', 'nohup', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'env', 'time', 'timeout', 'nice', 'exec', 'sudo', 'stdbuf']);
// bd named anywhere once quotes and backslashes are dropped ("b"d, b\d)
const mentionsBd = (text) => /(?:^|[^\w.])bd(?:$|[^\w.-])/.test(String(text || '').replace(/['"\\]/g, ''));
// words as the shell sees them before unquoting, so a quoted or substituted command word stays visible
const rawWords = (seg) => String(seg).match(/(?:[^\s'"\\]|\\.|'[^']*'|"(?:[^"\\]|\\.)*")+/g) || [];
// the command word of a segment, raw: after assignments, wrappers and their options, and ( or {
function rawCommandWord(seg) {
  const w = rawWords(seg).map((x) => x.replace(/^[({]+/, '')).filter((x) => x !== '');
  let i = 0;
  for (let guard = 0; guard < 8 && i < w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) { i++; continue; }
    const name = base(w[i]);
    if (!WRAPPERS.has(name)) break;
    i++;
    while (i < w.length && (w[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]))) i += WRAPPER_VALUE_FLAGS.has(w[i]) ? 2 : 1;
    if (name === 'timeout' && i < w.length) i++;
  }
  return w[i] || '';
}

// Each bd call in a command: { tokens } once wrappers are peeled, or { opaque, via } for one the guard
// cannot read. Command substitutions and shell -c scripts are read recursively. In a command that
// names bd, these cannot be read (final check, PR 54): a command word that is not literal ($, a
// backtick, a quote or a backslash in it: $(which bd), ${BD:-bd}, "b"d, b\d); a shell reading its
// script from stdin or a file (| sh, sh -s, sh < file, bash <<EOF); a runner that executes an argument
// naming bd (parallel, watch, xargs sh -c, find -exec).
function bdCalls(command, depth = 0) {
  const out = [];
  const text = String(command == null ? '' : command);
  if (depth > 3) return mentionsBd(text) ? [{ opaque: text, via: 'nested shells' }] : [];
  const named = mentionsBd(text);
  for (const m of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) out.push(...bdCalls(m[1] || m[2] || '', depth + 1));
  for (const seg of splitCommand(text)) {
    let t = tokens(seg);
    if (!t.length) continue;
    if (named && /[$`'"\\]/.test(rawCommandWord(seg))) { out.push({ opaque: seg, via: 'a command word built by the shell' }); continue; }
    t = t.map((x, i) => (i === 0 ? x.replace(/^\$?\(+/, '') : x)).map((x, i, a) => (i === a.length - 1 ? x.replace(/\)+$/, '') : x)).filter((x) => x !== '');
    // peel wrappers and environment assignments
    for (let guard = 0; guard < 8 && t.length; guard++) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) { t = t.slice(1); continue; }
      const w = base(t[0]);
      if (!WRAPPERS.has(w)) break;
      let i = 1;
      while (i < t.length && (t[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]))) i += WRAPPER_VALUE_FLAGS.has(t[i]) ? 2 : 1;
      if (w === 'timeout' && i < t.length) i++; // the duration
      t = t.slice(i);
    }
    if (!t.length) continue;
    const first = base(t[0]);
    if (isBd(t[0])) { out.push({ tokens: ['bd', ...t.slice(1)] }); continue; }
    if (SHELLS.has(first)) {
      const c = t.findIndex((x, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(x));
      let k = c + 1;
      while (c > 0 && t[k] === '--') k++;
      if (c > 0 && t[k] !== undefined) { out.push(...bdCalls(t[k], depth + 1)); continue; }
      // no -c: the script comes from stdin or a file
      if (named) { out.push({ opaque: seg, via: `${first} reading its script from stdin or a file` }); continue; }
    }
    if (first === 'eval') { out.push(...bdCalls(t.slice(1).join(' '), depth + 1)); continue; }
    if (t.slice(1).some(isBd) && !MENTIONS.has(first)) out.push({ opaque: seg, via: first });
    else if (RUNNERS.has(first) && t.slice(1).some(mentionsBd)) out.push({ opaque: seg, via: first });
  }
  return out;
}

function parseBd(segment) {
  const t = Array.isArray(segment) ? segment : tokens(segment);
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
const GATE_FIELDS = new Set(['ready_hash', 'ready_at', 'ready_record', 'deployed_sha', 'deployed_at', 'deployed_version', 'evidence_head', 'merged_pr', 'authors', 'story', 'story_file', 'surface', 'area', 'roadmap_ref', 'materialised_by', 'doc_id', 'wave', 'selection', 'assumption', 'decision_owner', 'ready_assumptions']);
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

function spikeUnlabel(p) {
  const removed = [...values(p, '--remove-label'), ...(p.sub === 'label remove' ? p.ids.slice(1) : [])];
  return removed.some((v) => EXPANSION.test(v) || v.split(',').some((l) => l.trim() === 'spike'));
}

const UNREAD = (via) => `Refused: bd run through ${via} cannot be checked by the guard.\nRun bd directly so the guard can check it: \`bd <command>\`.`;
function decideBd({ command, actor, roleId, staleHours, bd, now }) {
  for (const call of bdCalls(command)) {
    if (call.opaque) {
      if (!['delivery-lead', 'product-manager'].includes(roleId)) return { reason: UNREAD(call.via) };
      continue;
    }
    const seg = call.tokens.join(' ');
    const p = parseBd(call.tokens);
    if (!p) continue;
    if (roleId !== 'delivery-lead' && structural(p, actor, bd)) {
      return { reason: `Role ${roleId || 'unknown'} may not run \`${seg.slice(0, 80)}\`: ${STRUCTURE}` };
    }
    const field = roleId !== 'delivery-lead' ? gateFieldWrite(p) : null;
    if (field) {
      return { reason: `Refused: ${field}: only materialise, ready.js and evidence.js change it, for the Delivery Manager.\nMessage the Delivery Manager with the bead id and what should change.` };
    }
    // the spike label marks the spike gate's beads: only the Delivery Manager removes it (review I2)
    if (roleId !== 'delivery-lead' && spikeUnlabel(p)) return { reason: 'Refused: removing the spike label: the spike gate keys on it, so only the Delivery Manager changes it.\nMessage the Delivery Manager with the bead id.' };
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
  if (f.code === 'outside-wave' || f.code === 'wave-half-built') return `${script('wave.js')} show, then finish the current wave or cut its rest on the owner's record (evidence.js cut)`;
  if (f.code === 'budget-short' || f.code === 'fix-over-budget' || f.code === 'new-area-near-limit') return `${script('plan.js')} budget, then re-cut ${id} smaller or defer it`;
  if (f.code === 'new-area') return `${script('plan.js')} select for compounding work; a new area needs the owner's reason (the Chief of Staff: goal.js ask area_add ${f.area || '<area>'})`;
  if (f.code === 'assumption-unobserved') return `bd show ${f.spike}, then dispatch it to the Reality Checker to probe the real host (assumptions.js probe)`;
  if (f.code === 'spike-unacked') return `${script('assumptions.js')} ack ${f.spike} --result <ev-id> --decision '<the decision taken>' (its decision owner)`;
  if (f.code === 'assumption-refuted' || f.code === 'area-andon') return `${script('ready.js')} ${id} --record, once the Product Manager has changed the design and the register`;
  if (f.code === 'child-scope') return `bd update ${id} --metadata '{"criterion": <n>}' with a criterion its story has, or make the new scope its own story`;
  return `${script('ready.js')} ${id} --record --owner-record <dec-...> once the change is agreed`;
}

// what a builder tells the Delivery Manager, in plain words rather than a check's code name (review m-3)
const PLAIN = {
  'wave-half-built': 'it would leave the current wave half-built', 'outside-wave': 'its wave has not started',
  'budget-short': 'it does not fit the budget left', 'fix-over-budget': 'the fix does not fit the budget left',
  'new-area': "a new area needs the owner's reason", 'new-area-near-limit': 'the budget is near its limit',
  'assumption-unobserved': (f) => `it waits on spike ${f.spike}, a check of the real host`,
  'spike-unacked': (f) => `spike ${f.spike} needs its decision owner's acknowledgement`,
  'assumption-refuted': (f) => `${f.assumption} was refuted, so its design changes first`,
  'area-andon': (f) => `its area is paused on refuted ${f.assumption}`,
};
const plainOf = (f) => (typeof PLAIN[f.code] === 'function' ? PLAIN[f.code](f) : PLAIN[f.code]);

// Who builds a story when this claim goes through: the --assignee target or the claimer, never the
// Delivery Manager, who assigns work and records evidence.
function builderOf(p, actor, roleId, instance) {
  const target = assignee(p);
  const who = typeof target === 'string' && target ? target : actor;
  if (!who || (who === actor && roleId === 'delivery-lead') || /\/delivery-lead$/.test(who)) return null;
  return { actor: who, instance: who === actor ? instance || null : String(who).split('/').pop(), role: who === actor ? roleId || null : null };
}

// A spike answering an assumption is not deleted while a story resting on it is open, by anyone: the
// story's D4 reads the evidence on the spike's chain, and the spike is where its answer goes.
function spikeDelete(p, { bd, root }) {
  const A = require('../../scripts/lib/assumptions.js');
  for (const id of p.ids) {
    const bead = lookup(bd, id);
    const m = (bead && bead.metadata) || {};
    if (!m.assumption) continue;
    const slug = G0.initiativeOf(bead);
    const row = slug ? A.loadRegister(root, slug).rows.find((r) => r.id === m.assumption) : null;
    const stories = new Set(((row && row.criteria) || []).map((c) => c.story));
    let open = [];
    try { open = bd.list({ label: 'story', all: true }).filter((s) => s.status !== 'closed' && stories.has(String((s.metadata || {}).story || ''))); } catch (err) { open = []; }
    if (open.length) return `Delete of ${id} refused (D4): ${open.map((s) => s.id).join(', ')} still rest on ${m.assumption}, which it answers.\nClose or cut those stories first, or message the Delivery Manager.`;
  }
  return null;
}

async function gateChecks({ command, roleId, actor, instance, bd: rawBd, root, team, ask, deadline, verifyRecord, budget }) {
  const G = require('../../scripts/lib/gates.js');
  const { gateInputs, maxUnverified, recordChecker } = require('../../scripts/lib/gate-context.js');
  const out = { deny: null, warnings: [] };
  // the budget is read once per command; each start that passes is held for the next (Copilot 827)
  let base = budget;
  const projected = new Map();
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
  for (const call of bdCalls(command)) {
    if (call.opaque) continue;
    const p = parseBd(call.tokens);
    if (!p) continue;
    const claiming = CLAIMING(p);
    const closing = CLOSES(p);
    if (p.sub === 'delete') {
      const held = spikeDelete(p, { bd, root });
      if (held) { out.deny = held; return finish(); }
      continue;
    }
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
        // the assumption register (R-15, R-16): D4 on an external host, a warning for the rest. A child
        // of a story answers to its parent's assumptions, for its criterion or, naming none, for all.
        try {
          const A = require('../../scripts/lib/assumptions.js');
          const regs = A.registers(root, { bd, verifyRecord });
          const parentStory = !story && inp.parent && G.isStoryBead(inp.parent) ? inp.parent : null;
          if (story) {
            findings.push(...A.forStory(root, bead, { bd, team, regs, storyId: (bead.metadata || {}).story || (inp.story && String(inp.story.meta.id || '')), atClaim: true }).findings);
            // each story in the area is read against its own initiative's register (Copilot 864)
            const an = stories ? A.areaAndon(bead, stories, (s) => regs.rowsFor(G.initiativeOf(s))) : null;
            if (an) findings.push(an);
          } else if (parentStory) {
            const pm = parentStory.metadata || {};
            findings.push(...A.forStory(root, parentStory, { bd, team, regs, storyId: pm.story || (inp.parentStory && String(inp.parentStory.meta.id || '')), atClaim: true, criterion: (bead.metadata || {}).criterion })
              .findings.map((f) => ({ ...f, detail: `its story ${parentStory.id}: ${f.detail}` })));
            // and its story's area pause: a fix label on the child or the story still goes on (Copilot 911)
            let all = stories;
            if (!all) { try { all = bd.list({ label: 'story', all: true }); } catch (err) { all = null; } }
            const an = all ? A.areaAndon({ ...parentStory, labels: [...(parentStory.labels || []), ...(bead.labels || [])] }, all, (s) => regs.rowsFor(G.initiativeOf(s))) : null;
            if (an) findings.push(an);
          }
        } catch (err) { /* fail open */ }
        if ((bead.labels || []).includes('spike')) {
          const m = bead.metadata || {};
          const miss = ['question', 'decision', 'decision_rule'].filter((k) => !m[k]);
          if (miss.length) add(id, 'spike-fields', 'R-16', `the spike names no ${miss.join(', ').replace('_', ' ')}: say what it decides and what result means build, change the design or stop`);
        }
        // waves, the budget, new areas and fixes (R-34, R-36, R-41; D1 and D5 only on serious divergence)
        let started = null;
        if (stories) {
          try {
            const W = require('../../scripts/lib/waves.js');
            const B = require('../../scripts/lib/budget.js');
            // starts earlier in this command are budgeted with this one (Copilot 827)
            const seen = stories.map((s) => (projected.has(s.id) ? { ...s, status: 'in_progress' } : s));
            // the transcript scan keeps to the hook's own deadline, leaving room for the rest of the checks
            const ctx = W.contextFor(root, { bd, team, beads: seen, verifyRecord, budget: base, deadline: end - JUDGE_RESERVE_MS });
            if (!base) base = ctx.budget;
            const extra = [...projected.values()].reduce((n, x) => n + x, 0);
            const st = base.set && extra ? { ...base, inflightNeed: base.inflightNeed + extra, free: base.free - extra, nearLimit: base.free - extra < base.table.units.S * (1 + base.table.reserve) } : base;
            findings.push(...W.claimFindings(bead, { ...ctx, beads: seen, budget: st, fix: ctx.fixOf(bead), reason: ctx.reasonOf(G.areaOf(bead)) }));
            if (st.set && !W.built(bead)) started = B.estimate(bead, { t: st.table, team }).units * (1 + st.table.reserve);
          } catch (err) { /* fail open */ }
        }
        const blocks = findings.filter((f) => f.level === 'block');
        for (const f of findings.filter((x) => x.level === 'warn')) add(id, f.code, f.rule, f.detail);
        if (blocks.length) {
          const first = `Claim of ${id} refused (${blocks.map((f) => `${f.rule}: ${f.detail}`).join('; ')}).`;
          out.deny = `${first.length > 300 ? `${first.slice(0, 296)}...)` : first}\n${nextStep(roleId, claimFix(blocks[0], id), plainOf(blocks[0]) ? `${id} cannot start, ${plainOf(blocks[0])}` : `${id} ${blocks[0].code}`)}`;
          return finish();
        }
        if (started !== null) projected.set(id, started);
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
        const sm = bead.metadata || {};
        // the spike gate (R-16): a result, then the decision owner's acknowledgement of that result. Keyed
        // on the protected assumption field too, so dropping the spike label does not skip it (Copilot 888)
        if (sm.assumption || ((bead.labels || []).includes('spike') && sm.decision_rule)) {
          const A = require('../../scripts/lib/assumptions.js');
          const slug = G.initiativeOf(bead);
          const regs = A.registers(root, { bd, verifyRecord });
          const asm = sm.assumption && slug ? regs.rowsFor(slug).find((r) => r.id === sm.assumption) : null;
          const st = A.spikeState(root, bead, { a: asm, slug, bd, ownerOk: regs.ownerOk });
          const missing = !st.result ? 'it has no result row' : !st.acked ? 'its decision owner has not acknowledged the result' : null;
          if (missing && asm && asm.kind === 'external-host') {
            const way = !st.result ? `Message the Delivery Manager: ${id} needs the Reality Checker's probe (\`assumptions.js probe\`).` : `Message the Delivery Manager: ${id} needs its decision owner's acknowledgement of ${st.result.id}.`;
            out.deny = `Close of ${id} refused (D4): ${missing}, and it answers ${asm.id}, an external host on a criterion's path.\n${way}`;
            return finish();
          }
          if (missing) add(id, 'spike-unacked', 'R-16', `closed but ${missing}`);
        }
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

module.exports = { bdCalls, parseBd, decideBd, staleHoursOf, gateChecks, budgeted };
