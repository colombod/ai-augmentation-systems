// scripts/lib/kick.js — the event that starts a watchdog run now, not at the next timer pass (hjx.1.3).
// A handoff queued at 07:25 was delivered at 07:39, by the next 15-minute pass: the watchdog read the
// record only on its timer. Each writer of a handover (a message kept for a role that is not running,
// lib/inbox.js; a step a merge or a deploy hands on, lib/handoff.js) and each wake that ends
// (lib/wake-run.js: what it held back may now go) drops one file in this directory. The host job
// watches it: a systemd path unit (DirectoryNotEmpty) or launchd's QueueDirectories starts a run as soon
// as it is not empty, and the run takes the files before it reads the record. Both are level-triggered:
// a kick dropped while a run is going starts another run when that one ends, so none is lost. cron
// cannot watch a directory; there a kick waits for the next pass, as before. Host-local, under the
// watchdog's git-ignored directory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REL = path.join('.delivery', 'watchdog', 'kicks');
const dirOf = (root) => path.join(root, REL);

// Drop one kick in `dir`; best effort, never throws: a kick that cannot be written leaves the handover
// to the timer pass, which still finds it.
function kickIn(dir, why) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ig = path.join(path.dirname(dir), '.gitignore');
    if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
    const name = `${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    // written aside and renamed in: a run never takes a half-written kick
    fs.writeFileSync(path.join(dir, `.${name}.tmp`), `${new Date().toISOString()} ${String(why || '').slice(0, 200)}\n`);
    fs.renameSync(path.join(dir, `.${name}.tmp`), path.join(dir, name));
    return true;
  } catch (err) { return false; }
}
const kick = (root, why) => kickIn(dirOf(root), why);

const names = (root) => { try { return fs.readdirSync(dirOf(root)).filter((f) => !f.startsWith('.')); } catch (err) { return []; } };
const waiting = (root) => names(root).length;

// Take every kick there is: the reasons, oldest first. Each is removed, so the watched directory empties
// and the scheduler does not start the run again for the same kicks.
function take(root) {
  const out = [];
  for (const f of names(root).sort()) {
    const p = path.join(dirOf(root), f);
    try { out.push(fs.readFileSync(p, 'utf8').trim()); } catch (err) { /* taken by another run */ }
    try { fs.unlinkSync(p); } catch (err) { /* gone */ }
  }
  return out;
}

module.exports = { REL, dirOf, kick, kickIn, take, waiting };
