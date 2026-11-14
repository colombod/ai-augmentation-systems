// scripts/bead-read.test.js -- a bd read that timed out or failed is reported as that, never as "no bead"
// (8l1.4.1.2.1): verify-run.js and review.js said "no bead <id>" for a bead bd show then found, because a
// read that only timed out under load was taken for a missing bead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeBd } = require('./lib/bd.js');
const { makeProject, memBd, storyBead } = require('./testing/gate-fixture.js');
const { loadManifest } = require('./lib/manifest.js');
const vr = require('./verify-run.js');
const review = require('./review.js');

const BEAD = 'ex-vault-0n9-3';
const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// A bd on PATH that answers every call with this shell body
function bdThat(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-read-'));
  fs.writeFileSync(path.join(dir, 'bd'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
}
const LOCKED = 'echo "warning: beads.role not configured" >&2; echo "Error: database is locked" >&2; exit 1';
const SLOW = 'sleep 5';
const NONE = `echo 'Error fetching ${BEAD}: no issue found matching "${BEAD}"' >&2; exit 1`;

function setup() {
  const root = makeProject();
  const team = { ...loadManifest(root).team, product_github: 'example/example' };
  const who = (instance) => ({ root, team, instance, roleId: instance.replace(/-\d+$/, ''), actor: `dev@pc/${instance}` });
  return { root, who };
}

const verify = (bd) => { const { root, who } = setup(); return vr.main(['run', BEAD, '--criterion', '1'], { cwd: root, env: {}, bd, now: '2026-11-14T10:00:00.000Z', who: who('reality-checker') }); };
const request = (bd) => {
  const { who } = setup();
  return review.main(['request', '478', '--reviewer', 'agent-1', '--head', H1, '--branch', 'team/builder-1', '--bead', BEAD, '--lines', '120'], { bd, gh: () => ({ unavailable: 'gh is not installed' }), who: who('delivery-lead') });
};

test('verify-run.js names a bd error, and a bd that timed out, instead of "no bead"', () => {
  const locked = verify(makeBd({ env: bdThat(LOCKED) }));
  assert.equal(locked.code, 1);
  assert.match(locked.out, /bead ex-vault-0n9-3 could not be read: Error: database is locked; try again in a moment/);
  assert.doesNotMatch(locked.out, /no bead/);
  const slow = verify(makeBd({ env: bdThat(SLOW), timeoutMs: 300 }));
  assert.match(slow.out, /could not be read: bd did not answer within 300 ms \(timed out\)/);
  assert.doesNotMatch(slow.out, /no bead/);
  // a bead bd really does not have is still "no bead"
  assert.match(verify(makeBd({ env: bdThat(NONE) })).out, /verify-run\.js: no bead ex-vault-0n9-3$/);
});

test('review.js request names a bd error, and a bd that timed out, instead of "no bead"', () => {
  const locked = request(makeBd({ env: bdThat(LOCKED) }));
  assert.equal(locked.code, 1);
  assert.match(locked.out, /bead ex-vault-0n9-3 could not be read: Error: database is locked/);
  assert.doesNotMatch(locked.out, /no bead/);
  const slow = request(makeBd({ env: bdThat(SLOW), timeoutMs: 300 }));
  assert.match(slow.out, /could not be read: bd did not answer within 300 ms \(timed out\)/);
  assert.match(request(makeBd({ env: bdThat(NONE) })).out, /no bead ex-vault-0n9-3/);
  // the success direction: the same request with a store that has the bead goes through
  const ok = request(memBd([storyBead({ metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } })]));
  assert.equal(ok.code, 0, ok.out);
});

test('a test store whose show() throws is reported as unreadable, not missing', () => {
  const store = { show() { throw new Error('bd show x --json: Error: connection refused'); } };
  const out = verify(store).out;
  assert.match(out, /could not be read: Error: connection refused/);
  assert.doesNotMatch(out, /no bead/);
});
