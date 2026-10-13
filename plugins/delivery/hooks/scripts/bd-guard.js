// hooks/scripts/bd-guard.js — the record stays honest: evidence on close, no claim-jumping.
// A discipline aid, not a security boundary: a segment it cannot parse is allowed.
const { splitCommand, tokens } = require('./lane.js');

const TWO_WORD = new Set(['dep', 'label', 'comments', 'comment', 'dolt']);
// Flags that never take a value, so the token after them is an id, not their argument.
const BOOLEAN_FLAGS = new Set(['--claim', '--json', '--all', '--force', '--silent', '--quiet', '--verbose']);

function parseBd(segment) {
  const t = tokens(segment);
  // `VAR=x bd ...` and `env bd ...` leave t[0] != 'bd': unparseable, so allowed.
  if (t[0] !== 'bd' || !t[1]) return null;
  let sub = t[1];
  let i = 2;
  if (TWO_WORD.has(t[1]) && t[2]) { sub = `${t[1]} ${t[2]}`; i = 3; }
  let id = null;
  const flags = new Map();
  for (; i < t.length; i++) {
    const tok = t[i];
    if (tok.length > 1 && tok.startsWith('-')) {
      const eq = tok.indexOf('=');
      if (eq > 0) { flags.set(tok.slice(0, eq), tok.slice(eq + 1)); continue; }
      const next = t[i + 1];
      if (!BOOLEAN_FLAGS.has(tok) && next !== undefined && !(next.length > 1 && next.startsWith('-'))) { flags.set(tok, next); i++; } else flags.set(tok, true);
    } else if (id === null) id = tok;
  }
  return { sub, id, flags };
}

function hoursBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / 3600000; }

function decideBd({ command, actor, staleHours, bd, now }) {
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    if (p.sub === 'close') {
      const reason = p.flags.get('--reason') || p.flags.get('-r');
      if (typeof reason !== 'string' || !reason.startsWith('EVIDENCE:')) {
        return { reason: `Close with evidence: bd close ${p.id || '<id>'} --reason "EVIDENCE: what shipped, how it was checked, link". A bead closes only when every criterion has proof.` };
      }
    }
    if (p.sub === 'update' && p.id && (p.flags.has('--claim') || p.flags.has('--assignee') || p.flags.has('--status'))) {
      let bead = null;
      try { bead = bd.show(p.id); } catch (err) { bead = null; }
      if (bead && bead.status === 'in_progress' && bead.assignee && bead.assignee !== actor) {
        const age = hoursBetween(bead.updated_at || '1970-01-01T00:00:00Z', now || new Date().toISOString());
        if (age < staleHours) {
          return { reason: `Bead ${p.id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago). A claim is the only authority: do not take or release it. Ask the Delivery Lead, or wait for staleness (${staleHours}h).` };
        }
      }
    }
  }
  return null;
}

module.exports = { parseBd, decideBd };
