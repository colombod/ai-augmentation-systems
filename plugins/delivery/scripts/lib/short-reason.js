// scripts/lib/short-reason.js — the plugin's own block and warning reasons are short (R-46).
//
// A refusal that explains itself at length is read in full by every session that hits it, and teaches
// the long answers the owner rejected. The rule, checked over the hooks' reasons in the tests: at most two
// lines of at most MAX_LINE characters, and the last line names the way out: an exact command (in
// backticks, or a node, bd, git or gh command) or the role to message.
const MAX_LINE = 300;
const WAY_OUT = [
  /`[^`]+`/,
  /\bnode \S+\.js\b/,
  /\b(?:bd|git|gh) [a-z-]+/,
  /\bmessage the (?:Delivery Manager|Chief of Staff|Product Manager|holder|Delivery Manager or Progress Observer)\b/i,
  /\bSendMessage\b/,
];

// [] when the reason meets the rule, else what is wrong with it
function reasonProblems(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  if (!String(text || '').trim()) return ['empty'];
  if (lines.length > 2) out.push(`${lines.length} lines`);
  for (const l of lines) if (l.length > MAX_LINE) out.push(`a line of ${l.length} characters`);
  if (!WAY_OUT.some((re) => re.test(lines[lines.length - 1]))) out.push('the last line names no command and no role to message');
  return out;
}

module.exports = { reasonProblems, MAX_LINE };
