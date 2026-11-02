// scripts/lib/compose-brief.js — turn manifest + role file into CLAUDE.local.md text.
const fs = require('fs');
const { resolvePluginRoot, operatorCommand } = require('./plugin-root.js');
const path = require('path');
const { launcherCommand } = require('./launcher.js');

// `node ${CLAUDE_PLUGIN_ROOT}/scripts/<x>.js` as the project's launcher runs it (lib/launcher.js): a
// brief that names the version directory breaks at the next plugin install. Other uses of the root
// (templates, references, scripts/testing/run-tests.js, whose sealed form the lane matches by path)
// keep the absolute root.
const SCRIPT_CALL = /node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z0-9][a-z0-9-]*\.js)(?=[\s`'"]|$)/g;
function renderRoot(text, pluginRoot, projectRoot) {
  const viaLauncher = projectRoot ? String(text).replace(SCRIPT_CALL, (m, x) => launcherCommand(projectRoot, x)) : String(text);
  return pluginRoot ? resolvePluginRoot(viaLauncher, pluginRoot) : viaLauncher;
}
const operatorLine = (pluginRoot, projectRoot) => (projectRoot ? launcherCommand(projectRoot, 'operator.js') : operatorCommand(pluginRoot));

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    meta[kv[1]] = value;
  }
  return { meta, body: m[2] };
}

function loadRoleBrief(pluginRoot, projectRoot, briefRef) {
  const [kind, id] = briefRef.split('/');
  let file;
  if (kind === 'delivery') file = path.join(pluginRoot, 'roles', `${id}.md`);
  else if (kind === 'project') file = path.join(projectRoot, '.delivery', 'team', 'briefs', `${id}.md`);
  else throw new Error(`brief: unknown kind "${kind}" in "${briefRef}"`);
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  let full = body;
  if (meta.composes) {
    if (kind !== 'delivery') throw new Error('brief: project briefs cannot compose');
    const agentsDir = path.resolve(pluginRoot, 'agents');
    const target = path.resolve(pluginRoot, String(meta.composes));
    if (!target.startsWith(agentsDir + path.sep)) throw new Error(`brief: composes path "${meta.composes}" must be under agents/`);
    const agent = parseFrontmatter(fs.readFileSync(target, 'utf8'));
    full = `${agent.body.trim()}\n\n${body.trim()}\n`;
  }
  return { meta, body: full };
}

function describeHost(name, host) {
  const parts = [host.kind, `bd ${host.bd === 'native' ? 'native' : `via ${host.bd}`}`];
  parts.push(host.headless ? 'headless' : 'has a display');
  parts.push(host.desktop_apps ? 'has desktop apps' : 'no desktop apps');
  if (host.lanes) parts.push(`lanes ${host.lanes.join(', ')}`);
  let text = `Host ${name}: ${parts.join(', ')}.`;
  if (host.headless) text += ' This host cannot run browser, desktop-app or computer-use checks; name the host that can and hand the check there.';
  return text;
}

function routingTable(team) {
  const lines = ['| Role | Host | Model | Brief |', '|---|---|---|---|'];
  for (const r of team.roles) {
    const id = r.count && r.count > 1 ? `${r.id} (x${r.count})` : r.id;
    lines.push(`| ${id} | ${r.host} | ${r.model} | ${r.brief} |`);
  }
  return lines.join('\n');
}

function headerLines(team, instance, role) {
  const actor = `<user>@${role.host}/${instance}`;
  return [
    `# Role: ${instance} (${role.id}) on ${team.project}`,
    '',
    `You are the session "${instance}". Your beads actor is \`${actor}\` (the real user name is set in your environment as BEADS_ACTOR). Bead prefix: \`${team.prefix}-\`. The bd host is \`${team.bd_host}\`.`,
    '',
  ];
}

// Short role block for hook injection (Claude Code caps injected hook output at 10,000 characters).
function shortBrief({ team, hosts, instance, role, roleDir, pluginRoot, projectRoot }) {
  return [
    ...headerLines(team, instance, role),
    routingTable(team),
    '',
    describeHost(role.host, hosts.hosts[role.host]),
    '',
    `Your full brief and the team rules are in ${roleDir}/CLAUDE.local.md; it is binding. Re-read it if you are unsure of your role.`,
    ...(pluginRoot ? [`Operator commands: \`${operatorLine(pluginRoot, projectRoot)} <command>\` (verify, pending, record, ack, ...).`] : []),
    '',
  ].join('\n');
}

const DELEGATE_SECTION = '# Delegate mode\n\nYou coordinate; you do not build. Do not edit files other than bead notes and, for Staffing, .delivery/team/team.json. Route work by message and report by briefing.';

// Team-conditional blocks in a role brief: `<!-- if-role: X -->...<!-- end-if -->` stays only when the
// team has role X; `<!-- unless-role: X -->...<!-- end-unless -->` only when it does not. The markers
// themselves never reach the session.
function applyRoleConditions(body, team) {
  const has = new Set(((team && team.roles) || []).filter((r) => r && !r.retired).map((r) => r.id));
  return String(body)
    .replace(/^<!-- if-role: ([a-z0-9-]+) -->\n([\s\S]*?)^<!-- end-if -->\n?/gm, (m, id, inner) => (has.has(id) ? inner : ''))
    .replace(/^<!-- unless-role: ([a-z0-9-]+) -->\n([\s\S]*?)^<!-- end-unless -->\n?/gm, (m, id, inner) => (has.has(id) ? '' : inner));
}

function composeBrief({ team, hosts, instance, role, brief, rules, pluginRoot, projectRoot }) {
  const host = hosts.hosts[role.host];
  const actor = `<user>@${role.host}/${instance}`;
  const mode = role.mode || brief.meta.mode || 'default';
  const text = [
    `# Role: ${instance} (${role.id}) on ${team.project}`,
    '',
    `You are the session "${instance}". Your beads actor is \`${actor}\` (the real user name is set in your environment as BEADS_ACTOR). Bead prefix: \`${team.prefix}-\`. The bd host is \`${team.bd_host}\`.`,
    '',
    rules.trim(),
    '',
    '# Who is on this team',
    '',
    routingTable(team),
    '',
    '# Where you run',
    '',
    describeHost(role.host, host),
    '',
    '# Your role',
    '',
    applyRoleConditions(brief.body, team).trim(),
    '',
    ...(mode === 'delegate' ? [DELEGATE_SECTION, ''] : []),
  ].join('\n');
  // the session's Bash has no CLAUDE_PLUGIN_ROOT: scripts through the project's launcher when the caller
  // wrote it (projectRoot given), else the absolute path (re-rendered every SessionStart)
  return renderRoot(text, pluginRoot, projectRoot);
}

module.exports = { renderRoot, applyRoleConditions, parseFrontmatter, loadRoleBrief, composeBrief, shortBrief, describeHost, routingTable };
