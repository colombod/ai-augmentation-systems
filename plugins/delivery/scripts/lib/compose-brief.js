// scripts/lib/compose-brief.js — turn manifest + role file into CLAUDE.local.md text.
const fs = require('fs');
const path = require('path');

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
function shortBrief({ team, hosts, instance, role, roleDir }) {
  return [
    ...headerLines(team, instance, role),
    routingTable(team),
    '',
    describeHost(role.host, hosts.hosts[role.host]),
    '',
    `Your full brief and the team rules are in ${roleDir}/CLAUDE.local.md; it is binding. Re-read it if you are unsure of your role.`,
    '',
  ].join('\n');
}

const DELEGATE_SECTION = '# Delegate mode\n\nYou coordinate; you do not build. Do not edit files other than bead notes and, for Staffing, .delivery/team/team.json. Route work by message and report by briefing.';

function composeBrief({ team, hosts, instance, role, brief, rules }) {
  const host = hosts.hosts[role.host];
  const actor = `<user>@${role.host}/${instance}`;
  const mode = role.mode || brief.meta.mode || 'default';
  return [
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
    brief.body.trim(),
    '',
    ...(mode === 'delegate' ? [DELEGATE_SECTION, ''] : []),
  ].join('\n');
}

module.exports = { parseFrontmatter, loadRoleBrief, composeBrief, shortBrief, describeHost, routingTable };
