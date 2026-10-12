// scripts/lib/roster.js — .delivery/team/roster.json: which session holds which role instance.
const fs = require('fs');
const path = require('path');

const ROSTER_REL = path.join('.delivery', 'team', 'roster.json');

function readRoster(projectRoot) {
  const file = path.join(projectRoot, ROSTER_REL);
  if (!fs.existsSync(file)) return { instances: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.instances) parsed.instances = {};
  return parsed;
}

function writeRoster(projectRoot, roster) {
  const file = path.join(projectRoot, ROSTER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(roster, null, 2)}\n`);
}

function registerInstance(projectRoot, { instance, session_id, host, model, role_dir, now }) {
  const roster = readRoster(projectRoot);
  const existing = roster.instances[instance] || {};
  roster.instances[instance] = {
    session_id,
    host,
    model,
    role_dir,
    joined_at: existing.joined_at || now,
    last_seen: now,
  };
  writeRoster(projectRoot, roster);
  return roster;
}

module.exports = { readRoster, writeRoster, registerInstance, ROSTER_REL };
