// scripts/lib/lock.js — a lock file taken with O_EXCL around a read-then-append, for the warnings
// ledger and the evidence files. A lock older than staleMs is broken. strict: on contention past
// waitMs, throw instead of running unlocked (evidence must never fork its chain); otherwise run
// unlocked (a duplicate warning is better than a lost one).
const fs = require('fs');
const path = require('path');

function withLock(lockFile, fn, { waitMs = 500, staleMs = 5000, strict = false } = {}) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const until = Date.now() + waitMs;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lockFile, 'wx'); } catch (err) {
      try { if (Date.now() - fs.statSync(lockFile).mtimeMs > staleMs) fs.unlinkSync(lockFile); } catch (e) { /* gone */ }
      if (Date.now() > until) {
        if (strict) throw new Error(`${path.basename(lockFile)} is held by another writer; retry in a moment`);
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(lockFile); } catch (e) { /* gone */ } } }
}

module.exports = { withLock };
