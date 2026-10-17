#!/usr/bin/env node
// scripts/operator.js — the operator CLI: capture, record, verify and carry the operator's decisions.
//
// Exit codes: 0 ok; 1 refused or not verified; 2 usage or environment error.
// Every command accepts --project <root> and --json. Write commands require a valid role marker
// (prepare-role writes it and DELIVERY_ROLE names the instance) and end with a best-effort publish.
const fs = require('fs');
const path = require('path');
const { findProjectRoot, expandInstances, loadManifest, canonicalRoleId } = require('./lib/manifest.js');
const { findRoleMarker, validMarker, bdOptionsFor } = require('../hooks/scripts/role-context.js');
const { makeBd } = require('./lib/bd.js');
const { readRoster } = require('./lib/roster.js');
const transcript = require('./lib/transcript.js');
const log = require('./lib/operator-log.js');
const R = require('./lib/operator-records.js');

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['json', 'force', 'all', 'format-check', 'help', 'pending']);
const COMMANDS = ['publish', 'refresh', 'sync', 'record', 'delegate', 'decide', 'revoke', 'ack', 'ask', 'withdraw', 'answer', 'ratify',
  'find', 'ledger', 'pending', 'verify', 'show', 'problems', 'quarantine', 'repair', 'rehost'];

const USAGE = `usage: operator.js <command> [options]   (all commands: --project <root> --json)
  sync [--all] [--format-check]   (--transcript <path> and --session <id> are refused in role lanes: capture reads the session's own transcript)
  record --cite in-N --quote "<exact words>" --statement "<what was decided>" [--scope bead:ID,label:L,initiative:I] [--answers q-N] [--supersedes ID]
  delegate --cite in-N --quote "<...>" --statement "<...>" --grant "<one sentence: what is delegated>" --scope ... [--until DATE] [--max-uses N] [--answers q-N]
  decide --under del-N --statement "<...>" --scope ... [--answers q-N]
  revoke --cite in-N --quote "<...>" --target ID
  ack --input in-N --reason "<why this input is not a decision>"
  ack --pending --reason 'conversational'   every pending input of this session that may not answer an open question
  ask --text "<question>" --asker <instance> [--bead ID] [--options "A|B"] [--recommendation "<...>"] [--scope ...]
  withdraw --question q-N --reason "<...>"
  answer --cite dec-N[,del-M,...] --question "<...>" --answer "<...>" --confidence settled|inferred [--rationale "<...>"] [--scope ...] [--answers q-N] [--supersedes ID]
  ratify --cite in-N --quote "<...>" --target ans-N|del-N
  find [--scope ...] [--text "<words>"] [--all]
  ledger [--bead ID] [--status open|answered|withdrawn]
  pending [--since 24h] [--all]
  verify <id>        show <id>
  problems           everything that is excluded, diverged or unpublished (exit 1 when state is affected)
  rehost --instance <i> --reason "<why it moved>" [--to-host H] [--to-machine M]   record that an instance moved host or machine
  quarantine --file records/<i>.ndjson --reason "<...>"   (chief of staff) set a failing chain aside as evidence
  repair --instance <i>   repair a torn tail of that instance's own chain (the partial line is kept as evidence)
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
  let markerError = null;
  let found = null;
  try { found = findRoleMarker(cwd); } catch (e) { found = null; }
  try { valid = validMarker(found); } catch (e) { valid = null; markerError = e; }
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
    markerError,
  };
  // a role session whose project manifest does not load (or no longer lists it): say what to restore
  if (!valid && found && found.marker && process.env.DELIVERY_ROLE === found.marker.instance) {
    let team = null;
    try { team = loadManifest(projectRoot).team; } catch (e) { team = null; }
    let instances = [];
    try { instances = team ? expandInstances(team) : []; } catch (e) { instances = []; }
    if (!instances.length) ctx.manifestUnavailable = true;
    else if (!instances.some((i) => i.instance === found.marker.instance)) ctx.unknownInstance = found.marker.instance;
  }
  if (ctx.by) {
    if (ctx.host) ctx.by.host = ctx.host;
    ctx.by.machine = R.machineId();
  }
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
  // Without DELIVERY_ROLE_DIR the marker is found by walking up from the working directory, which can
  // be another role's tree: a writer fails closed rather than record under the wrong instance.
  if (process.env.DELIVERY_ROLE && !process.env.DELIVERY_ROLE_DIR) {
    throw new R.OperatorError('role_dir_unset', `DELIVERY_ROLE is set (${process.env.DELIVERY_ROLE}) but DELIVERY_ROLE_DIR is not, so this session's own role marker cannot be told apart from one found above the working directory; nothing is recorded. Start the session through prepare-role (it sets both), or export DELIVERY_ROLE_DIR=<this role's directory> and retry. Reading (verify, show, pending, find, ledger) works anywhere`);
  }
  if (ctx.by && ctx.projectFlag && real(ctx.projectFlag) !== real(ctx.valid.marker.project_root)) {
    throw new R.OperatorError('project_mismatch', `--project ${ctx.projectFlag} is not the project of this role (${ctx.valid.marker.project_root}); records are written to the role's own project only. Drop --project`);
  }
  if (!ctx.by && ctx.manifestUnavailable) {
    throw new R.OperatorError('manifest_unavailable', '.delivery/team/team.json cannot be loaded or lists no instances, so this session cannot be attributed to a role and nothing is recorded; restore .delivery/team/team.json (for example git checkout -- .delivery/team/team.json)');
  }
  if (!ctx.by && ctx.unknownInstance) {
    throw new R.OperatorError('unknown_instance', `instance ${ctx.unknownInstance} is not in .delivery/team/team.json, so nothing is recorded from this session; restore .delivery/team/team.json or ask the chief of staff to add the instance`);
  }
  if (ctx.valid && ctx.valid.role && ctx.valid.role.retired) {
    throw new R.OperatorError('retired_instance', `instance ${ctx.by.instance} is retired in .delivery/team/team.json; its records stay verifiable but it records nothing new. Record from a live instance, or ask the chief of staff`);
  }
  if (!ctx.by) {
    throw new R.OperatorError('not_allowed', 'no valid role marker for this session, so nothing can be recorded here; run operator.js from a delivery role session (prepare-role writes the marker and sets DELIVERY_ROLE). Reading (verify, show, pending, find, ledger) works anywhere');
  }
}

