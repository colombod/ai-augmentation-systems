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

function registerInstance(projectRoot, { instance, session_id, host, model, role_dir, now }) {
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
    writeRoster(projectRoot, roster);
    return roster;
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

module.exports = { readRoster, writeRoster, registerInstance, touchInstance, withRosterLock, ROSTER_REL };
