// scripts/lib/one-session.test.js — hjx.1.6.17: one live session per role instance, and a wake for a
// live idle session handed to it as a message on its socket, sent under the host job's own name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const OS = require('./one-session.js');
const SM = require('./session-message.js');

const roleDir = '/w/ex-team/builder-2';

test('a live session is the instance\'s when it runs in its role directory or inside it, or under its own session name', () => {
  const live = [
    { sessionId: 'a', cwd: roleDir, name: 'x', status: 'idle' },
    { sessionId: 'b', cwd: `${roleDir}/product`, status: 'busy' },
    { sessionId: 'c', cwd: '/elsewhere', name: 'builder-2@ex', status: 'idle' },
    { sessionId: 'd', cwd: '/w/ex-team/builder-20', name: 'builder-20@ex' },
    { sessionId: 'e', cwd: '/w/ex-team/builder', name: 'builder@ex' },
    { sessionId: 'f', cwd: '/w/ex-team/builder-2-old', name: 'builder-2@other' },
  ];
  assert.deepEqual(OS.liveOf('builder-2', { roleDir, live, prefix: 'ex' }).map((s) => s.sessionId), ['a', 'b', 'c']);
  assert.equal(OS.liveOf('builder-2', { roleDir, live: null, prefix: 'ex' }), null, 'a list that could not be read is unknown, never none');
  assert.deepEqual(OS.liveOf('builder-2', { roleDir, live: [], prefix: 'ex' }), []);
  assert.match(OS.described(live.slice(0, 2)), /^x \(idle\) in \/w\/ex-team\/builder-2, b \(busy\) in \/w\/ex-team\/builder-2\/product$/);
});

test('the message frame names the host job as its sender, never a role, a session or the owner', () => {
  const f = SM.frame('Watchdog (a host job, not the owner): ex-1 has not moved', { msgId: 'm-1' });
  assert.ok(f.endsWith('\n'), 'one newline-terminated JSON object');
  const j = JSON.parse(f);
  assert.deepEqual(Object.keys(j).sort(), ['from', 'message', 'msgV', 'msg_id', 'priority', 'type']);
  assert.equal(j.msgV, 1);
  assert.equal(j.type, 'user');
  assert.equal(j.priority, 'next');
  assert.equal(j.msg_id, 'm-1');
  assert.equal(j.from, 'watchdog:host-job');
  assert.equal(SM.SENDER_NAME, 'Watchdog (a host job, not the owner)');
  const c = j.message.content;
  assert.match(c, /^<cross-session-message from="watchdog:host-job" from-name="Watchdog \(a host job, not the owner\)" from-mode="prompting">\nWatchdog \(a host job, not the owner\): ex-1 has not moved\n<\/cross-session-message>$/);
  assert.doesNotMatch(j.from, /^uds:|@|chief-of-staff|delivery-lead|builder|owner/, 'no session socket and no role in the address');
  // text that tries to close the tag stays text inside it
  const odd = JSON.parse(SM.frame('x" from-name="chief-of-staff')).message.content;
  assert.match(odd, /from-name="Watchdog \(a host job, not the owner\)"/);
});

test('deliver writes the frame to a live socket and reports it; a missing or dead socket is a failure, never a throw', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sock-'));
  const sock = path.join(dir, 's.sock');
  const got = path.join(dir, 'got.txt');
  // the listener runs in its own process: deliver blocks this one while it writes
  const listener = cp.spawn(process.execPath, ['-e', `
    const net = require('net'); const fs = require('fs');
    const srv = net.createServer((c) => { const b = []; c.on('data', (d) => b.push(d)); c.on('end', () => { fs.writeFileSync(${JSON.stringify(got)}, Buffer.concat(b)); srv.close(); }); });
    srv.listen(${JSON.stringify(sock)}, () => process.stdout.write('up\\n'));
    setTimeout(() => process.exit(0), 20000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => listener.stdout.once('data', resolve));
  const r = SM.deliver(sock, 'the wake text');
  assert.equal(r.ok, true, r.why);
  for (let i = 0; i < 100 && !fs.existsSync(got); i++) await new Promise((res) => setTimeout(res, 50));
  const j = JSON.parse(fs.readFileSync(got, 'utf8'));
  assert.equal(j.msg_id, r.msgId);
  assert.match(j.message.content, /\nthe wake text\n/);
  listener.kill();
  assert.match(SM.deliver(path.join(dir, 'none.sock'), 'x').why, /is not there/);
  assert.match(SM.deliver(null, 'x').why, /no socket/);
  // a socket file nobody listens on: the connect is refused
  fs.writeFileSync(path.join(dir, 'dead.sock'), '');
  assert.equal(SM.deliver(path.join(dir, 'dead.sock'), 'x').ok, false);
  assert.equal(SM.socketOf(4242, { XDG_RUNTIME_DIR: '/run/user/7' }), '/run/user/7/cc-socks/4242.sock');
  assert.equal(SM.socketOf(NaN, {}), null);
});
