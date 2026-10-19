// scripts/lib/roster.js — .delivery/team/roster.json: which session holds which role instance.
const fs = require('fs');
const path = require('path');

const ROSTER_REL = path.join('.delivery', 'team', 'roster.json');
const LOCK_STALE_MS = 10 * 1000;
const LOCK_TIMEOUT_MS = 2 * 1000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRoster(projectRoot) {
  const file = path.join(projectRoot, ROSTER_REL);
  if (!fs.existsSync(file)) return { instances: {} };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  } catch (err) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, aside); } catch (e) { /* another process moved it already */ }
    return { instances: {}, recovered_from: aside };
  }
  if (!parsed.instances) parsed.instances = {};
  return parsed;
}

function writeRoster(projectRoot, roster) {
  const file = path.join(projectRoot, ROSTER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const { recovered_from, ...clean } = roster;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function withRosterLock(projectRoot, fn) {
  const lock = `${path.join(projectRoot, ROSTER_REL)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const start = Date.now();
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch (e) { continue; }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lock); } catch (e) { /* lost the race; retry */ }
        continue;
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error('roster: lock timeout');
      sleepSync(20 + Math.floor(Math.random() * 30));
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(lock); } catch (e) { /* ignore */ }
  }
}

function registerInstance(projectRoot, { instance, session_id, host, model, role_dir, now, transcript_path }) {
  return withRosterLock(projectRoot, () => {
    const roster = readRoster(projectRoot);
    const existing = roster.instances[instance] || {};
    roster.instances[instance] = {
      session_id,
      host,
      model,
      role_dir,
      joined_at: existing.joined_at || now,
      last_seen: now,
    };
    // the capture hook may have recorded this session's transcript first: keep it for the same session
    if (typeof transcript_path === 'string' && transcript_path) roster.instances[instance].transcript_path = transcript_path;
    else if (existing.transcript_path && existing.session_id === session_id) roster.instances[instance].transcript_path = existing.transcript_path;
    writeRoster(projectRoot, roster);
    return roster;
  });
}

// Record where this instance's session transcript lives (operator.js sync --all reads it).
// Writes only when something changed. An instance not registered yet is left to registerInstance
// (SessionStart), which records the transcript with the full entry; returns false then.
function setTranscriptPath(projectRoot, { instance, session_id, transcript_path }) {
  const cur = readRoster(projectRoot).instances[instance];
  if (!cur) return false;
  if (cur.transcript_path === transcript_path && (!session_id || cur.session_id === session_id)) return false;
  return withRosterLock(projectRoot, () => {
    const roster = readRoster(projectRoot);
    const existing = roster.instances[instance];
    if (!existing) return false;
    existing.transcript_path = transcript_path;
    if (session_id) existing.session_id = session_id;
    writeRoster(projectRoot, roster);
    return true;
  });
}

// Where a session's own id and transcript are kept in its role directory: .delivery-session and
// .delivery-transcript for the owner's session; a watchdog fork (DELIVERY_WAKE=fork with its
// DELIVERY_WAKE_ID) has its own pair, so its records, syncs and acks are its own (Copilot 583).
function sessionLocator(roleDir, env = process.env) {
  const id = env && env.DELIVERY_WAKE === 'fork' && /^[A-Za-z0-9-]{1,64}$/.test(String(env.DELIVERY_WAKE_ID || '')) ? env.DELIVERY_WAKE_ID : null;
  const tag = id ? `.fork-${id}` : '';
  return { fork: Boolean(id), session: path.join(roleDir, `.delivery-session${tag}`), transcript: path.join(roleDir, `.delivery-transcript${tag}`) };
}

// A copy of an open session the watchdog started (`--fork-session`, DELIVERY_WAKE=fork) is recorded
// beside the instance, never in its place: the owner's open session stays the one the roster reads.
// Copies older than a day are dropped from the list (their transcripts stay on disk).
const FORK_KEEP_MS = 24 * 3600e3;
function recordFork(projectRoot, { instance, session_id, transcript_path, now }) {
  return withRosterLock(projectRoot, () => {
    const roster = readRoster(projectRoot);
    const cur = roster.instances[instance];
    if (!cur) return false;
    const t = Date.parse(now || new Date().toISOString());
    const forks = (Array.isArray(cur.forks) ? cur.forks : []).filter((f) => f && f.session_id !== session_id && t - Date.parse(f.at) < FORK_KEEP_MS);
    forks.push({ session_id, ...(transcript_path ? { transcript_path } : {}), at: now || new Date(t).toISOString() });
    cur.forks = forks;
    writeRoster(projectRoot, roster);
    return true;
  });
}

function touchInstance(projectRoot, { instance, now }) {
  return withRosterLock(projectRoot, () => {
    const roster = readRoster(projectRoot);
    if (!roster.instances[instance]) return roster;
    roster.instances[instance].last_seen = now;
    writeRoster(projectRoot, roster);
    return roster;
  });
}

module.exports = { sessionLocator, recordFork, readRoster, writeRoster, registerInstance, touchInstance, setTranscriptPath, withRosterLock, ROSTER_REL };
