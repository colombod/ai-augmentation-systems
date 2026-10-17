#!/usr/bin/env node
// PreToolUse: keep the role in its lane. Prints a deny decision or nothing. Never exits non-zero.
//
// Fail closed only for a role session: when this session's own role marker is present but the lane
// cannot be decided (the manifest does not load, or an internal error), the call is denied with the
// way out, because prepare-role pre-allows in-lane commands and a silent allow would then bypass
// both the lane and the permission prompt. Without a role marker the hook stays inert.
const path = require('path');

// the one repair a role session may still run: restoring its manifest from the project repository
function restoreCommand(projectRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return null;
  const quotedRoot = `'${projectRoot.replace(/'/g, "'\\''")}'`;
  return `git -C ${quotedRoot} checkout -- .delivery/team/team.json`;
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
  if (marker && !(input.tool_name === 'Bash' && cmd === restoreCommand(marker.project_root))) {
    const why = String(err && err.message ? err.message : err).replace(/\s+/g, ' ').slice(0, 200);
    const restore = restoreCommand(marker.project_root);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `Role ${marker.instance}: the lane cannot be checked (${why}), so nothing that writes or runs is allowed. Restore the manifest with \`${restore}\` (allowed), or tell the Chief of Staff by SendMessage.` } }));
  }
}
process.exit(0);
