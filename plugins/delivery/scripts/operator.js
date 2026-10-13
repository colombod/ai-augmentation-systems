#!/usr/bin/env node
// scripts/operator.js — the operator CLI: capture, record, verify and carry the operator's decisions.
//
// Exit codes: 0 ok; 1 refused or not verified; 2 usage or environment error.
// Every command accepts --project <root> and --json. Write commands require a valid role marker
// (prepare-role writes it and DELIVERY_ROLE names the instance) and end with a best-effort publish.
const fs = require('fs');
const path = require('path');
const { findProjectRoot, expandInstances } = require('./lib/manifest.js');
const { findRoleMarker, validMarker, bdOptionsFor } = require('../hooks/scripts/role-context.js');
const { makeBd } = require('./lib/bd.js');
const { readRoster } = require('./lib/roster.js');
const transcript = require('./lib/transcript.js');
const log = require('./lib/operator-log.js');
const R = require('./lib/operator-records.js');

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['json', 'force', 'all', 'format-check', 'help']);
const COMMANDS = ['publish', 'refresh', 'sync', 'record', 'delegate', 'decide', 'revoke', 'ack', 'ask', 'withdraw', 'answer', 'ratify',
  'find', 'ledger', 'pending', 'verify', 'show'];

const USAGE = `usage: operator.js <command> [options]   (all commands: --project <root> --json)
  sync [--transcript <path>] [--session <id>] [--all] [--format-check]
  record --cite in-N --quote "<exact words>" --statement "<what was decided>" [--scope bead:ID,label:L,initiative:I] [--answers q-N] [--supersedes ID]
  delegate --cite in-N --quote "<...>" --statement "<...>" --grant "<one sentence: what is delegated>" --scope ... [--until DATE] [--max-uses N] [--answers q-N]
  decide --under del-N --statement "<...>" --scope ... [--answers q-N]
  revoke --cite in-N --quote "<...>" --target ID
  ack --input in-N --reason "<why this input is not a decision>"
  ask --text "<question>" --asker <instance> [--bead ID] [--options "A|B"] [--recommendation "<...>"] [--scope ...]
  withdraw --question q-N --reason "<...>"
  answer --cite dec-N[,del-M,...] --question "<...>" --answer "<...>" --confidence settled|inferred [--rationale "<...>"] [--scope ...] [--answers q-N] [--supersedes ID]
  ratify --cite in-N --quote "<...>" --target ans-N|del-N
  find [--scope ...] [--text "<words>"] [--all]
  ledger [--bead ID] [--status open|answered|withdrawn]
  pending [--since 24h] [--all]
  verify <id>        show <id>
  publish [--force]  refresh

Trust: roles are trusted cooperatively. The role marker, DELIVERY_ROLE_DIR and .delivery-session are plain
files and variables a session with Bash could spoof; the hash chains, recorded heads and git history make
tampering detectable, they are not an access boundary.`;

