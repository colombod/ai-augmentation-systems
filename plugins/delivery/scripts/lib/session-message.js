// scripts/lib/session-message.js — a wake for a role whose session is live goes to that session as a
// cross-session message on its own socket; no second session is started for it (lib/one-session.js).
//
// Claude Code (2.1.318, read on a real host; undocumented) gives every live session a socket at
// <runtime dir>/cc-socks/<pid>.sock, the pid `claude agents --json` lists. A peer's message is one
// newline-terminated JSON object written on one connection, which the sender then closes; nothing is
// sent back on it:
//   { msgV: 1, msg_id, type: 'user', message: { role: 'user', content: '<cross-session-message ...>TEXT
//     </cross-session-message>' }, priority: 'next', from: '<sender address>' }
// The format can change in a later claude: a failure of any kind is reported and the caller starts
// nothing, so a change costs a wake, never a second session.
//
// The receiving session reads the frame as a message from a peer, so its sender fields name the host
// job as what it is, never a role, another session or the owner: from-name is SENDER_NAME, and from is
// SENDER_ADDRESS, which is no socket, so a reply goes nowhere rather than to someone else.
//
// The watchdog's code is synchronous, so the connect and write run in a child node with a time limit
// (this file run as a script reads the frame on stdin and writes it to the socket named in argv).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 5000;
const SENDER_NAME = 'Watchdog (a host job, not the owner)';
const SENDER_ADDRESS = 'watchdog:host-job';

// the socket of the live session with pid, under the user's runtime directory
function socketOf(pid, env = process.env) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const rt = env.XDG_RUNTIME_DIR || (uid !== null ? `/run/user/${uid}` : null);
  return rt ? path.join(rt, 'cc-socks', `${pid}.sock`) : null;
}

const attr = (v) => String(v).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

// the frame that carries text, in the shape a peer session writes; the sender is always the host job
function frame(text, { msgId = crypto.randomUUID() } = {}) {
  const content = `<cross-session-message from="${attr(SENDER_ADDRESS)}" from-name="${attr(SENDER_NAME)}" from-mode="prompting">\n${String(text)}\n</cross-session-message>`;
  return `${JSON.stringify({ msgV: 1, msg_id: msgId, type: 'user', message: { role: 'user', content }, priority: 'next', from: SENDER_ADDRESS })}\n`;
}

// Writes text to the session listening at socket: { ok: true, msgId } once the frame is written and the
// connection closed, else { ok: false, why }.
function deliver(socket, text, { timeoutMs = TIMEOUT_MS, run = require('child_process').spawnSync } = {}) {
  if (!socket) return { ok: false, why: 'no socket for the session (no pid listed, or no runtime directory)' };
  if (!fs.existsSync(socket)) return { ok: false, why: `its socket ${socket} is not there` };
  const msgId = crypto.randomUUID();
  const r = run(process.execPath, [__filename, socket], { input: frame(text, { msgId }), encoding: 'utf8', timeout: timeoutMs });
  if (r.error) return { ok: false, why: r.error.code === 'ETIMEDOUT' ? `its socket did not take the message within ${timeoutMs} ms` : String(r.error.message).slice(0, 160) };
  if (r.status !== 0) return { ok: false, why: String(r.stderr || '').trim().split('\n')[0].slice(0, 160) || `exit ${r.status}` };
  return { ok: true, msgId };
}

module.exports = { socketOf, frame, deliver, TIMEOUT_MS, SENDER_NAME, SENDER_ADDRESS };

if (require.main === module) {
  const net = require('net');
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d));
  process.stdin.on('end', () => {
    const c = net.createConnection(process.argv[2]);
    c.on('connect', () => c.end(Buffer.concat(chunks)));
    c.on('close', (hadError) => { process.exitCode = hadError ? 1 : 0; });
    c.on('error', (err) => { process.stderr.write(`${err.code || 'error'}: ${err.message}\n`); process.exitCode = 1; });
  });
}

