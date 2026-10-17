#!/usr/bin/env node
// PreToolUse: keep the role in its lane. Prints a deny decision or nothing. Never exits non-zero.
//
// Fail closed only for a role session: when this session's own role marker is present but the lane
// cannot be decided (the manifest does not load, or an internal error), the call is denied with the
// way out, because prepare-role pre-allows in-lane commands and a silent allow would then bypass
// both the lane and the permission prompt. Without a role marker the hook stays inert.
const path = require('path');
const { shellPath } = require('../../scripts/lib/plugin-root.js');

// The one repair a role session may still run while the lane cannot be checked: restoring the
// manifest, as exactly `git -C <project_root> checkout|restore -- .delivery/team/<team|hosts>.json`
// (or the same without -C from inside the project root). Nothing else is accepted: the whole
// command must be plain words of a conservative path charset separated by single spaces, so no
// substitution, quote, separator, glob, redirect or extra token can ride along.
const SAFE_WORDS = /^[A-Za-z0-9_./@+,=:-]+(?: [A-Za-z0-9_./@+,=:-]+)*$/;
// the -C directory may be single-quoted (a root with spaces), with no quote or other shell syntax inside
const QUOTED_C = /^git -C '([A-Za-z0-9_./@+,=: -]+)' /;
function isManifestRestore(cmd, marker, cwd) {
  if (typeof cmd !== 'string') return false;
  const root = marker && typeof marker.project_root === 'string' ? path.resolve(marker.project_root) : null;
  if (!root) return false;
  let quotedDir = null;
  const qm = QUOTED_C.exec(cmd);
  if (qm) { quotedDir = qm[1]; cmd = `git -C QUOTED ${cmd.slice(qm[0].length)}`; }
  if (!SAFE_WORDS.test(cmd)) return false;
  let t = cmd.split(' ');
  if (quotedDir !== null) t[2] = quotedDir;
  let base = cwd ? path.resolve(cwd) : null;
  if (t[0] !== 'git') return false;
  if (t[1] === '-C') { base = path.resolve(base || '/', t[2] || ''); t = ['git', ...t.slice(3)]; }
  if (t.length !== 4 || !['checkout', 'restore'].includes(t[1]) || t[2] !== '--' || !base) return false;
  if (base !== root) return false;
  const target = path.resolve(base, t[3]);
  return [path.join(root, '.delivery', 'team', 'team.json'), path.join(root, '.delivery', 'team', 'hosts.json')].includes(target);
}

function ownMarker(input) {
  try {
    const { findRoleMarker } = require('./role-context.js');
    const found = findRoleMarker(input && input.cwd);
    return found && found.marker && typeof found.marker.instance === 'string' && process.env.DELIVERY_ROLE === found.marker.instance ? found.marker : null;
  } catch (err) { return null; }
}

let input = null;
try {
  const { readHookInput } = require('./role-context.js');
  const { laneDecisionForHook } = require('./lane.js');
  input = readHookInput();
  const d = input && input.tool_name ? laneDecisionForHook(input, path.join(__dirname, '..', '..')) : null;
  if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
} catch (err) {
  const marker = input && input.tool_name ? ownMarker(input) : null;
  const cmd = input && input.tool_input && typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
  if (marker && !(input.tool_name === 'Bash' && isManifestRestore(cmd, marker, input.cwd))) {
    const why = String(err && err.message ? err.message : err).replace(/\s+/g, ' ').slice(0, 200);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `Role ${marker.instance}: the lane cannot be checked (${why}), so nothing that writes or runs is allowed. Restore the manifest with \`git -C ${shellPath(marker.project_root)} checkout -- .delivery/team/team.json\` (allowed), or tell the Chief of Staff by SendMessage.` } }));
  }
}
process.exit(0);