const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };

// Writing on stale state could ignore a revocation made on another host: refuse unless the
// refresh worked (or there is no remote to be stale against).
function divergedOwn(ctx) {
  const r = ctx.refreshResult;
  if (!r || !r.diverged || !r.diverged.length) return [];
  const own = [];
  if (ctx.instance) own.push(`.delivery/operator/records/${ctx.instance}.ndjson`);
  const inputs = ctx.host ? `.delivery/operator/inputs/${log.safeHost(ctx.host)}/` : null;
  return r.diverged.filter((p) => own.includes(p) || (inputs && p.startsWith(inputs)));
}

// every writer: a diverged own chain refuses before anything is appended (a failed fetch does not)
function needNotDiverged(ctx) {
  ctx.refreshOnce();
  const dv = divergedOwn(ctx);
  if (dv.length) {
    throw new R.OperatorError('chain_diverged', `${dv.join(', ')} differs from the upstream copy: another writer appended to a chain only this instance should (a forked instance or a second clone). Nothing more is written to it. Tell the chief of staff; operator.js problems lists it, and operator.js quarantine --file records/<instance>.ndjson (or inputs/<host>/<YYYY-MM>.ndjson) sets the fork aside. One working copy per host label is assumed`);
  }
}

function needFresh(ctx) {
  const r = ctx.refreshOnce();
  const dv = divergedOwn(ctx);
  if (dv.length) {
    throw new R.OperatorError('chain_diverged', `${dv.join(', ')} differs from the upstream copy: another writer appended to a chain only this instance should (a forked instance or a second clone). Nothing more is written to it. Tell the chief of staff; operator.js problems lists it, and operator.js quarantine --file records/<instance>.ndjson (or inputs/<host>/<YYYY-MM>.ndjson) sets the fork aside. One working copy per host label is assumed: two clones writing as the same instance or host fork its chain`);
  }
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
  for (const p of problems || []) w.push(p.code === 'manifest_unavailable' ? `manifest_unavailable: ${p.error}` : p.id ? `${p.id} (${p.file}${p.line ? ':' + p.line : ''}) is excluded: ${p.error}` : `${p.file} fails verification: ${p.error}`);
  return w;
}

