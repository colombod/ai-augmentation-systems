// Preloaded with `node --require` (run-tests.js --clock <iso>): moves this process's clock by
// TEST_CLOCK_OFFSET_MS, so the suite runs as if started at that instant.
//
// Why: the operator log names its shards after the current month, and a test that wrote a month into
// a path passed for a whole month and then failed on every branch at once on the 1st. Running the
// suite with the clock in another month finds that class of test the day it is written, not the day
// the month turns. One offset for every process, fixed by the runner (not a frozen instant, and not an
// instant each process starts at), keeps time moving forward across the processes a test spawns;
// NODE_OPTIONS carries the preload into every node child process the tests spawn. File times are
// shifted the same way (the kernel stamps them with the real clock), or every lock, cache and
// staleness check would see each file it just wrote as months old.
'use strict';
const offset = Number(process.env.TEST_CLOCK_OFFSET_MS);
if (process.env.TEST_CLOCK_OFFSET_MS && Number.isFinite(offset)) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() { return RealDate.now() + offset; }
  }
  // Date() called as a function returns a string of the current time
  const fake = new Proxy(FakeDate, { apply: () => new FakeDate().toString() });
  globalThis.Date = fake;

  const fs = require('fs');
  const TIMES = ['atime', 'mtime', 'ctime', 'birthtime'];
  const shift = (st) => {
    if (!st || typeof st.mtimeMs !== 'number') return st; // bigint stats are left as they are
    for (const t of TIMES) {
      const ms = st[`${t}Ms`] + offset;
      Object.defineProperty(st, `${t}Ms`, { value: ms, writable: true, enumerable: true, configurable: true });
      Object.defineProperty(st, t, { value: new RealDate(ms), writable: true, enumerable: true, configurable: true });
    }
    return st;
  };
  for (const name of ['statSync', 'lstatSync', 'fstatSync']) {
    const real = fs[name];
    fs[name] = function (...args) { return shift(real.apply(this, args)); };
  }
  for (const name of ['stat', 'lstat', 'fstat']) {
    const real = fs[name];
    fs[name] = function (...args) {
      const cb = args[args.length - 1];
      if (typeof cb !== 'function') return real.apply(this, args);
      return real.apply(this, [...args.slice(0, -1), (err, st) => cb(err, err ? st : shift(st))]);
    };
    const realP = fs.promises[name];
    if (realP) fs.promises[name] = async function (...args) { return shift(await realP.apply(this, args)); };
  }
  // a time a test sets is on the shifted clock; the kernel stores the real one
  const unshift = (t) => (t instanceof RealDate ? new RealDate(t.getTime() - offset)
    : typeof t === 'number' ? t - offset / 1000
    : typeof t === 'string' && Number.isFinite(Number(t)) ? Number(t) - offset / 1000 : t);
  for (const name of ['utimesSync', 'lutimesSync', 'futimesSync']) {
    const real = fs[name];
    if (real) fs[name] = function (p, a, m) { return real.call(this, p, unshift(a), unshift(m)); };
  }
  for (const name of ['utimes', 'lutimes', 'futimes']) {
    const real = fs[name];
    if (real) fs[name] = function (p, a, m, cb) { return real.call(this, p, unshift(a), unshift(m), cb); };
    const realP = fs.promises[name];
    if (realP) fs.promises[name] = function (p, a, m) { return realP.call(this, p, unshift(a), unshift(m)); };
  }
}