// ---- argument parsing ----

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { flags[key] = true; continue; }
      let val;
      if (eq > 0) val = a.slice(eq + 1);
      else {
        if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value`);
        val = argv[++i];
      }
      flags[key] = val;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function need(flags, ...names) {
  for (const n of names) {
    if (typeof flags[n] !== 'string' || flags[n] === '') throw new UsageError(`--${n} is required`);
  }
}

function csv(v) { return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; }

function parseScope(v) {
  const out = { beads: [], labels: [], initiatives: [] };
  if (v === undefined || v === '') return out;
  for (const tok of csv(v)) {
    const i = tok.indexOf(':');
    const kind = i > 0 ? tok.slice(0, i) : '';
    const val = i > 0 ? tok.slice(i + 1) : '';
    const key = { bead: 'beads', beads: 'beads', label: 'labels', labels: 'labels', initiative: 'initiatives', initiatives: 'initiatives' }[kind];
    if (!key || !val) throw new UsageError(`scope entry "${tok}" must look like bead:ID, label:NAME or initiative:NAME`);
    out[key].push(val);
  }
  return out;
}

function parseSince(v) {
  if (v === undefined) return undefined;
  const m = /^(\d+)([smhd])$/.exec(String(v));
  if (m) return new Date(Date.now() - Number(m[1]) * { s: 1e3, m: 6e4, h: 3600e3, d: 86400e3 }[m[2]]).toISOString();
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new UsageError(`--since "${v}" must be a duration like 24h or an ISO timestamp`);
  return new Date(t).toISOString();
}

// ---- context ----

function buildContext(flags) {
  const cwd = process.cwd();
  let valid = null;
  try { valid = validMarker(findRoleMarker(cwd)); } catch (e) { valid = null; }
  let projectRoot = flags.project ? path.resolve(flags.project) : null;
  if (!projectRoot) projectRoot = (valid && valid.marker.project_root) || findProjectRoot(cwd);
  if (!projectRoot) throw new UsageError('no delivery project found: run from a role session or pass --project <root>');
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) throw new UsageError(`project root ${projectRoot} does not exist`);
  let sessionId = 'unknown';
  if (valid) {
    try { sessionId = fs.readFileSync(path.join(valid.roleDir, '.delivery-session'), 'utf8').trim() || 'unknown'; } catch (e) { /* none yet */ }
  }
  const ctx = {
    projectRoot,
    json: !!flags.json,
    valid,
    roleDir: valid ? valid.roleDir : null,
    by: valid ? { instance: valid.marker.instance, role: valid.role.id, session_id: sessionId } : null,
    host: valid ? valid.role.host : (process.env.DELIVERY_HOST || undefined),
    projectFlag: flags.project ? path.resolve(flags.project) : null,
    refreshed: false,
    warnings: [],
  };
  if (ctx.by && ctx.host) ctx.by.host = ctx.host;
  ctx.instance = ctx.by ? ctx.by.instance : undefined;
  // once per command: the first call fetches and brings other writers' files; later calls do nothing
  ctx.refreshOnce = () => {
    if (ctx.refreshed) return ctx.refreshResult;
    ctx.refreshed = true;
    ctx.refreshResult = log.refresh(projectRoot, { host: ctx.host, instance: ctx.instance });
    return ctx.refreshResult;
  };
  ctx.onWarning = (w) => ctx.warnings.push(w);
  return ctx;
}

function requireWriter(ctx) {
  if (ctx.by && ctx.projectFlag && real(ctx.projectFlag) !== real(ctx.valid.marker.project_root)) {
    throw new R.OperatorError('project_mismatch', `--project ${ctx.projectFlag} is not the project of this role (${ctx.valid.marker.project_root}); records are written to the role's own project only. Drop --project`);
  }
  if (!ctx.by) {
    throw new R.OperatorError('not_allowed', 'no valid role marker for this session, so nothing can be recorded here; run operator.js from a delivery role session (prepare-role writes the marker and sets DELIVERY_ROLE). Reading (verify, show, pending, find, ledger) works anywhere');
  }
}

const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };

// Writing on stale state could ignore a revocation made on another host: refuse unless the
// refresh worked (or there is no remote to be stale against).
function needFresh(ctx) {
  const r = ctx.refreshOnce();
  if (r && !r.ok && !r.no_remote) {
    throw new R.OperatorError('refresh_failed', `could not refresh from ${r.remote || 'the upstream'}: ${String(r.reason || 'unknown').split('\n')[0]}; a revocation or decision made on another host may be missing, so nothing is recorded. Retry when the remote is reachable (operator.js refresh)`);
  }
}