// with no usable manifest nothing is trusted: an empty answer is not "nothing found"
function manifestUnavailable(problems) { return (problems || []).some((p) => p.code === 'manifest_unavailable'); }

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function cursorStatus(projectRoot, sessionId) {
  try {
    const f = path.join(log.opDir(projectRoot), 'cursors', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    return transcript.formatStatus(JSON.parse(fs.readFileSync(f, 'utf8')));
  } catch (e) { return 'ok'; }
}

// The transcript the capture hook registered for this session: <roleDir>/.delivery-transcript, else the
// roster entry of this instance.
function registeredTranscript(ctx) {
  if (!ctx.roleDir) return null;
  try {
    const t = fs.readFileSync(path.join(ctx.roleDir, '.delivery-transcript'), 'utf8').trim();
    if (t) return t;
  } catch (e) { /* fall back to the roster */ }
  try {
    const e = (readRoster(ctx.projectRoot).instances || {})[ctx.instance];
    return e && typeof e.transcript_path === 'string' && e.transcript_path ? e.transcript_path : null;
  } catch (e) { return null; }
}

// Inputs are captured from the calling session's own transcript only (spec 8.6): --transcript must be
// the transcript registered for this session, and --session this session's own id.
function checkOwnSyncFlags(ctx, flags) {
  const how = 'run operator.js sync without --transcript or --session: the capture hook registers this session\'s transcript, and sync reads it';
  if (flags.transcript !== undefined) {
    const mine = registeredTranscript(ctx);
    if (!mine || real(path.resolve(String(flags.transcript))) !== real(mine)) {
      throw new R.OperatorError('transcript_not_own', `--transcript ${flags.transcript} is not this session's own transcript${mine ? '' : ' (none is registered yet)'}; operator inputs are captured from the calling session's own transcript only. ${how}`);
    }
  }
  if (flags.session !== undefined && ctx.by) {
    if (ctx.by.session_id === 'unknown' || String(flags.session) !== ctx.by.session_id) {
      throw new R.OperatorError('transcript_not_own', `--session ${flags.session} is not this session's own id; operator inputs are captured from the calling session's own transcript only. ${how}`);
    }
  }
}

function transcriptPathFor(ctx, flags) {
  checkOwnSyncFlags(ctx, flags);
  if (flags.transcript) return path.resolve(flags.transcript);
  return registeredTranscript(ctx);
}

function syncOne(ctx, { transcriptPath, sessionId, instance, role, roleSince }) {
  return log.syncTranscript({ projectRoot: ctx.projectRoot, transcriptPath, sessionId, instance, role, host: ctx.host, roleSince });
}

// Sync this session's transcript; when `cite` is not found yet, retry for up to 2 s (the transcript
// can lag the hook), and for another host's input refresh once instead.
function syncCurrent(ctx, flags, cite) {
  const tr = transcriptPathFor(ctx, flags);
  let res = { added: 0, status: 'ok' };
  const sid = flags.session || (ctx.by.session_id !== 'unknown' ? ctx.by.session_id : (tr ? path.basename(tr).replace(/\.jsonl$/, '') : 'unknown'));
  const doSync = () => {
    if (!tr || !fs.existsSync(tr)) return;
    const r = syncOne(ctx, { transcriptPath: tr, sessionId: sid, instance: ctx.by.instance, role: ctx.by.role, roleSince: (() => { const b = log.roleBoundary(ctx.roleDir, sid); return b.created ? null : b.since; })() });
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
  // LEDGER.md is derived: regenerate it only on current state (a refresh in this command worked) and clean chains
  const ledgerNotes = [];
  try {
    const fr = ctx.refreshOnce();
    if (fr && !fr.ok && !fr.no_remote) ledgerNotes.push('LEDGER.md was not regenerated: this command could not refresh from the remote');
    else if (R.viewProblems(ctx.projectRoot).length) ledgerNotes.push('LEDGER.md was not regenerated: a chain or record fails validation (operator.js problems)');
    else R.writeLedger(ctx.projectRoot);
  } catch (e) { /* best effort */ }
  extra = { ...extra, warnings: [...(extra.warnings || []), ...ledgerNotes] };
  const pub = log.publish(ctx.projectRoot, { force: true, host: ctx.host, instance: ctx.instance });
  const published = !!pub.published;
  const warnings = [...(extra.warnings || []), ...ctx.warnings];
  const r = ctx.refreshResult;
  if (r && r.diverged && r.diverged.length) warnings.push(`diverged: ${r.diverged.join(', ')} differ from the upstream copy; another writer appended to a file only this one should (a forked instance)`);
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

// ack --pending: one command for the conversational inputs of this session. An input captured after
// the oldest open question may be the operator's answer to it, so it is left for a record (or an
// explicit ack by id) and named in the output.
function ackPending(ctx, flags) {
  need(flags, 'reason');
  if (flags.input) throw new UsageError('--pending acks every pending input of this session; drop --input, or drop --pending to ack one');
  requireWriter(ctx);
  needNotDiverged(ctx);
  syncCurrent(ctx, flags, null);
  const sid = ctx.by.session_id;
  const p = R.pending(ctx.projectRoot, { sessionId: sid !== 'unknown' ? sid : undefined, refresh: ctx.refreshOnce, noLedger: true });
  const mine = (p.inputs || []).filter((e) => e.session_id === sid && e.instance === ctx.by.instance);
  const openTs = (p.open_questions || []).map((q) => Date.parse(q.ts)).filter((t) => !Number.isNaN(t));
  const firstOpen = openTs.length ? Math.min(...openTs) : null;
  const acked = [];
  const kept = [];
  for (const e of mine) {
    if (firstOpen !== null && Date.parse(e.ts) > firstOpen) { kept.push(e.id); continue; }
    acked.push(R.ack({ projectRoot: ctx.projectRoot, input: e.id, reason: flags.reason, by: ctx.by, refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning }).id);
  }
  if (acked.length) { try { R.writeLedger(ctx.projectRoot); } catch (e) { /* best effort */ } }
  const pub = acked.length ? log.publish(ctx.projectRoot, { force: true, host: ctx.host, instance: ctx.instance }) : { published: false, reason: 'nothing written' };
  const lines = [acked.length ? `acked ${acked.length}: ${acked.join(', ')}` : 'nothing to ack'];
  if (kept.length) lines.push(`left pending (said after an open question was asked, so it may be its answer): ${kept.join(', ')}; record it with --answers q-..., or ack it by id`);
  if (acked.length) lines.push(pub.published ? 'published' : `unpublished (${pub.reason || 'not pushed'})`);
  out(ctx, { ok: true, acked, kept, published: !!pub.published, warnings: ctx.warnings }, lines);
  return 0;
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
    const lines = [r.ok ? `refreshed (${(r.updated || []).length} files)` : (r.no_remote ? `nothing to refresh (${r.reason}; single-host project)` : `not refreshed (${r.reason})`)];
    if (r.diverged && r.diverged.length) lines.push(`warning: diverged: ${r.diverged.join(', ')} differ from the upstream copy; another writer appended to a file only this one should (a forked instance)`);
    out(ctx, r, lines);
    return r.ok || r.no_remote ? 0 : 1;
  },

  sync(ctx, flags) {
    requireWriter(ctx);
    checkOwnSyncFlags(ctx, flags);
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
    needNotDiverged(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    if (flags.supersedes) needFresh(ctx);
    const rec = R.recordDecision({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, statement: flags.statement, scope,
      by: ctx.by, answers: csv(flags.answers), supersedes: flags.supersedes || null, refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning });
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
    needNotDiverged(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    const rec = R.recordDelegation({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, statement: flags.statement, scope,
      grant: flags.grant, limits: { until: flags.until || null, max_uses: maxUses }, by: ctx.by, answers: csv(flags.answers), refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  decide(ctx, flags) {
    need(flags, 'under', 'statement');
    const scope = parseScope(flags.scope);
    requireWriter(ctx);
    needNotDiverged(ctx);
    needFresh(ctx);
    const under = R.getRecord(ctx.projectRoot, flags.under) || (ctx.refreshOnce() && R.getRecord(ctx.projectRoot, flags.under));
    if (under) refuseIfFormatUnrecognised(ctx, null, (under.cites || [])[0]);
    const rec = R.decideUnder({ projectRoot: ctx.projectRoot, under: flags.under, statement: flags.statement, scope, by: ctx.by,
      answers: csv(flags.answers), refresh: ctx.refreshOnce, noLedger: true });
    const warnings = bdNotes(ctx, rec.scope.beads, `DECISION ${rec.id} (under ${rec.under}): ${rec.statement}`);
    return afterWrite(ctx, rec, { warnings });
  },

  revoke(ctx, flags) {
    need(flags, 'cite', 'quote', 'target');
    requireWriter(ctx);
    needNotDiverged(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    needFresh(ctx);
    const rec = R.revoke({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, target: flags.target, by: ctx.by, refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  ack(ctx, flags) {
    if (flags.pending) return ackPending(ctx, flags);
    need(flags, 'input', 'reason');
    requireWriter(ctx);
    needNotDiverged(ctx);
    syncCurrent(ctx, flags, flags.input);
    const rec = R.ack({ projectRoot: ctx.projectRoot, input: flags.input, reason: flags.reason, by: ctx.by, refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning });
    return afterWrite(ctx, rec);
  },

  ask(ctx, flags) {
    need(flags, 'text', 'asker');
    flags.asker = canonicalRoleId(flags.asker); // delivery-manager is the display name of delivery-lead
    const scope = parseScope(flags.scope);
    if (flags.bead && !scope.beads.includes(flags.bead)) scope.beads.push(flags.bead);
    requireWriter(ctx);
    needNotDiverged(ctx);
    let role = null;
    try { const f = expandInstances(ctx.valid.team).find((i) => i.instance === flags.asker); role = f ? f.role.id : null; } catch (e) { role = null; }
    const rec = R.recordQuestion({ projectRoot: ctx.projectRoot, text: flags.text, asker: { instance: flags.asker, role, bead: flags.bead || null },
      scope, options: flags.options ? flags.options.split('|').map((s) => s.trim()).filter(Boolean) : [],
      recommendation: flags.recommendation || null, by: ctx.by, noLedger: true });
    return afterWrite(ctx, rec);
  },

  withdraw(ctx, flags) {
    need(flags, 'question', 'reason');
    requireWriter(ctx);
    needNotDiverged(ctx);
    const rec = R.withdraw({ projectRoot: ctx.projectRoot, question: flags.question, reason: flags.reason, by: ctx.by, refresh: ctx.refreshOnce, noLedger: true });
    return afterWrite(ctx, rec);
  },

  answer(ctx, flags) {
    need(flags, 'cite', 'question', 'answer', 'confidence');
    const scope = parseScope(flags.scope);
    requireWriter(ctx);
    needNotDiverged(ctx);
    needFresh(ctx);
    const rec = R.recordAnswer({ projectRoot: ctx.projectRoot, cites: csv(flags.cite), question: flags.question, answer: flags.answer,
      confidence: flags.confidence, rationale: flags.rationale, scope, by: ctx.by, answers: csv(flags.answers),
      supersedes: flags.supersedes || null, refresh: ctx.refreshOnce, noLedger: true });
    return afterWrite(ctx, rec);
  },

  ratify(ctx, flags) {
    need(flags, 'cite', 'quote', 'target');
    requireWriter(ctx);
    needNotDiverged(ctx);
    const s = syncCurrent(ctx, flags, flags.cite);
    refuseIfFormatUnrecognised(ctx, s, flags.cite);
    needFresh(ctx);
    const rec = R.ratify({ projectRoot: ctx.projectRoot, cite: flags.cite, quote: flags.quote, target: flags.target, by: ctx.by, refresh: ctx.refreshOnce, noLedger: true, onWarning: ctx.onWarning });
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
    const res = R.find(ctx.projectRoot, { scope: parseScope(flags.scope), text: flags.text, all: !!flags.all, refresh: ctx.refreshOnce, noLedger: true });
    const warnings = readWarnings(ctx, res.problems);
    const lines = res.length ? res.map((r) => {
      const sc = Object.entries(r.scope || {}).flatMap(([k, v]) => v.map((x) => `${k.slice(0, -1)}:${x}`)).join(',');
      const extra = [r.confidence ? `[${r.confidence}${r.ratified === true ? ', ratified' : ''}]` : '', sc ? `scope ${sc}` : '', r.superseded_by ? `superseded by ${r.superseded_by}` : ''].filter(Boolean).join(' ');
      return `${r.id} ${r.kind}${extra ? ' ' + extra : ''}: ${r.statement}${r.quote ? ` (operator: ${quoted(r.quote)})` : ''}${r.grant ? ` GRANT: ${r.grant}` : ''}`;
    }) : ['nothing found'];
    out(ctx, { results: [...res], problems: res.problems, warnings }, [...lines, ...warnings.map((w) => `warning: ${w}`)]);
    return manifestUnavailable(res.problems) ? 1 : 0;
  },

  ledger(ctx, flags) {
    if (flags.status && !['open', 'answered', 'withdrawn'].includes(flags.status)) throw new UsageError('--status must be open, answered or withdrawn');
    ctx.refreshOnce();
    const o = { bead: flags.bead, status: flags.status, since: parseSince(flags.since), refresh: ctx.refreshOnce, noLedger: true };
    const rows = R.ledger(ctx.projectRoot, o);
    const warnings = readWarnings(ctx, rows.problems);
    const code = manifestUnavailable(rows.problems) ? 1 : 0;
    if (ctx.json) { process.stdout.write(JSON.stringify({ rows: [...rows], problems: rows.problems, warnings }) + '\n'); return code; }
    process.stdout.write(R.renderLedger(ctx.projectRoot, o) + warnings.map((w) => `warning: ${w}\n`).join(''));
    return code;
  },

  pending(ctx, flags) {
    const since = parseSince(flags.since);
    ctx.refreshOnce();
    const p = R.pending(ctx.projectRoot, { since, all: !!flags.all, refresh: ctx.refreshOnce, noLedger: true });
    const dv = divergedOwn(ctx);
    for (const d of dv) p.problems.push({ file: d, code: 'chain_diverged', error: `${d} differs from the upstream copy (another writer appended to it)` });
    const warnings = readWarnings(ctx, p.problems);
    const lines = [];
    // ids handed out must be visible to other hosts: say so when this host cannot push
    let unpub = { count: 0 };
    if (ctx.by) {
      const pub = log.publish(ctx.projectRoot, { host: ctx.host, instance: ctx.instance });
      unpub = log.unpublished(ctx.projectRoot, { host: ctx.host, instance: ctx.instance });
      const why = pub.published ? 'push in progress' : (pub.reason === 'throttled' ? (log.lastPublishReason(ctx.projectRoot) || 'not pushed yet') : (pub.reason || unpub.reason));
      if (unpub.count > 0) lines.push(`unpublished local records: ${unpub.count} (${why})`);
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
    const v = R.verifyRecord(ctx.projectRoot, id, { refresh: ctx.refreshOnce, noLedger: true });
    const dvp = divergedOwn(ctx).map((d) => ({ file: d, code: 'chain_diverged', error: `${d} differs from the upstream copy (another writer appended to it)` }));
    const rw = readWarnings(ctx, dvp);
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
        const b = h.by || {};
        lines.push(`  ${h.id}  ${h.kind}${via}${body ? `: ${body}` : ''} (by ${b.instance} [${b.role}] host ${b.host || '?'} machine ${b.machine || '?'} session ${b.session_id || 'unknown'}, ${h.ts})`);
        if (h.kind === 'answer' && h.confidence === 'inferred') {
          lines.push(h.ratified_by ? `    ratified by ${h.ratified_by.id} (operator said ${quoted(h.ratified_by.said || '')})` : '    unratified');
        }
        if (h.grant) lines.push(`    GRANT: ${h.grant}`);
        if (h.kind === 'answer' && h.question) lines.push(`    question: ${quoted(h.question)}`);
        for (const q of h.answers_questions || []) {
          const when = q.ts ? ` (asked ${q.ts}${q.minutes_before_answer !== undefined ? `, ${q.minutes_before_answer} minutes before the answer` : ''})` : '';
          lines.push(`    answers ${q.id}: ${q.text ? quoted(q.text) : '(question not found)'}${when}`);
        }
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

  problems(ctx) {
    ctx.refreshOnce();
    const p = R.viewProblems(ctx.projectRoot);
    for (const d of divergedOwn(ctx)) p.push({ file: d, code: 'chain_diverged', error: `${d} differs from the upstream copy (another writer appended to it)` });
    const lines = p.length ? p.map((x) => `${x.id ? x.id + ' ' : ''}${x.file}${x.line ? ':' + x.line : ''}  ${x.code}  ${x.error}`) : ['no problems'];
    const extra = readWarnings(ctx, []);
    out(ctx, { problems: p, warnings: extra }, [...lines, ...extra.map((w) => `warning: ${w}`)]);
    return p.length ? 1 : 0;
  },

  quarantine(ctx, flags) {
    need(flags, 'file', 'reason');
    requireWriter(ctx);
    const r = R.quarantine({ projectRoot: ctx.projectRoot, file: flags.file, reason: flags.reason, by: ctx.by });
    out(ctx, { ok: true, ...r }, [`quarantined: ${r.moved_to}`]);
    return 0;
  },

  repair(ctx, flags) {
    need(flags, 'instance');
    requireWriter(ctx);
    const r = R.repairChain({ projectRoot: ctx.projectRoot, instance: flags.instance, by: ctx.by });
    out(ctx, { ok: true, ...r }, [r.repaired ? `repaired records/${flags.instance}.ndjson (${r.entries} entries kept; the partial tail is saved as .partial-*)` : `records/${flags.instance}.ndjson needs no repair`]);
    return 0;
  },

  rehost(ctx, flags) {
    need(flags, 'instance', 'reason');
    requireWriter(ctx);
    needNotDiverged(ctx);
    const rec = R.recordRehost({ projectRoot: ctx.projectRoot, instance: flags.instance, reason: flags.reason, by: ctx.by,
      to: flags['to-host'] ? { host: flags['to-host'], machine: flags['to-machine'] || null } : null, noLedger: true });
    return afterWrite(ctx, rec);
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
    // the record is displayed as stored; its words count as the operator's only if it validates
    const v = R.verifyRecord(ctx.projectRoot, id, { refresh: ctx.refreshOnce, noLedger: true });
    const validity = v.ok ? { ok: true } : { ok: false, code: v.code, error: v.error };
    const lines = [`${obj.id}  ${obj.kind}`, v.ok ? 'validity: valid' : `validity: invalid (${v.code}): ${v.error}`,
      `by: ${obj.by && obj.by.instance} (${obj.by && obj.by.role}) at ${obj.ts}`];
    for (const k of ['statement', 'question', 'text', 'answer', 'confidence', 'rationale', 'reason']) if (obj[k]) lines.push(`${k}: ${obj[k]}`);
    if (obj.quote && !v.ok) lines.push("quote: withheld, the record does not validate (the raw record is in --json)");
    if (obj.quote && v.ok) {
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
    out(ctx, { ...obj, validity }, lines);
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
