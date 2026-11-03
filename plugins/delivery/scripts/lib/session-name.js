// scripts/lib/session-name.js — the name a role session runs under, and back.
// Claude Code session names are machine-wide: two teams on one host that both name a session
// "chief-of-staff" share that name, and a message sent to it reaches whichever answers. It happened: a
// scratch quick-start team's roles ran /delivery:team join and reported to "chief-of-staff", which was
// another team's real Chief of Staff. A sender checking its own manifest cannot tell them apart (both
// teams list a chief-of-staff), so every session is named `<instance>@<team>`, the team being the
// manifest's bead prefix without a trailing "-" (`builder@delivery-plugin-planning`). Prefixes are
// unique per beads database, so two teams on one host never share one. Every place that names a
// session (start.js, the watchdog's fresh wakes, the role brief) or reads a name back (the inbox, the
// routing record, the send guard) goes through here.

// the team part of a session name: the bead prefix, trimmed of a trailing "-"
function teamTag(prefix) {
  return String(prefix || '').trim().replace(/-+$/, '');
}

// `<instance>@<team>`; the bare instance when the team has no prefix (nothing to qualify it with)
function sessionName(instance, prefix) {
  const tag = teamTag(prefix);
  return tag ? `${instance}@${tag}` : String(instance);
}

// a SendMessage target as written: a trailing " [ref]" (the Chief of Staff's plan reference) dropped
const bareTarget = (name) => String(name || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();

// { instance, prefix } for a session name; prefix is null when the name is not qualified
function parseSessionName(name) {
  const s = bareTarget(name);
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return { instance: s, prefix: null };
  return { instance: s.slice(0, at), prefix: s.slice(at + 1) };
}

// true when two prefixes name the same team (a trailing "-" either way is the same team)
function samePrefix(a, b) {
  return teamTag(a) !== '' && teamTag(a) === teamTag(b);
}

module.exports = { teamTag, sessionName, parseSessionName, samePrefix, bareTarget };