// What a read should say about the refresh it attempted and about chains that failed verification.
function readWarnings(ctx, problems) {
  const w = [];
  const r = ctx.refreshResult;
  if (r && !r.ok && !r.no_remote) w.push(`could not refresh from ${r.remote || 'the upstream'}: ${String(r.reason || 'unknown').split('\n')[0]}; records on other hosts may be missing`);
  if (r && r.diverged && r.diverged.length) w.push(`diverged: ${r.diverged.join(', ')} differ from the upstream copy; another writer appended to a file only this one should (a forked instance)`);
  for (const p of problems || []) w.push(`${p.file} fails verification: ${p.error}`);
  return w;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function cursorStatus(projectRoot, sessionId) {
  try {
    const f = path.join(log.opDir(projectRoot), 'cursors', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    return transcript.formatStatus(JSON.parse(fs.readFileSync(f, 'utf8')));
  } catch (e) { return 'ok'; }
}

function transcriptPathFor(ctx, flags) {
  if (flags.transcript) return path.resolve(flags.transcript);
  if (!ctx.roleDir) return null;
  try { return fs.readFileSync(path.join(ctx.roleDir, '.delivery-transcript'), 'utf8').trim() || null; } catch (e) { return null; }
}

function syncOne(ctx, { transcriptPath, sessionId, instance, role }) {
  return log.syncTranscript({ projectRoot: ctx.projectRoot, transcriptPath, sessionId, instance, role, host: ctx.host });
}

// Sync this session's transcript; when `cite` is not found yet, retry for up to 2 s (the transcript
// can lag the hook), and for another host's input refresh once instead.
function syncCurrent(ctx, flags, cite) {
  const tr = transcriptPathFor(ctx, flags);
  let res = { added: 0, status: 'ok' };
  const sid = flags.session || (ctx.by.session_id !== 'unknown' ? ctx.by.session_id : (tr ? path.basename(tr).replace(/\.jsonl$/, '') : 'unknown'));
  const doSync = () => {
    if (!tr || !fs.existsSync(tr)) return;
    const r = syncOne(ctx, { transcriptPath: tr, sessionId: sid, instance: ctx.by.instance, role: ctx.by.role });
    res = { added: res.added + r.added, status: r.status };
  };
  doSync();
  if (cite && !log.getInput(ctx.projectRoot, cite)) {
    const p = log.parseId(cite);
    if (p && log.safeHost(p.host) !== log.safeHost(ctx.host)) {
      ctx.refreshOnce();
    } else {
      const deadline = Date.now() + 2000;
      while (!log.getInput(ctx.projectRoot, cite) && Date.now() < deadline) { sleep(200); doSync(); }
    }
  }
  return res;
}

function refuseIfFormatUnrecognised(ctx, syncRes, cite) {
  const bad = (syncRes && syncRes.status === 'format_unrecognised')
    || (cite && (() => {
      const e = log.getInput(ctx.projectRoot, cite);
      return e && e.session_id && cursorStatus(ctx.projectRoot, e.session_id) === 'format_unrecognised';
    })());
  if (bad) {
    throw new R.OperatorError('format_unrecognised', 'the transcript format was not recognised, so operator inputs cannot be trusted and nothing is recorded; tell the chief of staff (the transcript reader needs an update)');
  }
}

// ---- output ----

function out(ctx, jsonObj, lines) {
  if (ctx.json) process.stdout.write(JSON.stringify(jsonObj) + '\n');
  else process.stdout.write(lines.join('\n') + '\n');
}

function quoted(s) { return `"${s}"`; }

function afterWrite(ctx, rec, extra = {}, lines = []) {
  const pub = log.publish(ctx.projectRoot, { force: true, host: ctx.host, instance: ctx.instance });
  const published = !!pub.published;
  const warnings = [...(extra.warnings || []), ...ctx.warnings];
  const r = ctx.refreshResult;
  if (r && r.diverged && r.diverged.length) warnings.push(`diverged: ${r.diverged.join(', ')} differ from the upstream copy; another writer appended to a file only this one should (a forked instance)`);
  try {
    const pr = R.viewProblems(ctx.projectRoot);
    if (pr.length) warnings.push(`LEDGER.md was not regenerated: ${pr.map((x) => `${x.file} fails verification`).join('; ')}`);
  } catch (e) { /* best effort */ }
  const human = [rec.id, ...lines, ...warnings.map((w) => `warning: ${w}`),
    published ? 'published' : `unpublished (${pub.reason || 'not pushed'})`];
  out(ctx, { ok: true, id: rec.id, record: rec, published, unpublished_reason: published ? undefined : (pub.reason || 'not pushed'), warnings }, human);
  return 0;
}

function bdNotes(ctx, beads, text) {
  const warnings = [];
  if (!beads.length) return warnings;
  let bd;
  try { bd = makeBd(bdOptionsFor(ctx.valid ? ctx.valid.marker : null, process.cwd())); } catch (e) { bd = null; }
  for (const b of beads) {
    try {
      if (!bd) throw new Error('bd is not available');
      bd.update(b, { appendNotes: text });
    } catch (e) {
      warnings.push(`could not append the decision note to bead ${b} (${String(e.message).split('\n')[0]}); the record itself is written`);
    }
  }
  return warnings;
}

// ---- commands ----

const handlers = {
  publish(ctx, flags) {
    const r = log.publish(ctx.projectRoot, { force: !!flags.force, host: ctx.host, instance: ctx.instance });
    out(ctx, r, [r.published ? `published${r.entries !== undefined ? ` (${r.entries} entries)` : ''}` : `unpublished (${r.reason || 'nothing pushed'})`]);
    return 0;
  },

  refresh(ctx) {
    const r = log.refresh(ctx.projectRoot, { host: ctx.host, instance: ctx.instance });
    const lines = [r.ok ? `refreshed (${(r.updated || []).length} files)` : `not refreshed (${r.reason})`];
    if (r.diverged && r.diverged.length) lines.push(`warning: diverged: ${r.diverged.join(', ')} differ from the upstream copy; another writer appended to a file only this one should (a forked instance)`);
    out(ctx, r, lines);
    return r.ok ? 0 : 1;
  },

  sync(ctx, flags) {
    requireWriter(ctx);
    const res = syncCurrent(ctx, flags, null);
    let added = res.added;
    let status = res.status;
    if (flags.all) {
      let roles = {};
      try { for (const i of expandInstances(ctx.valid.team)) roles[i.instance] = i.role.id; } catch (e) { roles = {}; }
      const roster = readRoster(ctx.projectRoot).instances || {};
      const mine = flags.transcript || (ctx.roleDir ? transcriptPathFor(ctx, {}) : null);
      for (const [inst, e] of Object.entries(roster)) {
        if (!e || !e.transcript_path || log.safeHost(e.host) !== log.safeHost(ctx.host)) continue;
        if (!fs.existsSync(e.transcript_path) || (mine && path.resolve(e.transcript_path) === path.resolve(mine))) continue;
        try {
          const r = syncOne(ctx, { transcriptPath: e.transcript_path, sessionId: e.session_id || inst, instance: inst, role: roles[inst] || null });
          added += r.added;
          if (r.status === 'format_unrecognised') status = r.status;
        } catch (err) { /* one unreadable transcript must not stop the rest */ }
      }
    }
    if (flags['format-check'] && status === 'format_unrecognised') {
      out(ctx, { ok: false, code: 'format_unrecognised', added, status }, [`format_unrecognised: the transcript format was not recognised; tell the chief of staff`]);
      return 1;
    }
    out(ctx, { added, status }, [`added ${added} (${status})`]);
    return 0;
  },

  record(ctx, flags) {
    need(flags, 'cite', 'quote', 'statement');
    const scope = parseScope(flags.scope);
    requireWriter(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    if (flags.supersedes) needFresh(ctx);
    const rec = R.recordDecision({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, statement: flags.statement, scope,
      by: ctx.by, answers: csv(flags.answers), supersedes: flags.supersedes || null, refresh: ctx.refreshOnce, onWarning: ctx.onWarning });
    const warnings = bdNotes(ctx, rec.scope.beads, `DECISION ${rec.id} (operator ${flags.cite}): ${rec.statement}`);
    return afterWrite(ctx, rec, { warnings });
  },

  delegate(ctx, flags) {
    need(flags, 'cite', 'quote', 'statement', 'grant');
    const scope = parseScope(flags.scope);
    let maxUses = null;
    if (flags['max-uses'] !== undefined) {
      maxUses = Number(flags['max-uses']);
      if (!Number.isInteger(maxUses) || maxUses < 1) throw new UsageError('--max-uses must be a positive integer');
    }
    requireWriter(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    const rec = R.recordDelegation({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, statement: flags.statement, scope,
      grant: flags.grant, limits: { until: flags.until || null, max_uses: maxUses }, by: ctx.by, answers: csv(flags.answers), refresh: ctx.refreshOnce, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  decide(ctx, flags) {
    need(flags, 'under', 'statement');
    const scope = parseScope(flags.scope);
    requireWriter(ctx);
    needFresh(ctx);
    const under = R.getRecord(ctx.projectRoot, flags.under) || (ctx.refreshOnce() && R.getRecord(ctx.projectRoot, flags.under));
    if (under) refuseIfFormatUnrecognised(ctx, null, (under.cites || [])[0]);
    const rec = R.decideUnder({ projectRoot: ctx.projectRoot, under: flags.under, statement: flags.statement, scope, by: ctx.by,
      answers: csv(flags.answers), refresh: ctx.refreshOnce });
    const warnings = bdNotes(ctx, rec.scope.beads, `DECISION ${rec.id} (under ${rec.under}): ${rec.statement}`);
    return afterWrite(ctx, rec, { warnings });
  },

  revoke(ctx, flags) {
    need(flags, 'cite', 'quote', 'target');
    requireWriter(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    needFresh(ctx);
    const rec = R.revoke({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, target: flags.target, by: ctx.by, refresh: ctx.refreshOnce, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  ack(ctx, flags) {
    need(flags, 'input', 'reason');
    requireWriter(ctx);
    syncCurrent(ctx, flags, flags.input);
    const rec = R.ack({ projectRoot: ctx.projectRoot, input: flags.input, reason: flags.reason, by: ctx.by, refresh: ctx.refreshOnce, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  ask(ctx, flags) {
    need(flags, 'text', 'asker');
    const scope = parseScope(flags.scope);
    if (flags.bead && !scope.beads.includes(flags.bead)) scope.beads.push(flags.bead);
    requireWriter(ctx);
    let role = null;
    try { const f = expandInstances(ctx.valid.team).find((i) => i.instance === flags.asker); role = f ? f.role.id : null; } catch (e) { role = null; }
    const rec = R.recordQuestion({ projectRoot: ctx.projectRoot, text: flags.text, asker: { instance: flags.asker, role, bead: flags.bead || null },
      scope, options: flags.options ? flags.options.split('|').map((s) => s.trim()).filter(Boolean) : [],
      recommendation: flags.recommendation || null, by: ctx.by });
    return afterWrite(ctx, rec);
  },

  withdraw(ctx, flags) {
    need(flags, 'question', 'reason');
    requireWriter(ctx);
    const rec = R.withdraw({ projectRoot: ctx.projectRoot, question: flags.question, reason: flags.reason, by: ctx.by, refresh: ctx.refreshOnce });
    return afterWrite(ctx, rec);
  },

  answer(ctx, flags) {
    need(flags, 'cite', 'question', 'answer', 'confidence');
    const scope = parseScope(flags.scope);
    requireWriter(ctx);
    needFresh(ctx);
    const rec = R.recordAnswer({ projectRoot: ctx.projectRoot, cites: csv(flags.cite), question: flags.question, answer: flags.answer,
      confidence: flags.confidence, rationale: flags.rationale, scope, by: ctx.by, answers: csv(flags.answers),
      supersedes: flags.supersedes || null, refresh: ctx.refreshOnce });
    return afterWrite(ctx, rec);
  },

  ratify(ctx, flags) {
    need(flags, 'cite', 'quote', 'target');
    requireWriter(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    needFresh(ctx);
    const rec = R.ratify({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, target: flags.target, by: ctx.by, refresh: ctx.refreshOnce, onWarning: ctx.onWarning });
    // show the answer ratified beside the operator's words
    const target = R.getRecord(ctx.projectRoot, rec.target);
    const inp = log.getInput(ctx.projectRoot, flags.cite);
    const side = [];
    if (target) side.push(`ratified ${target.id}: ${quoted(target.answer || target.grant || target.statement || '')}`);
    if (inp) side.push(`operator said (${inp.id}): ${quoted(R.excerptFor(inp.text, flags.quote) || flags.quote)}`);
    return afterWrite(ctx, rec, {}, side);
  },

  find(ctx, flags) {
    ctx.refreshOnce();
    const res = R.find(ctx.projectRoot, { scope: parseScope(flags.scope), text: flags.text, all: !!flags.all, refresh: ctx.refreshOnce });
    const warnings = readWarnings(ctx, res.problems);
    const lines = res.length ? res.map((r) => {
      const sc = Object.entries(r.scope || {}).flatMap(([k, v]) => v.map((x) => `${k.slice(0, -1)}:${x}`)).join(',');
      const extra = [r.confidence ? `[${r.confidence}${r.ratified === true ? ', ratified' : ''}]` : '', sc ? `scope ${sc}` : '', r.superseded_by ? `superseded by ${r.superseded_by}` : ''].filter(Boolean).join(' ');
      return `${r.id} ${r.kind}${extra ? ' ' + extra : ''}: ${r.statement}${r.quote ? ` (operator: ${quoted(r.quote)})` : ''}${r.grant ? ` GRANT: ${r.grant}` : ''}`;
    }) : ['nothing found'];
    out(ctx, { results: [...res], problems: res.problems, warnings }, [...lines, ...warnings.map((w) => `warning: ${w}`)]);
    return 0;
  },

  ledger(ctx, flags) {
    if (flags.status && !['open', 'answered', 'withdrawn'].includes(flags.status)) throw new UsageError('--status must be open, answered or withdrawn');
    ctx.refreshOnce();
    const o = { bead: flags.bead, status: flags.status, since: parseSince(flags.since), refresh: ctx.refreshOnce };
    const rows = R.ledger(ctx.projectRoot, o);
    const warnings = readWarnings(ctx, rows.problems);
    if (ctx.json) { process.stdout.write(JSON.stringify({ rows: [...rows], problems: rows.problems, warnings }) + '\n'); return 0; }
    process.stdout.write(R.renderLedger(ctx.projectRoot, o) + warnings.map((w) => `warning: ${w}\n`).join(''));
    return 0;
  },

  pending(ctx, flags) {
    const since = parseSince(flags.since);
    ctx.refreshOnce();
    const p = R.pending(ctx.projectRoot, { since, all: !!flags.all, refresh: ctx.refreshOnce });
    const warnings = readWarnings(ctx, p.problems);
    const lines = [];
    // ids handed out must be visible to other hosts: say so when this host cannot push
    let unpub = { count: 0 };
    if (ctx.by) {
      const pub = log.publish(ctx.projectRoot, { host: ctx.host, instance: ctx.instance });
      unpub = log.unpublished(ctx.projectRoot, { host: ctx.host, instance: ctx.instance });
      if (unpub.count > 0) lines.push(`unpublished local records: ${unpub.count} (${pub.published ? 'push in progress' : (pub.reason || unpub.reason)})`);
    }
    if (p.open_questions.length) {
      lines.push(`Open questions (${p.open_questions.length}):`);
      for (const q of p.open_questions) lines.push(`  ${q.id}  ${q.text}${q.asker && q.asker.bead ? ` (bead ${q.asker.bead})` : ''}${q.recommendation ? ` [recommended: ${q.recommendation}]` : ''}`);
    }
    if (p.unratified_answers.length) {
      lines.push(`Inferred answers awaiting ratification (${p.unratified_answers.length}):`);
      for (const a of p.unratified_answers) lines.push(`  ${a.id}  ${a.answer} (rationale: ${a.rationale})`);
    }
    if (p.delegations_awaiting_glance.length) {
      lines.push(`Delegations awaiting a glance (${p.delegations_awaiting_glance.length}):`);
      for (const d of p.delegations_awaiting_glance) lines.push(`  ${d.id}  GRANT: ${d.grant}  (operator: ${quoted(d.quote)})`);
    }
    if (p.inputs.length) {
      lines.push(`Operator inputs with no record or ack (${p.inputs.length}):`);
      for (const i of p.inputs) lines.push(`  ${i.id}  ${i.ts}  ${quoted(i.text.length > 100 ? i.text.slice(0, 100) + '...' : i.text)}`);
    }
    if (p.acked) {
      lines.push(`Acknowledged inputs (${p.acked.length}):`);
      for (const a of p.acked) lines.push(`  ${a.input}  ${a.reason}  (${a.id})`);
    }
    if (!lines.length) lines.push('nothing pending');
    out(ctx, { ...p, unpublished: unpub.count, warnings }, [...lines, ...warnings.map((w) => `warning: ${w}`)]);
    return p.problems.length ? 1 : 0;
  },

  verify(ctx, flags, pos) {
    if (pos.length < 1) throw new UsageError('verify takes one record or input id');
    const id = pos[0];
    const v = R.verifyRecord(ctx.projectRoot, id, { refresh: ctx.refreshOnce });
    const rw = readWarnings(ctx, []);
    v.warnings = rw;
    if (ctx.json) { process.stdout.write(JSON.stringify(v) + '\n'); return v.ok ? 0 : 1; }
    const lines = [v.ok ? `VERIFIED ${id}` : `NOT VERIFIED ${id}: ${v.code}: ${v.error}`];
    for (const h of v.chain) {
      if (h.kind === 'input') {
        lines.push(`  ${h.id}  input (${h.source}, host ${h.host}, session ${h.session_id || 'unknown'}, ${h.ts})`);
        if (h.excerpt) lines.push(`    cited in context: ${quoted(h.excerpt)}`);
      } else {
        const body = h.kind === 'answer' ? `${h.answer} [${h.confidence}]` : (h.statement || h.text || h.reason || '');
        const via = h.under ? ` under ${h.under}` : '';
        lines.push(`  ${h.id}  ${h.kind}${via}${body ? `: ${body}` : ''} (by ${h.by && h.by.instance}, ${h.ts})`);
        if (h.grant) lines.push(`    GRANT: ${h.grant}`);
      }
    }
    for (const n of v.notes) lines.push(`  note: ${n}`);
    for (const c of v.chains) lines.push(`  ${c.chain}: heads: ${c.heads}${c.count !== undefined ? ` (${c.count} entries)` : ''}`);
    for (const c of v.chains.filter((x) => x.heads === 'absent')) {
      lines.push(`warning: no head was recorded for ${c.chain} on this host (trusted on first use); a deleted tail would not have been detected before now`);
    }
    for (const w of rw) lines.push(`warning: ${w}`);
    if (v.ok) {
      const seen = new Set();
      for (const h of v.chain.filter((x) => x.kind === 'input' && x.source === 'human')) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        const cite = v.chain.find((x) => x.quote && v.chain.indexOf(x) < v.chain.indexOf(h));
        if (h.text.length > 600 && cite) lines.push(`operator said (excerpt of ${h.id}, ${h.text.length} characters): ${quoted(h.excerpt || cite.quote)}`);
        else lines.push(`operator said: ${quoted(h.text)}`);
      }
    }
    process.stdout.write(lines.join('\n') + '\n');
    return v.ok ? 0 : 1;
  },

  show(ctx, flags, pos) {
    if (pos.length < 1) throw new UsageError('show takes one record or input id');
    const id = pos[0];
    let obj;
    if (id.startsWith('in-')) {
      obj = log.getInput(ctx.projectRoot, id) || (ctx.refreshOnce() && log.getInput(ctx.projectRoot, id)) || null;
      if (!obj) throw new R.OperatorError('not_found', `input ${id} was not found (operator.js refresh pulls other hosts; operator.js pending lists inputs)`);
      out(ctx, obj, [`${obj.id}  input (${obj.source})`, `host: ${obj.host}`, `session: ${obj.session_id}`, `instance: ${obj.instance} (${obj.role})`,
        `at: ${obj.ts} (captured ${obj.captured_at})`, `transcript: ${obj.transcript_ref && obj.transcript_ref.file}:${obj.transcript_ref && obj.transcript_ref.line}`,
        `text: ${quoted(obj.text)}`]);
      return 0;
    }
    obj = R.getRecord(ctx.projectRoot, id) || (ctx.refreshOnce() && R.getRecord(ctx.projectRoot, id)) || null;
    if (!obj) throw new R.OperatorError('not_found', `record ${id} was not found (operator.js refresh pulls other hosts; operator.js find lists records)`);
    const lines = [`${obj.id}  ${obj.kind}`, `by: ${obj.by && obj.by.instance} (${obj.by && obj.by.role}) at ${obj.ts}`];
    for (const k of ['statement', 'question', 'text', 'answer', 'confidence', 'rationale', 'reason']) if (obj[k]) lines.push(`${k}: ${obj[k]}`);
    if (obj.quote) {
      const cid = (obj.cites || []).find((c) => String(c).startsWith('in-'));
      const inp = cid ? log.getInput(ctx.projectRoot, cid) : null;
      lines.push(`operator quote: ${quoted((inp && R.excerptFor(inp.text, obj.quote)) || obj.quote)}`);
    }
    if (obj.grant) lines.push(`GRANT: ${obj.grant}`);
    if (obj.cites && obj.cites.length) lines.push(`cites: ${obj.cites.join(', ')}`);
    if (obj.under) lines.push(`under: ${obj.under}`);
    if (obj.target) lines.push(`target: ${obj.target}`);
    if (obj.limits) lines.push(`limits: until ${obj.limits.until || 'none'}, max uses ${obj.limits.max_uses || 'none'}`);
    const sc = Object.entries(obj.scope || {}).flatMap(([k, v]) => v.map((x) => `${k.slice(0, -1)}:${x}`));
    if (sc.length) lines.push(`scope: ${sc.join(', ')}`);
    if (obj.supersedes) lines.push(`supersedes: ${obj.supersedes}`);
    out(ctx, obj, lines);
    return 0;
  },
};

function main(argv) {
  if (!argv.length) { process.stderr.write(USAGE + '\n'); return 2; }
  const cmd = argv[0];
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { process.stdout.write(USAGE + '\n'); return 0; }
  if (!COMMANDS.includes(cmd)) { process.stderr.write(`operator.js: unknown command "${cmd}"\n${USAGE}\n`); return 2; }
  let ctx = { json: argv.includes('--json') };
  try {
    const { flags, pos } = parseArgs(argv.slice(1));
    ctx.json = !!flags.json;
    ctx = buildContext(flags);
    return handlers[cmd](ctx, flags, pos);
  } catch (err) {
    if (err instanceof UsageError) {
      if (ctx.json) process.stdout.write(JSON.stringify({ ok: false, code: 'usage', message: err.message }) + '\n');
      else process.stderr.write(`operator.js ${cmd}: ${err.message}\n`);
      return 2;
    }
    if (err instanceof R.OperatorError) {
      if (ctx.json) process.stdout.write(JSON.stringify({ ok: false, code: err.code, error: err.message }) + '\n');
      else process.stderr.write(`refused (${err.code}): ${err.message}\n`);
      return 1;
    }
    if (ctx.json) process.stdout.write(JSON.stringify({ ok: false, code: 'environment', message: String(err && err.message || err) }) + '\n');
    else process.stderr.write(`operator.js ${cmd}: ${err && err.message ? err.message : err}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, parseArgs, parseScope };
